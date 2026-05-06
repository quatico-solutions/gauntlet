# Prompt Extraction, Project Augmentation, and `--show-prompt-and-exit` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move static system-prompt prose from `src/agent/prompts.ts` into per-section `.md` files; add a caller-supplied Project augmentation slot (`--project-prompt` flag, default `.gauntlet/project.md`); and add a `--show-prompt-and-exit` CLI flag that renders the composed prompt with provenance and exits without launching Chrome or calling the LLM.

**Architecture:** Static prose moves to `src/agent/prompts/{persona,evaluation,context,adapter-{web,tui,cli}}.md`, loaded via a thin `loader.ts` using `import.meta.dir` (Bun-bundle-safe). `buildSystemPrompt` keeps its current call signature plus a new optional `projectPrompt` parameter. CLI parsing in `src/cli/args.ts` gains two flags. Show-prompt-and-exit branches early in `src/index.ts` before LLM-credential validation, so it works in any environment.

**Tech Stack:** TypeScript (Bun runtime), `bun:test`, custom CLI parser at `src/cli/args.ts`, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-06-prompt-extraction-and-introspection-design.md`

---

## File Structure

**Create:**
- `src/agent/prompts/persona.md` — QA tester persona prose
- `src/agent/prompts/evaluation.md` — evaluation guidance + reporting schema (merged)
- `src/agent/prompts/adapter-web.md` — current `WEB_SIDE_TRIP_GUIDANCE` prose
- `src/agent/prompts/adapter-tui.md` — empty (placeholder for future tmux skills)
- `src/agent/prompts/adapter-cli.md` — empty (placeholder)
- `src/agent/prompts/context.md` — context wrapper prose (current `CONTEXT_SECTION_PROSE` minus the `{{TREE_LISTING}}` placeholder line)
- `src/agent/prompts/loader.ts` — `loadPromptFile(name)`: reads `<name>.md`, trims trailing whitespace, throws on missing
- `src/cli/show-prompt.ts` — `showPromptAndExit(args, config)`: composes the prompt and prints all introspect blocks
- `src/agent/initial-message.ts` — `buildInitialUserMessage(adapter, target)`: extracted from `src/agent/agent.ts:128-131` so introspect can render it without running the agent
- `test/agent/__snapshots__/prompt-baseline.txt` — frozen byte output of pre-refactor `buildSystemPrompt` for refactor safety
- `test/agent/prompt-baseline.test.ts` — asserts byte-equality against the snapshot
- `test/agent/loader.test.ts` — loader unit tests
- `test/cli/show-prompt-and-exit.test.ts` — integration test for the new flag
- `test/cli/project-prompt-flag.test.ts` — argument-parser test for `--project-prompt` followed by positional

**Modify:**
- `src/agent/prompts.ts` — replace string literals with loader calls; add `projectPrompt?` parameter to `buildSystemPrompt`; switch joiner to `\n\n` and scrub leading newlines
- `src/agent/agent.ts` — pass `projectPrompt` from `AgentOptions` to `buildSystemPrompt`; replace inline initial-message construction with the extracted helper
- `src/runs/orchestrator.ts` — add `projectPrompt?` resolution (reads `.gauntlet/project.md` if present), pass through to `runAgent` via `AgentOptions`
- `src/cli/args.ts` — add `"project-prompt"` and `"show-prompt-and-exit"` to `RUN_ALLOWED`; parse them in `parseRunArgs`; extend `RunArgs` interface
- `src/cli/run-one.ts` — accept and pass through `projectPromptPath` option
- `src/api/routes/run.ts` — no caller change today (web product doesn't expose Project yet); confirm `executeRunCore` signature change is compatible (additive optional param)
- `src/index.ts` — early-exit branch for `args.showPromptAndExit` before `loadConfigOrThrow`
- `test/agent/prompts.test.ts` — preserve assertions; existing `EXPECTED_CONTEXT_SECTION` should match new `context.md` contents
- `test/evidence/logger.test.ts` — verify still passes after the joiner change; if it asserts byte-exact prompt text, update deliberately

---

## Tasks

### Task 1: Capture pre-refactor baseline snapshot

**Goal:** Freeze the current `buildSystemPrompt` byte output so subsequent prose-move tasks can verify they didn't change behavior. This task MUST run first; without it, the refactor tests whatever you wrote, not what was there.

**Files:**
- Create: `test/agent/__snapshots__/prompt-baseline.txt`
- Create: `test/agent/prompt-baseline.test.ts`
- Create: `test/agent/__snapshots__/baseline-card.json` (input fixture)

- [ ] **Step 1: Write the baseline test that will generate the snapshot**

`test/agent/prompt-baseline.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { readFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { buildSystemPrompt } from "../../src/agent/prompts";
import type { StoryCard } from "../../src/format/story-card";

const SNAPSHOT_PATH = join(import.meta.dir, "__snapshots__", "prompt-baseline.txt");
const CARD_PATH = join(import.meta.dir, "__snapshots__", "baseline-card.json");

const FIXTURE_CONTEXT_TREE =
  "  HOW-TO-LOGIN.md  (412 bytes)\n  profiles/\n    matt/\n      profile.md  (180 bytes)";

describe("buildSystemPrompt baseline snapshot", () => {
  const card: StoryCard = JSON.parse(readFileSync(CARD_PATH, "utf-8"));

  test("web adapter, with context tree — matches frozen baseline", () => {
    const prompt = buildSystemPrompt(card, FIXTURE_CONTEXT_TREE, "web");
    if (!existsSync(SNAPSHOT_PATH) || process.env.UPDATE_SNAPSHOTS === "1") {
      writeFileSync(SNAPSHOT_PATH, prompt, "utf-8");
    }
    const expected = readFileSync(SNAPSHOT_PATH, "utf-8");
    expect(prompt).toBe(expected);
  });
});
```

`test/agent/__snapshots__/baseline-card.json`:

```json
{
  "id": "story-baseline-001",
  "title": "Matt signs in and writes a journal entry",
  "stakeholder": "matt",
  "description": "Matt opens the app, signs in, and writes a friends-only post about teaching guitar.",
  "acceptanceCriteria": [
    "Signed in as Matt",
    "Wrote a Post",
    "Post indicates Friends Only"
  ]
}
```

- [ ] **Step 2: Generate the snapshot file**

Run: `UPDATE_SNAPSHOTS=1 bun test test/agent/prompt-baseline.test.ts`
Expected: PASS, `prompt-baseline.txt` is created.

- [ ] **Step 3: Run again without UPDATE_SNAPSHOTS to confirm byte-equality**

Run: `bun test test/agent/prompt-baseline.test.ts`
Expected: PASS — proves the snapshot is reproducible.

- [ ] **Step 4: Commit**

```bash
git add test/agent/prompt-baseline.test.ts test/agent/__snapshots__/
git commit -m "test(agent): freeze buildSystemPrompt baseline before extraction refactor"
```

---

### Task 2: Loader module with hygiene

**Goal:** A small loader that reads `.md` files relative to itself, trims trailing whitespace, errors clearly on missing required files, and accepts zero-byte files for adapter placeholders.

**Files:**
- Create: `src/agent/prompts/loader.ts`
- Create: `test/agent/loader.test.ts`
- Create: `src/agent/prompts/.gitkeep` (so the directory exists for tests in this task before any `.md` file is created)

- [ ] **Step 1: Write loader tests first**

`test/agent/loader.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";
import { loadPromptFile } from "../../src/agent/prompts/loader";

const PROMPTS_DIR = join(import.meta.dir, "..", "..", "src", "agent", "prompts");

describe("loadPromptFile", () => {
  test("reads an existing file and trims trailing whitespace", () => {
    const path = join(PROMPTS_DIR, "_test-trim.md");
    writeFileSync(path, "hello world\n\n  \n", "utf-8");
    try {
      expect(loadPromptFile("_test-trim")).toBe("hello world");
    } finally {
      unlinkSync(path);
    }
  });

  test("returns empty string for a zero-byte file (no throw)", () => {
    const path = join(PROMPTS_DIR, "_test-empty.md");
    writeFileSync(path, "", "utf-8");
    try {
      expect(loadPromptFile("_test-empty")).toBe("");
    } finally {
      unlinkSync(path);
    }
  });

  test("throws a clear error naming the missing file", () => {
    expect(() => loadPromptFile("_does-not-exist")).toThrow(/_does-not-exist\.md/);
  });

  test("does not strip leading whitespace inside content (only trailing)", () => {
    const path = join(PROMPTS_DIR, "_test-leading.md");
    writeFileSync(path, "  preserved\n", "utf-8");
    try {
      expect(loadPromptFile("_test-leading")).toBe("  preserved");
    } finally {
      unlinkSync(path);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/agent/loader.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the loader**

`src/agent/prompts/loader.ts`:

```ts
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Read a prompt file from src/agent/prompts/<name>.md. Trims trailing
 * whitespace (so .md files can end with a trailing newline without
 * breaking the \n\n joiner). A zero-byte file is valid and returns "".
 * A missing file throws with the resolved path.
 *
 * Resolution uses import.meta.dir so the loader works under bun run,
 * bun build, and `bun build --compile` standalone binaries.
 */
export function loadPromptFile(name: string): string {
  const path = join(import.meta.dir, `${name}.md`);
  try {
    const raw = readFileSync(path, "utf-8");
    return raw.replace(/\s+$/, "");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new Error(`Required prompt file not found: ${path}`);
    }
    throw err;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/agent/loader.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/agent/prompts/loader.ts test/agent/loader.test.ts src/agent/prompts/.gitkeep
git commit -m "feat(prompts): add loader with trailing-whitespace trim and missing-file error"
```

---

### Task 3: Extract Persona to `persona.md` (verbatim)

**Goal:** Move the QA-tester persona text from a string literal to `src/agent/prompts/persona.md` without changing byte output. Baseline snapshot must continue to pass.

**Files:**
- Create: `src/agent/prompts/persona.md`
- Modify: `src/agent/prompts.ts`

- [ ] **Step 1: Create `persona.md` with the exact current persona text**

`src/agent/prompts/persona.md`:

```markdown
You are a thorough QA tester. You test software by using it, just like a human would.

You have been given a story card to test. Your job is to:
1. Explore the application and attempt to accomplish what the story describes
2. Judge whether the acceptance criteria are satisfied
3. Report your verdict with evidence
4. Report ANY other observations you make along the way

You are not limited to testing only the acceptance criteria. Like a good human tester, you should report anything you notice:
- Bugs (something is broken)
- UX issues (confusing navigation, unclear labels, missing feedback)
- Typos (misspelled text)
- Suggestions (it would be easier if...)
- Accessibility issues (missing alt text, poor contrast)
- Performance issues (slow loads, laggy interactions)

These incidental observations are extremely valuable.
```

- [ ] **Step 2: Replace the persona string literal in `src/agent/prompts.ts`**

In `src/agent/prompts.ts`, add at the top:

```ts
import { loadPromptFile } from "./prompts/loader";
```

Replace the first `parts.push(\`You are a thorough QA tester...\`);` block (currently at lines 59-75) with:

```ts
  parts.push(loadPromptFile("persona"));
```

- [ ] **Step 3: Verify the baseline snapshot still passes**

Run: `bun test test/agent/prompt-baseline.test.ts`
Expected: PASS — byte output unchanged.

If the test fails, the `persona.md` content does not exactly match the original string literal. Diff the two and fix `persona.md`.

- [ ] **Step 4: Run the existing prompts test to confirm no regression**

Run: `bun test test/agent/prompts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/prompts/persona.md src/agent/prompts.ts
git commit -m "refactor(prompts): extract persona to persona.md (no byte change)"
```

---

### Task 4: Extract Context wrapper to `context.md` (verbatim)

**Goal:** Move the context-section prose to `src/agent/prompts/context.md`. The `{{TREE_LISTING}}` substitution stays in TS.

**Files:**
- Create: `src/agent/prompts/context.md`
- Modify: `src/agent/prompts.ts`

- [ ] **Step 1: Create `context.md` containing the wrapper prose**

`src/agent/prompts/context.md`:

```markdown
## Context

The project has a context directory at `.gauntlet/context/`. This is a
freeform data store the story author set up for this project. Read files
with `read` and pull out whatever you need to carry out the story.

Stories will often refer to users by name ("Alice", "as bob") without
spelling out credentials. When that happens, look for a matching path in
the tree below, `read` the relevant files, and use what you find to log
in via the regular browser tools. A profile directory typically contains
an identity file (prose describing the person) and a credentials file;
some also contain `passkey.yaml` for WebAuthn sign-in via
`install_passkey`.

Below is the complete tree of everything available under
`.gauntlet/context/` for this run. File sizes in bytes are shown after
each entry. This listing is the full map: it is built once at the start
of the run and does not change while the run is in flight, so you do not
need to — and cannot — re-list the directory. Every file you might need
is in this tree; if a path is not shown here, it does not exist.

### .gauntlet/context/
{{TREE_LISTING}}
```

The `{{TREE_LISTING}}` line is a literal placeholder kept in the file as a self-documenting marker; the TS code substitutes it. **Do not** introduce a template engine.

- [ ] **Step 2: Replace `CONTEXT_SECTION_PROSE` constant in `src/agent/prompts.ts`**

Delete the `CONTEXT_SECTION_PROSE` constant (lines 14-33) and the surrounding comment block (lines 3-13). Replace the export with a function-time load:

```ts
// Exported for tests that want to diff the prose against the spec.
export function getContextSectionTemplate(): string {
  return loadPromptFile("context");
}
export const CONTEXT_SECTION_TEMPLATE = getContextSectionTemplate();
```

In the `buildSystemPrompt` body, replace:

```ts
  if (contextTree && contextTree.length > 0) {
    parts.push(
      "\n" + CONTEXT_SECTION_PROSE.replace("{{TREE_LISTING}}", contextTree),
    );
  }
```

with:

```ts
  if (contextTree && contextTree.length > 0) {
    parts.push(
      "\n" + loadPromptFile("context").replace("{{TREE_LISTING}}", contextTree),
    );
  }
```

- [ ] **Step 3: Verify baseline snapshot and existing tests still pass**

Run: `bun test test/agent/prompt-baseline.test.ts test/agent/prompts.test.ts`
Expected: PASS for both.

If `prompts.test.ts` fails because `EXPECTED_CONTEXT_SECTION` is exported from `src/agent/prompts.ts`, update it to use the new exported function:

```ts
import { CONTEXT_SECTION_TEMPLATE } from "../../src/agent/prompts";
// no other change required if EXPECTED_CONTEXT_SECTION === CONTEXT_SECTION_TEMPLATE
```

- [ ] **Step 4: Commit**

```bash
git add src/agent/prompts/context.md src/agent/prompts.ts
git commit -m "refactor(prompts): extract context wrapper to context.md (no byte change)"
```

---

### Task 5: Extract Adapter (web) to `adapter-web.md`; create empty `adapter-cli.md` and `adapter-tui.md`

**Goal:** Move the web side-trip guidance to `adapter-web.md`. Create empty placeholder files for the cli and tui adapters. Adapter selection logic in `buildSystemPrompt` becomes a single load by adapter name.

**Files:**
- Create: `src/agent/prompts/adapter-web.md`
- Create: `src/agent/prompts/adapter-cli.md` (empty)
- Create: `src/agent/prompts/adapter-tui.md` (empty)
- Modify: `src/agent/prompts.ts`

- [ ] **Step 1: Create `adapter-web.md` with the exact current side-trip prose**

`src/agent/prompts/adapter-web.md`:

```markdown

## Side trips for sign-in flows

If a sign-in asks you to fetch a code from email, retrieve a password from a password manager, or visit another site for a verification step, use `new_tab(url)` to open that site in a side tab. Work there as you normally would. When done, call `close_tab` to return to the original page — its form values, cookies, and scroll position will be intact. Do NOT use `navigate` for side trips: it resets the original page state and you will have to start the sign-in over.
```

Note the leading blank line — this preserves the `\n` that was prefixed in the original `WEB_SIDE_TRIP_GUIDANCE` constant. The loader's trailing-whitespace trim does not touch leading blanks.

**Important:** verify byte-for-byte against the original by running the baseline test (Step 3). If it fails, the prose has drifted; fix `adapter-web.md` to match the original verbatim.

- [ ] **Step 2: Create empty placeholders**

```bash
: > /Users/mw/Code/prime/gauntlet/src/agent/prompts/adapter-cli.md
: > /Users/mw/Code/prime/gauntlet/src/agent/prompts/adapter-tui.md
```

- [ ] **Step 3: Replace adapter logic in `src/agent/prompts.ts`**

Delete the `WEB_SIDE_TRIP_GUIDANCE` constant (lines 38-50). Replace:

```ts
  if (adapterName === "web") {
    parts.push(WEB_SIDE_TRIP_GUIDANCE);
  }
```

with:

```ts
  if (adapterName) {
    const adapterPrompt = loadPromptFile(`adapter-${adapterName}`);
    if (adapterPrompt.length > 0) {
      parts.push(adapterPrompt);
    }
  }
```

The `length > 0` check skips empty files (cli, tui today) so they don't add a stray `\n\n` between Evaluation and Context.

- [ ] **Step 4: Verify baseline snapshot and existing tests pass**

Run: `bun test test/agent/prompt-baseline.test.ts test/agent/prompts.test.ts`
Expected: PASS for both.

- [ ] **Step 5: Commit**

```bash
git add src/agent/prompts/adapter-web.md src/agent/prompts/adapter-cli.md src/agent/prompts/adapter-tui.md src/agent/prompts.ts
git commit -m "refactor(prompts): extract adapter overlays to adapter-{name}.md (no byte change)"
```

---

### Task 6: Extract Reporting prose to `evaluation.md` (verbatim)

**Goal:** Move the `## Reporting` block to `evaluation.md`. Acceptance Criteria Guidance stays inline in this task — its conditional structure will be merged in Task 7.

**Files:**
- Create: `src/agent/prompts/evaluation.md`
- Modify: `src/agent/prompts.ts`

- [ ] **Step 1: Create `evaluation.md` with the exact current Reporting prose**

`src/agent/prompts/evaluation.md`:

```markdown

## Reporting

When you are done testing, call the `report_result` tool with your findings.

Your verdict should be:
- **pass** — the story's intent is satisfied, acceptance criteria met
- **fail** — something is clearly broken or criteria are not met
- **investigate** — you're unsure, something seems off but you can't confirm

Include ALL observations, not just those related to the acceptance criteria.
```

Leading blank line preserved (same reasoning as Task 5).

- [ ] **Step 2: Replace the Reporting push in `src/agent/prompts.ts`**

Replace the `parts.push(\`\n## Reporting...\`);` block (lines 97-106) with:

```ts
  parts.push(loadPromptFile("evaluation"));
```

- [ ] **Step 3: Verify baseline snapshot and existing tests pass**

Run: `bun test test/agent/prompt-baseline.test.ts test/agent/prompts.test.ts`
Expected: PASS for both.

- [ ] **Step 4: Commit**

```bash
git add src/agent/prompts/evaluation.md src/agent/prompts.ts
git commit -m "refactor(prompts): extract reporting prose to evaluation.md (no byte change)"
```

---

### Task 7: Joiner cleanup — switch to `\n\n`, scrub leading newlines, regenerate baseline

**Goal:** Standardize block separation so the joiner is the only source of inter-block blank lines. This is the **first deliberate byte change** in the refactor; the baseline snapshot is regenerated in this commit and the change is owned here so future bisects land cleanly.

**Files:**
- Modify: `src/agent/prompts.ts`
- Modify: `src/agent/prompts/adapter-web.md` (strip leading blank line)
- Modify: `src/agent/prompts/evaluation.md` (strip leading blank line)
- Modify: `test/agent/__snapshots__/prompt-baseline.txt` (regenerate)

- [ ] **Step 1: Strip leading blank lines from `.md` files that have them**

Edit `src/agent/prompts/adapter-web.md`: remove the leading blank line so the file starts directly with `## Side trips for sign-in flows`.

Edit `src/agent/prompts/evaluation.md`: remove the leading blank line so the file starts directly with `## Reporting`.

(`persona.md` and `context.md` already start with content; no change.)

- [ ] **Step 2: Scrub leading `\n` from in-prose pushes in `src/agent/prompts.ts`**

In `buildSystemPrompt`, change every `parts.push("\n...")` to `parts.push("...")` (the joiner now adds the separator). Specifically:

```ts
  parts.push(`\n## Story Card\n`);  // → parts.push(`## Story Card`);
  parts.push(`\n${card.description}`);  // → parts.push(card.description);
  parts.push(`\n## Acceptance Criteria`);  // → parts.push(`## Acceptance Criteria`);
  parts.push(
    `\nEvaluate each criterion based on what you observe. Use your judgment.`
  );  // → parts.push(`Evaluate each criterion based on what you observe. Use your judgment.`);
  parts.push(
    `\nThis story has no explicit acceptance criteria. ...`
  );  // → parts.push(`This story has no explicit acceptance criteria. ...`);
  // The Context push:
  parts.push(
    "\n" + loadPromptFile("context").replace(...)
  );  // → parts.push(loadPromptFile("context").replace(...));
```

Also strip the in-string trailing `\n` from `\`\\n## Story Card\\n\`` — change to just `\`## Story Card\``.

- [ ] **Step 3: Switch joiner to `\n\n`**

Replace the final line of `buildSystemPrompt`:

```ts
  return parts.join("\n");
```

with:

```ts
  return parts.join("\n\n");
```

- [ ] **Step 4: Regenerate the baseline snapshot**

Run: `UPDATE_SNAPSHOTS=1 bun test test/agent/prompt-baseline.test.ts`
Expected: PASS — snapshot is overwritten.

- [ ] **Step 5: Visually inspect the new snapshot**

Run: `cat test/agent/__snapshots__/prompt-baseline.txt | head -80`

Verify:
- Persona block ends with "These incidental observations are extremely valuable." then a blank line.
- "## Story Card" follows after exactly ONE blank line.
- No double-blank-lines anywhere (i.e., no `\n\n\n` runs).
- "## Reporting" appears with one blank line before it.
- "## Side trips for sign-in flows" appears with one blank line before it.
- "## Context" appears with one blank line before it.

If any double-blank-lines appear, find the corresponding `parts.push` and check whether its content has a leading or trailing `\n` that should be stripped.

- [ ] **Step 6: Run the full test suite**

Run: `bun test test/agent/`
Expected: PASS. The existing `prompts.test.ts` uses `.toContain` for most assertions and should survive; if `expect(prompt.endsWith(EXPECTED_CONTEXT_SECTION)).toBe(true)` fails, the context block now ends with content (no trailing `\n`), so update the assertion: `expect(prompt.endsWith(EXPECTED_CONTEXT_SECTION.trimEnd())).toBe(true)`.

- [ ] **Step 7: Run the evidence-logger test**

Run: `bun test test/evidence/logger.test.ts`
Expected: PASS. If it asserts byte-exact prompt text, update its expected fixture deliberately and note the change in the commit message.

- [ ] **Step 8: Commit**

```bash
git add src/agent/prompts.ts src/agent/prompts/adapter-web.md src/agent/prompts/evaluation.md test/agent/__snapshots__/prompt-baseline.txt test/agent/prompts.test.ts
# and test/evidence/logger.test.ts only if it required a fixture update
git commit -m "refactor(prompts): joiner=\\n\\n, scrub leading newlines, regenerate baseline

Block separation is now the joiner's sole responsibility. .md files
contain content with no leading or trailing blank lines; in-TS pushes
no longer prefix \\n. Baseline snapshot regenerated and tests updated."
```

---

### Task 8: Add `projectPrompt?` parameter to `buildSystemPrompt`; thread through `runAgent`

**Goal:** Wire the new optional parameter end-to-end. No CLI flag yet — this task only adds the plumbing. With no caller supplying a value, behavior is unchanged.

**Files:**
- Modify: `src/agent/prompts.ts`
- Modify: `src/agent/agent.ts`
- Create: `test/agent/project-prompt.test.ts`

- [ ] **Step 1: Write the test for Project insertion**

`test/agent/project-prompt.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { buildSystemPrompt } from "../../src/agent/prompts";
import type { StoryCard } from "../../src/format/story-card";

const CARD: StoryCard = {
  id: "story-proj-001",
  title: "Test card",
  description: "Body",
  acceptanceCriteria: ["Criterion 1"],
};

describe("buildSystemPrompt projectPrompt parameter", () => {
  test("when omitted, no Project block appears", () => {
    const prompt = buildSystemPrompt(CARD, "tree", "web");
    expect(prompt).not.toContain("MY_PROJECT_MARKER");
  });

  test("when provided, Project text is inserted between Adapter and Context", () => {
    const prompt = buildSystemPrompt(CARD, "tree", "web", "MY_PROJECT_MARKER");
    const adapterIdx = prompt.indexOf("Side trips for sign-in flows");
    const projectIdx = prompt.indexOf("MY_PROJECT_MARKER");
    const contextIdx = prompt.indexOf("## Context");
    expect(adapterIdx).toBeGreaterThan(-1);
    expect(projectIdx).toBeGreaterThan(adapterIdx);
    expect(contextIdx).toBeGreaterThan(projectIdx);
  });

  test("Project block is separated from neighbors by exactly one blank line", () => {
    const prompt = buildSystemPrompt(CARD, "tree", "web", "PROJECT_BODY");
    expect(prompt).toContain("\n\nPROJECT_BODY\n\n");
    expect(prompt).not.toContain("\n\n\nPROJECT_BODY");
  });

  test("empty Project string is treated as omitted (no extra blank line)", () => {
    const promptEmpty = buildSystemPrompt(CARD, "tree", "web", "");
    const promptOmitted = buildSystemPrompt(CARD, "tree", "web");
    expect(promptEmpty).toBe(promptOmitted);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/agent/project-prompt.test.ts`
Expected: FAIL — `buildSystemPrompt` does not accept a fourth parameter.

- [ ] **Step 3: Add the parameter to `buildSystemPrompt`**

In `src/agent/prompts.ts`, change the signature:

```ts
export function buildSystemPrompt(
  card: StoryCard,
  contextTree?: string,
  adapterName?: string,
  projectPrompt?: string,
): string {
```

And insert the Project push between the Adapter block (currently after the `if (adapterName)` block) and the Context block:

```ts
  // Block 5: Project — caller-supplied augmentation. See spec
  // 2026-05-06-prompt-extraction-and-introspection-design.md.
  if (projectPrompt && projectPrompt.length > 0) {
    parts.push(projectPrompt);
  }

  // Block 6: Context — last block, only when populated.
  if (contextTree && contextTree.length > 0) {
    parts.push(loadPromptFile("context").replace("{{TREE_LISTING}}", contextTree));
  }
```

- [ ] **Step 4: Add `projectPrompt` to `AgentOptions` and pass through in `runAgent`**

In `src/agent/agent.ts`, find the `AgentOptions` interface (search for `interface AgentOptions` or similar). Add:

```ts
  projectPrompt?: string;
```

In `runAgent`, change line 110:

```ts
const systemPrompt = buildSystemPrompt(card, options.contextTree, adapter.name);
```

to:

```ts
const systemPrompt = buildSystemPrompt(
  card,
  options.contextTree,
  adapter.name,
  options.projectPrompt,
);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test test/agent/project-prompt.test.ts test/agent/prompt-baseline.test.ts`
Expected: PASS — Project tests pass; baseline still passes (no caller supplies projectPrompt yet).

- [ ] **Step 6: Commit**

```bash
git add src/agent/prompts.ts src/agent/agent.ts test/agent/project-prompt.test.ts
git commit -m "feat(prompts): add optional projectPrompt parameter to buildSystemPrompt"
```

---

### Task 9: Resolve project prompt in `executeRunCore` (auto-load `.gauntlet/project.md`)

**Goal:** Both CLI and web product call `executeRunCore`. Auto-load `.gauntlet/project.md` from `runConfig.projectRoot` if present, and accept an explicit `projectPromptPath` option that overrides the default. CLI uses the explicit path; web ignores both today.

**Files:**
- Modify: `src/runs/orchestrator.ts`
- Create: `test/runs/project-prompt-resolution.test.ts`

- [ ] **Step 1: Write the resolution test**

`test/runs/project-prompt-resolution.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { resolveProjectPrompt } from "../../src/runs/orchestrator";

describe("resolveProjectPrompt", () => {
  test("returns explicit path contents when provided", () => {
    const dir = mkdtempSync(join(tmpdir(), "gauntlet-pp-"));
    try {
      const explicit = join(dir, "extra.md");
      writeFileSync(explicit, "EXPLICIT_BODY", "utf-8");
      expect(resolveProjectPrompt(dir, explicit)).toBe("EXPLICIT_BODY");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("auto-loads .gauntlet/project.md when no explicit path", () => {
    const dir = mkdtempSync(join(tmpdir(), "gauntlet-pp-"));
    try {
      mkdirSync(join(dir, ".gauntlet"));
      writeFileSync(join(dir, ".gauntlet", "project.md"), "DEFAULT_BODY", "utf-8");
      expect(resolveProjectPrompt(dir, undefined)).toBe("DEFAULT_BODY");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns undefined when no explicit path and no default file", () => {
    const dir = mkdtempSync(join(tmpdir(), "gauntlet-pp-"));
    try {
      expect(resolveProjectPrompt(dir, undefined)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("throws when explicit path is supplied but file is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "gauntlet-pp-"));
    try {
      const explicit = join(dir, "nonexistent.md");
      expect(() => resolveProjectPrompt(dir, explicit)).toThrow(/nonexistent\.md/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/runs/project-prompt-resolution.test.ts`
Expected: FAIL — `resolveProjectPrompt` not exported.

- [ ] **Step 3: Implement `resolveProjectPrompt` and wire into `executeRunCore`**

In `src/runs/orchestrator.ts`, add (near the top, after imports):

```ts
import { existsSync, readFileSync } from "fs";

/**
 * Resolve the Project prompt block. Explicit path wins; otherwise look
 * for .gauntlet/project.md in the project root; otherwise undefined.
 * Missing explicit path is a hard error (the caller asked for it).
 */
export function resolveProjectPrompt(
  projectRoot: string,
  explicitPath: string | undefined,
): string | undefined {
  if (explicitPath) {
    if (!existsSync(explicitPath)) {
      throw new Error(`--project-prompt file not found: ${explicitPath}`);
    }
    return readFileSync(explicitPath, "utf-8").replace(/\s+$/, "");
  }
  const defaultPath = join(projectRoot, ".gauntlet", "project.md");
  if (existsSync(defaultPath)) {
    return readFileSync(defaultPath, "utf-8").replace(/\s+$/, "");
  }
  return undefined;
}
```

Add `projectPromptPath?: string` to `ExecuteRunCoreOptions` (find the interface in the same file; add the field as an optional string).

In `executeRunCore`, after `contextTree` is computed (~line 138), add:

```ts
  const projectPrompt = resolveProjectPrompt(runConfig.projectRoot, opts.projectPromptPath);
```

In the `runAgent(...)` call (~line 165), add `projectPrompt` to the options object:

```ts
    const result = await runAgent(card, adapter, client, logger, runConfig.target, {
      contextTree,
      projectPrompt,  // NEW
      runId,
      // ... rest unchanged
    });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/runs/project-prompt-resolution.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the broader test suite**

Run: `bun test`
Expected: PASS for all. Existing tests don't supply `projectPromptPath`, so behavior is unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/runs/orchestrator.ts test/runs/project-prompt-resolution.test.ts
git commit -m "feat(runs): resolveProjectPrompt with explicit-path or .gauntlet/project.md default"
```

---

### Task 10: CLI: parse `--project-prompt` flag

**Goal:** Add the flag to the run-command allowlist and parser. Thread it through `runOne` to `executeRunCore`. Add a parser-level test confirming a positional card path is still extracted correctly when `--project-prompt <path>` precedes it.

**Files:**
- Modify: `src/cli/args.ts`
- Modify: `src/cli/run-one.ts`
- Modify: `src/cli/run.ts`
- Create: `test/cli/project-prompt-flag.test.ts`

- [ ] **Step 1: Write the parser test**

`test/cli/project-prompt-flag.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { parseArgs } from "../../src/cli/args";

describe("--project-prompt flag", () => {
  test("parses --project-prompt with positional card path before flags", () => {
    const args = parseArgs(["bun", "gauntlet", "run", "./card.md", "--target", "http://x", "--project-prompt", "./extra.md"]);
    expect(args.command).toBe("run");
    if (args.command === "run") {
      expect(args.scenarioPath).toBe("./card.md");
      expect(args.projectPromptPath).toBe("./extra.md");
    }
  });

  test("parses --project-prompt before positional", () => {
    const args = parseArgs(["bun", "gauntlet", "run", "--target", "http://x", "--project-prompt", "./extra.md", "./card.md"]);
    expect(args.command).toBe("run");
    if (args.command === "run") {
      expect(args.scenarioPath).toBe("./card.md");
      expect(args.projectPromptPath).toBe("./extra.md");
    }
  });

  test("omitting --project-prompt yields undefined", () => {
    const args = parseArgs(["bun", "gauntlet", "run", "./card.md", "--target", "http://x"]);
    expect(args.command).toBe("run");
    if (args.command === "run") {
      expect(args.projectPromptPath).toBeUndefined();
    }
  });

  test("rejects --project-prompt for batch (batch will get this in a future task)", () => {
    expect(() =>
      parseArgs(["bun", "gauntlet", "batch", "./card.md", "--target", "http://x", "--project-prompt", "./extra.md"])
    ).toThrow(/Unknown flag/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/cli/project-prompt-flag.test.ts`
Expected: FAIL — flag is rejected and `projectPromptPath` is undefined on the type.

- [ ] **Step 3: Add the flag to the allowlist and parse it**

In `src/cli/args.ts:47`, change `RUN_ALLOWED`:

```ts
const RUN_ALLOWED = new Set([
  "target", "out", "adapter", "model", "chrome", "project-dir",
  "turns", "viewport", "save-screencast",
  "silent", "format", "no-color", "passes",
  "project-prompt",  // NEW
]);
```

Note `BATCH_ALLOWED` derives from `RUN_ALLOWED` minus `--out`. The new flag is included in batch by default — to keep batch out for this task, add an explicit exclusion:

```ts
const BATCH_ALLOWED = new Set([...RUN_ALLOWED].filter((f) => f !== "out" && f !== "project-prompt"));
```

In the `RunArgs` interface (~line 74), add:

```ts
export interface RunArgs {
  command: "run";
  scenarioPath: string;
  outDir?: string;
  adapter: AdapterType;
  silent: boolean;
  format: "pretty" | "jsonl" | undefined;
  noColor: boolean;
  passes: number;
  projectPromptPath?: string;  // NEW
  cli: CliArgsInput;
}
```

In `parseRunArgs` (~line 205), add to the returned object:

```ts
  return {
    command: "run",
    scenarioPath: positional,
    outDir: flags.out,
    adapter,
    silent: flags.silent === "true",
    format,
    noColor: flags["no-color"] === "true",
    passes: parsePasses(flags.passes),
    projectPromptPath: flags["project-prompt"],  // NEW
    cli: { /* unchanged */ },
  };
```

- [ ] **Step 4: Thread `projectPromptPath` through `runOne` to `executeRunCore`**

In `src/cli/run-one.ts`, add to `RunOneOptions`:

```ts
  projectPromptPath?: string;
```

In the `executeRunCore({...})` call (~line 52), add:

```ts
  return executeRunCore({
    card,
    storyPath: scenarioPath,
    runId: opts.runId,
    outDir: opts.outDir,
    client,
    runSetCtx: opts.runSetCtx,
    projectPromptPath: opts.projectPromptPath,  // NEW
    runConfig: { /* unchanged */ },
    hooks: opts.onLogger ? { onLogger: (logger) => opts.onLogger!(logger) } : undefined,
  });
```

In `src/cli/run.ts`, find the `runOne({...})` call (look for the function `run` that takes `RunOptions`). Pass `projectPromptPath` from its options:

```ts
  // In the function that calls runOne, accept and forward projectPromptPath
  // Search for: await runOne({
  //   scenarioPath: opts.scenarioPath,
  //   ...
  // })
  // Add: projectPromptPath: opts.projectPromptPath,
```

In `src/index.ts:32-42`, the `case "run"` block, pass it through:

```ts
      await run({
        scenarioPath: args.scenarioPath,
        target: args.cli.target ?? "",
        outDir: args.outDir,
        adapterType: args.adapter,
        config,
        silent: args.silent,
        format: args.format,
        noColor: args.noColor,
        passes: args.passes,
        projectPromptPath: args.projectPromptPath,  // NEW
      });
```

You will need to add `projectPromptPath?: string` to the `RunOptions` type that `run()` accepts (declared in `src/cli/run.ts`).

- [ ] **Step 5: Run the parser tests**

Run: `bun test test/cli/project-prompt-flag.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Run the full suite**

Run: `bun test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/cli/args.ts src/cli/run-one.ts src/cli/run.ts src/index.ts test/cli/project-prompt-flag.test.ts
git commit -m "feat(cli): add --project-prompt flag for run command"
```

---

### Task 11: Extract `buildInitialUserMessage` helper

**Goal:** The agent's first user message ("Begin testing...") and `adapter.describeTarget(target)` are constructed inline at `src/agent/agent.ts:128-131`. Extract to a pure helper so introspect can render the exact same string without running the agent.

**Files:**
- Create: `src/agent/initial-message.ts`
- Modify: `src/agent/agent.ts`
- Create: `test/agent/initial-message.test.ts`

- [ ] **Step 1: Write the helper test**

`test/agent/initial-message.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { buildInitialUserMessage } from "../../src/agent/initial-message";

describe("buildInitialUserMessage", () => {
  test("baseline message with no target", () => {
    const adapter = { describeTarget: () => "" };
    expect(buildInitialUserMessage(adapter, undefined)).toBe(
      "Begin testing. Use the available tools to interact with the application."
    );
  });

  test("appends adapter.describeTarget when target is provided", () => {
    const adapter = { describeTarget: (t: string) => `Open ${t} in Chromium.` };
    const result = buildInitialUserMessage(adapter, "http://x");
    expect(result).toBe(
      "Begin testing. Use the available tools to interact with the application.\n\nOpen http://x in Chromium."
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/agent/initial-message.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the helper**

`src/agent/initial-message.ts`:

```ts
export interface AdapterTargetDescriber {
  describeTarget(target: string): string;
}

/**
 * Build the agent's first user message. Extracted from runAgent so that
 * --show-prompt-and-exit can render the exact same string without
 * spinning up the agent loop.
 */
export function buildInitialUserMessage(
  adapter: AdapterTargetDescriber,
  target: string | undefined,
): string {
  let msg = "Begin testing. Use the available tools to interact with the application.";
  if (target) {
    msg += `\n\n${adapter.describeTarget(target)}`;
  }
  return msg;
}
```

- [ ] **Step 4: Replace the inline construction in `runAgent`**

In `src/agent/agent.ts`, add at the top:

```ts
import { buildInitialUserMessage } from "./initial-message";
```

Replace lines 128-131:

```ts
  let initialMessage = "Begin testing. Use the available tools to interact with the application.";
  if (target) {
    initialMessage += `\n\n${adapter.describeTarget(target)}`;
  }
```

with:

```ts
  const initialMessage = buildInitialUserMessage(adapter, target);
```

- [ ] **Step 5: Run tests**

Run: `bun test test/agent/initial-message.test.ts test/agent/agent.test.ts`
Expected: PASS for both. Agent test should be unchanged because behavior is identical.

- [ ] **Step 6: Commit**

```bash
git add src/agent/initial-message.ts src/agent/agent.ts test/agent/initial-message.test.ts
git commit -m "refactor(agent): extract buildInitialUserMessage so introspect can render it"
```

---

### Task 12: CLI: parse `--show-prompt-and-exit` flag

**Goal:** Add the flag to the allowlist and the `RunArgs` interface. Parsing only — dispatch wiring comes in Task 13.

**Files:**
- Modify: `src/cli/args.ts`

- [ ] **Step 1: Write the parser test**

Append to `test/cli/project-prompt-flag.test.ts`:

```ts
describe("--show-prompt-and-exit flag", () => {
  test("bareword flag sets showPromptAndExit=true", () => {
    const args = parseArgs(["bun", "gauntlet", "run", "./card.md", "--target", "http://x", "--show-prompt-and-exit"]);
    expect(args.command).toBe("run");
    if (args.command === "run") {
      expect(args.showPromptAndExit).toBe(true);
    }
  });

  test("absent flag yields false", () => {
    const args = parseArgs(["bun", "gauntlet", "run", "./card.md", "--target", "http://x"]);
    expect(args.command).toBe("run");
    if (args.command === "run") {
      expect(args.showPromptAndExit).toBe(false);
    }
  });

  test("rejected for batch", () => {
    expect(() =>
      parseArgs(["bun", "gauntlet", "batch", "./card.md", "--target", "http://x", "--show-prompt-and-exit"])
    ).toThrow(/Unknown flag/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/cli/project-prompt-flag.test.ts`
Expected: FAIL — flag is rejected.

- [ ] **Step 3: Add the flag**

In `src/cli/args.ts`, update `RUN_ALLOWED`:

```ts
const RUN_ALLOWED = new Set([
  "target", "out", "adapter", "model", "chrome", "project-dir",
  "turns", "viewport", "save-screencast",
  "silent", "format", "no-color", "passes",
  "project-prompt",
  "show-prompt-and-exit",  // NEW
]);
```

Update `BATCH_ALLOWED` to also exclude the new flag:

```ts
const BATCH_ALLOWED = new Set([...RUN_ALLOWED].filter(
  (f) => f !== "out" && f !== "project-prompt" && f !== "show-prompt-and-exit",
));
```

Add to `RunArgs`:

```ts
  showPromptAndExit: boolean;
```

In `parseRunArgs`, add to the returned object:

```ts
    showPromptAndExit: flags["show-prompt-and-exit"] === "true",
```

- [ ] **Step 4: Run tests**

Run: `bun test test/cli/project-prompt-flag.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/args.ts test/cli/project-prompt-flag.test.ts
git commit -m "feat(cli): parse --show-prompt-and-exit flag (dispatch wiring next)"
```

---

### Task 13: Implement `showPromptAndExit` and wire dispatch

**Goal:** When `--show-prompt-and-exit` is set, branch in `src/index.ts` BEFORE `loadConfigOrThrow` and `requireLlmCapableOrThrow`. The function reads the card, renders the context tree, resolves the project prompt, calls `buildSystemPrompt`, and writes the introspect output to stdout.

**Files:**
- Create: `src/cli/show-prompt.ts`
- Modify: `src/index.ts`
- Create: `test/cli/show-prompt-and-exit.test.ts`

- [ ] **Step 1: Write the integration test**

`test/cli/show-prompt-and-exit.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { spawnSync } from "child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const ENTRY = join(REPO_ROOT, "src", "index.ts");

function setupProject(): { dir: string; cardPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "gauntlet-spae-"));
  mkdirSync(join(dir, ".gauntlet", "context"), { recursive: true });
  writeFileSync(join(dir, ".gauntlet", "context", "HOW-TO-LOGIN.md"), "Use email and password.", "utf-8");
  const cardPath = join(dir, "card.md");
  writeFileSync(cardPath, [
    "---",
    "id: spae-001",
    "title: Test card",
    "---",
    "",
    "## Acceptance Criteria",
    "- Logged in",
    "",
  ].join("\n"), "utf-8");
  return { dir, cardPath };
}

describe("--show-prompt-and-exit", () => {
  test("exits 0 and prints all section headers", () => {
    const { dir, cardPath } = setupProject();
    try {
      const r = spawnSync("bun", [
        ENTRY, "run", cardPath,
        "--target", "http://x",
        "--project-dir", dir,
        "--show-prompt-and-exit",
      ], { encoding: "utf-8" });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("Persona");
      expect(r.stdout).toContain("Scenario");
      expect(r.stdout).toContain("Evaluation");
      expect(r.stdout).toContain("Adapter (web)");
      expect(r.stdout).toContain("Project");
      expect(r.stdout).toContain("Context");
      expect(r.stdout).toContain("Tools");
      expect(r.stdout).toContain("Initial user message");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--project-prompt is included in the output", () => {
    const { dir, cardPath } = setupProject();
    const extra = join(dir, "extra.md");
    writeFileSync(extra, "PROJECT_AUGMENT_MARKER", "utf-8");
    try {
      const r = spawnSync("bun", [
        ENTRY, "run", cardPath,
        "--target", "http://x",
        "--project-dir", dir,
        "--project-prompt", extra,
        "--show-prompt-and-exit",
      ], { encoding: "utf-8" });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("PROJECT_AUGMENT_MARKER");
      expect(r.stdout).toContain("(caller-supplied)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("absent Project shows (none)", () => {
    const { dir, cardPath } = setupProject();
    try {
      const r = spawnSync("bun", [
        ENTRY, "run", cardPath,
        "--target", "http://x",
        "--project-dir", dir,
        "--show-prompt-and-exit",
      ], { encoding: "utf-8" });
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/Project.*\(none\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("missing card argument exits non-zero", () => {
    const r = spawnSync("bun", [ENTRY, "run", "--target", "http://x", "--show-prompt-and-exit"], { encoding: "utf-8" });
    expect(r.status).not.toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/cli/show-prompt-and-exit.test.ts`
Expected: FAIL — `--show-prompt-and-exit` is parsed but does nothing.

- [ ] **Step 3: Implement `showPromptAndExit`**

`src/cli/show-prompt.ts`:

```ts
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { parseStoryCard } from "../format/story-card";
import { buildInitialUserMessage } from "../agent/initial-message";
import { renderContextTree } from "../context/tree";
import { resolveProjectPrompt } from "../runs/orchestrator";
import { loadPromptFile } from "../agent/prompts/loader";
import type { AdapterType } from "../adapters/adapter";

export interface ShowPromptOptions {
  scenarioPath: string;
  target: string;
  adapter: AdapterType;
  projectRoot: string;
  projectPromptPath?: string;
  viewport: string;
}

const SEP = "─".repeat(3);
function header(label: string, provenance: string): string {
  return `${SEP} ${label} ${"─".repeat(Math.max(2, 24 - label.length))}  ${provenance}`;
}
function asciiHeader(label: string, provenance: string): string {
  return `--- ${label} ${"-".repeat(Math.max(2, 24 - label.length))}  ${provenance}`;
}

export function showPromptAndExit(opts: ShowPromptOptions): void {
  const useAscii = process.env.NO_COLOR !== undefined || !process.stdout.isTTY;
  const h = useAscii ? asciiHeader : header;

  const card = parseStoryCard(readFileSync(opts.scenarioPath, "utf-8"));
  const contextRoot = join(opts.projectRoot, ".gauntlet", "context");
  const contextTree = existsSync(contextRoot) ? renderContextTree(contextRoot) : "";
  const projectPrompt = resolveProjectPrompt(opts.projectRoot, opts.projectPromptPath);

  // We do NOT actually start the adapter — we only need its name and the
  // describeTarget()/toolDefinitions() contracts. Use a static surrogate
  // built from the adapter type.
  const adapterStub = adapterStubFor(opts.adapter, opts.viewport);

  const out: string[] = [];

  out.push(h("Persona", `src/agent/prompts/persona.md`));
  out.push(loadPromptFile("persona"));
  out.push("");

  out.push(h("Scenario", `(from card: ${opts.scenarioPath})`));
  out.push(scenarioForCard(card));
  out.push("");

  out.push(h("Evaluation", `src/agent/prompts/evaluation.md`));
  out.push(loadPromptFile("evaluation"));
  out.push("");

  const adapterFile = `src/agent/prompts/adapter-${opts.adapter}.md`;
  const adapterBody = loadPromptFile(`adapter-${opts.adapter}`);
  out.push(h(`Adapter (${opts.adapter})`, adapterFile));
  out.push(adapterBody.length > 0 ? adapterBody : "(empty file)");
  out.push("");

  if (projectPrompt) {
    const provenance = opts.projectPromptPath
      ? `${opts.projectPromptPath}   (caller-supplied)`
      : `${join(opts.projectRoot, ".gauntlet", "project.md")}   (default)`;
    out.push(h("Project", provenance));
    out.push(projectPrompt);
  } else {
    out.push(h("Project", "(none)"));
  }
  out.push("");

  if (contextTree.length > 0) {
    out.push(h("Context", `src/agent/prompts/context.md + ${contextRoot}`));
    out.push(loadPromptFile("context").replace("{{TREE_LISTING}}", contextTree));
  } else {
    out.push(h("Context", "(none)"));
  }
  out.push("");

  out.push(h("Tools", `(from adapter: ${opts.adapter})`));
  for (const t of adapterStub.tools) {
    out.push(`- ${t.name}: ${t.summary}`);
  }
  out.push("");

  out.push(h("Initial user message", "(from adapter.describeTarget)"));
  out.push(buildInitialUserMessage(adapterStub.describer, opts.target));
  out.push("");

  process.stdout.write(out.join("\n"));
}

function scenarioForCard(card: ReturnType<typeof parseStoryCard>): string {
  // Mirror the structure that buildSystemPrompt emits for the Scenario block.
  const lines: string[] = [];
  lines.push("## Story Card");
  lines.push(`**ID:** ${card.id}`);
  lines.push(`**Title:** ${card.title}`);
  if (card.stakeholder) lines.push(`**Stakeholder:** ${card.stakeholder}`);
  lines.push("");
  lines.push(card.description);
  if (card.acceptanceCriteria.length > 0) {
    lines.push("");
    lines.push("## Acceptance Criteria");
    for (const c of card.acceptanceCriteria) lines.push(`- ${c}`);
  }
  return lines.join("\n");
}

interface AdapterStub {
  tools: { name: string; summary: string }[];
  describer: { describeTarget(target: string): string };
}

function adapterStubFor(name: AdapterType, viewport: string): AdapterStub {
  // Inline static descriptions per adapter. These mirror what a started
  // adapter would expose; we duplicate the strings here to avoid spinning
  // up a real adapter (Chrome, tmux, etc.) just for introspection.
  switch (name) {
    case "web":
      return {
        tools: [
          { name: "click(selector)", summary: "click an element matching a CSS selector" },
          { name: "type(selector, text)", summary: "type text into an input" },
          { name: "screenshot()", summary: "capture the current viewport" },
          { name: "navigate(url)", summary: "navigate the active tab to a URL" },
          { name: "new_tab(url)", summary: "open a URL in a new side tab" },
          { name: "close_tab()", summary: "close the active side tab" },
          { name: "read(path)", summary: "read a file from .gauntlet/context/" },
          { name: "report_result(...)", summary: "submit final verdict and observations" },
        ],
        describer: { describeTarget: (t: string) => `Begin by opening ${t} in a Chromium browser at ${viewport}.` },
      };
    case "cli":
      return {
        tools: [
          { name: "exec(command)", summary: "run a shell command and return output" },
          { name: "read(path)", summary: "read a file from .gauntlet/context/" },
          { name: "report_result(...)", summary: "submit final verdict and observations" },
        ],
        describer: { describeTarget: (t: string) => `Begin by invoking ${t}.` },
      };
    case "tui":
      return {
        tools: [
          { name: "send_keys(keys)", summary: "send keystrokes to the TUI" },
          { name: "screenshot()", summary: "capture current TUI state" },
          { name: "read(path)", summary: "read a file from .gauntlet/context/" },
          { name: "report_result(...)", summary: "submit final verdict and observations" },
        ],
        describer: { describeTarget: (t: string) => `Begin by launching ${t} in a tmux pane.` },
      };
  }
}
```

**Note on adapter stubs:** the tool-name lists and describeTarget strings duplicate what each adapter exposes at runtime. This duplication is acceptable because (a) showPromptAndExit must work without launching adapters, and (b) the lists are small and stable. If they drift out of sync, an integration test will catch it (Task 13 step 4 below).

- [ ] **Step 4: Wire the early-exit branch in `src/index.ts`**

In `src/index.ts`, modify the `case "run"` block:

```ts
    case "run": {
      if (args.showPromptAndExit) {
        const { showPromptAndExit } = await import("./cli/show-prompt");
        // Resolve project root from CLI flag or env, with cwd fallback.
        // Mirror the resolution loadConfig does for projectRoot only —
        // we don't need the full AppConfig (no LLM creds required).
        const projectRoot = args.cli.projectRoot ?? process.env.GAUNTLET_PROJECT_ROOT ?? process.cwd();
        const viewport = args.cli.viewport ?? "1440x900";
        showPromptAndExit({
          scenarioPath: args.scenarioPath,
          target: args.cli.target ?? "",
          adapter: args.adapter,
          projectRoot,
          projectPromptPath: args.projectPromptPath,
          viewport,
        });
        break;
      }
      const config = await loadConfigOrThrow(args.cli);
      await requireLlmCapableOrThrow(config);
      // ... existing run dispatch unchanged ...
    }
```

The early-exit branch runs BEFORE `loadConfigOrThrow` so it works without `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`.

- [ ] **Step 5: Run the integration tests**

Run: `bun test test/cli/show-prompt-and-exit.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Run the full suite**

Run: `bun test`
Expected: PASS.

- [ ] **Step 7: Manual smoke**

Write a temporary card and run the introspect from the repo:

```bash
cat > /tmp/spae-smoke.md <<'EOF'
---
id: smoke-001
title: Smoke
---

## Acceptance Criteria
- ok
EOF
bun src/index.ts run /tmp/spae-smoke.md --target http://localhost --show-prompt-and-exit | head -80
```

Verify visually that all 8 section headers appear (Persona, Scenario, Evaluation, Adapter, Project, Context, Tools, Initial user message) and bodies look correct.

- [ ] **Step 8: Commit**

```bash
git add src/cli/show-prompt.ts src/index.ts test/cli/show-prompt-and-exit.test.ts
git commit -m "feat(cli): --show-prompt-and-exit renders composed prompt with provenance"
```

---

### Task 14: Bun-binary smoke — verify `import.meta.dir` resolution outside the build tree

**Goal:** Compile the binary, copy it to a fresh directory, run `--show-prompt-and-exit`, and confirm the `.md` files load correctly. This validates the production deployment story.

**Files:**
- Create: `test/cli/binary-smoke.test.ts` (slow test, opt-in via env var)

- [ ] **Step 1: Write the smoke test**

`test/cli/binary-smoke.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { spawnSync } from "child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const SHOULD_RUN = process.env.RUN_BINARY_SMOKE === "1";

describe.if(SHOULD_RUN)("compiled binary --show-prompt-and-exit", () => {
  test("works from a directory outside the build tree", () => {
    const buildDir = mkdtempSync(join(tmpdir(), "gauntlet-bin-build-"));
    const runDir = mkdtempSync(join(tmpdir(), "gauntlet-bin-run-"));
    try {
      const binPath = join(buildDir, "gauntlet");
      const compile = spawnSync("bun", ["build", "--compile", "./src/index.ts", "--outfile", binPath], {
        cwd: REPO_ROOT,
        encoding: "utf-8",
      });
      expect(compile.status).toBe(0);
      expect(existsSync(binPath)).toBe(true);

      // Set up a fresh project in runDir
      mkdirSync(join(runDir, ".gauntlet", "context"), { recursive: true });
      writeFileSync(join(runDir, ".gauntlet", "context", "x.md"), "x", "utf-8");
      const cardPath = join(runDir, "card.md");
      writeFileSync(cardPath, "---\nid: bs-001\ntitle: Smoke\n---\n\n## Acceptance Criteria\n- ok\n", "utf-8");

      const r = spawnSync(binPath, [
        "run", cardPath,
        "--target", "http://x",
        "--project-dir", runDir,
        "--show-prompt-and-exit",
      ], { cwd: runDir, encoding: "utf-8" });

      expect(r.status).toBe(0);
      expect(r.stdout).toContain("You are a thorough QA tester");  // Persona body
      expect(r.stdout).toContain("Side trips for sign-in flows");  // Adapter web body
    } finally {
      rmSync(buildDir, { recursive: true, force: true });
      rmSync(runDir, { recursive: true, force: true });
    }
  }, 120_000);  // compilation can take ~30s on cold cache
});
```

- [ ] **Step 2: Run the smoke test explicitly**

Run: `RUN_BINARY_SMOKE=1 bun test test/cli/binary-smoke.test.ts`
Expected: PASS — compiled binary loads `.md` files from its bundle and runs from a foreign cwd.

If it fails because `import.meta.dir` resolves to the wrong path inside the compiled binary, switch the loader to use Bun's `Bun.file` API or embed the prompts via `import "./prompts/persona.md" with { type: "text" }`. The fix lives in `src/agent/prompts/loader.ts` and `src/cli/show-prompt.ts`'s `loadFile` helper.

- [ ] **Step 3: Verify the test is skipped without the env var**

Run: `bun test test/cli/binary-smoke.test.ts`
Expected: 0 tests run (gated behind `RUN_BINARY_SMOKE=1`).

- [ ] **Step 4: Commit**

```bash
git add test/cli/binary-smoke.test.ts
git commit -m "test(cli): binary smoke for --show-prompt-and-exit (RUN_BINARY_SMOKE=1)"
```

---

### Task 15: Update CLI usage text

**Goal:** Document the new flags in `gauntlet --help` / `usage()`.

**Files:**
- Modify: `src/cli/args.ts` (the `usage()` function)

- [ ] **Step 1: Add the two flags to the `run` block of `usage()`**

In `src/cli/args.ts`, find the `usage()` function (~line 402). In the `run <story.md>` section, add:

```
    --project-prompt <path> Caller-supplied augmentation prompt (overrides .gauntlet/project.md)
    --show-prompt-and-exit  Print the composed system prompt with provenance and exit (no Chrome, no LLM call)
```

- [ ] **Step 2: Verify the help output**

Run: `bun src/index.ts 2>&1 | head -40` (running with no command prints usage)

Expected: the new flags appear under `run <story.md>`.

- [ ] **Step 3: Commit**

```bash
git add src/cli/args.ts
git commit -m "docs(cli): document --project-prompt and --show-prompt-and-exit in usage"
```

---

## Self-Review

After completing the plan above, verify:

**Spec coverage:**
- ✓ Extract Persona, Evaluation, Adapter, Context to `.md` files (Tasks 3, 4, 5, 6)
- ✓ Loader with hygiene (Task 2)
- ✓ Block hygiene + `\n\n` joiner (Task 7)
- ✓ Project parameter (Task 8)
- ✓ Project resolution with explicit/default/missing semantics (Task 9)
- ✓ `--project-prompt` CLI flag (Task 10)
- ✓ `--show-prompt-and-exit` CLI flag and dispatch (Tasks 11, 12, 13)
- ✓ `buildInitialUserMessage` extraction for honest introspect output (Task 11)
- ✓ Tools and Initial user message blocks in introspect (Task 13)
- ✓ Bun-binary smoke (Task 14)
- ✓ Snapshot baseline + sequencing (Task 1, regenerated in Task 7)
- ✓ Evidence-log preservation (Task 7 step 7)
- ✓ Help text (Task 15)

**Type consistency:**
- `projectPromptPath?: string` propagates: `RunArgs` (Task 10) → `RunOptions` in `src/cli/run.ts` (Task 10) → `RunOneOptions` (Task 10) → `ExecuteRunCoreOptions` (Task 9) → resolved to `projectPrompt: string | undefined` and passed to `runAgent` via `AgentOptions` (Task 9 step 3) → `buildSystemPrompt` (Task 8).
- `showPromptAndExit: boolean` lives only on `RunArgs`; consumed at the dispatch point in `src/index.ts` (Task 13).

**No placeholders:** every step has the actual code or command. The one open question — Bun-binary `import.meta.dir` resolution — is addressed by an actual smoke test (Task 14) with a documented fallback path if it fails.

---

## Out of Scope (per spec)

- Project as a directory (`.gauntlet/prompts.d/`)
- `--show-prompt-and-continue` variant
- Web-product introspection route
- Per-card prompt overrides
- `--project-prompt` for `batch` (the plan explicitly excludes it from `BATCH_ALLOWED`)
- Templating inside `.md` files
- Caching loaded prompt files
