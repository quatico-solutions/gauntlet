# Hermetic Run Snapshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Snapshot each run's story and context tree into `<runDir>/inputs/` at run start so history views and future post-hoc chat see the world as the agent saw it.

**Architecture:** A new helper `snapshotRunInputs` writes `story.md` from the in-memory story bytes and recursively copies `.gauntlet/context/` into `<runDir>/inputs/context/`. The CLI and API run flows call it once, synchronously, before the adapter is constructed, then pass `<runDir>/inputs/context/` as the `contextRoot` to every downstream consumer (read-tool, passkey tool, context-tree renderer).

**Tech Stack:** TypeScript, Bun runtime, `bun:test`. Node `fs` sync APIs (`cpSync`, `mkdirSync`, `writeFileSync`).

**Spec reference:** `docs/superpowers/specs/2026-04-22-hermetic-run-snapshots-design.md`

---

## File Structure

**New files:**
- `src/runs/snapshot.ts` — exports `snapshotRunInputs({ runDir, storyContent, contextRoot })`. Pure I/O; no knowledge of story-card parsing, adapters, or agent internals.
- `test/runs/snapshot.test.ts` — unit tests for the helper (populated context, empty/missing context, byte-identity, directory structure).

**Modified files:**
- `src/cli/run.ts` — call `snapshotRunInputs` after `runId`/`outDir` are decided; swap `contextRoot` from `.gauntlet/context/` to `<outDir>/inputs/context/`.
- `src/api/routes/run.ts` — same wiring in the `POST /run/:id` handler, with the story content re-read once through `findCard`'s returned path so the snapshot matches what the card was parsed from.
- `test/cli/snapshot.test.ts` — new integration test invoking `run()` end-to-end and asserting the snapshot tree.
- `test/api/routes/run-snapshot.test.ts` — new integration test POSTing to the route and asserting the snapshot tree.

**Unchanged:**
- `src/context/read-tool.ts`, `src/adapters/web/passkey.ts`, `src/adapters/*/adapter.ts`, `src/context/tree.ts`. They all receive `contextRoot` by argument; the root swap at the caller is transparent to them.

---

## Task 1: Snapshot helper module

**Files:**
- Create: `src/runs/snapshot.ts`
- Create: `test/runs/snapshot.test.ts`

### Step 1.1: Write failing test — writes story.md with exact bytes

- [ ] **Step 1.1.1: Write the test**

Create `test/runs/snapshot.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { snapshotRunInputs } from "../../src/runs/snapshot";

describe("snapshotRunInputs", () => {
  test("writes story.md with exact bytes", () => {
    const tmp = mkdtempSync(join(tmpdir(), "gauntlet-snap-"));
    try {
      const runDir = join(tmp, "run");
      mkdirSync(runDir);
      const contextRoot = join(tmp, "ctx");
      mkdirSync(contextRoot);
      const storyContent = "---\nid: story-1\n---\n# Title\n\nBody with emoji 🧪.\n";

      snapshotRunInputs({ runDir, storyContent, contextRoot });

      const storyPath = join(runDir, "inputs", "story.md");
      expect(existsSync(storyPath)).toBe(true);
      expect(readFileSync(storyPath, "utf-8")).toBe(storyContent);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 1.1.2: Run it — expect FAIL ("module not found")**

```
bun test test/runs/snapshot.test.ts
```

Expected: error — `Cannot find module '../../src/runs/snapshot'`.

- [ ] **Step 1.1.3: Create the module with minimal impl**

Create `src/runs/snapshot.ts`:

```ts
import { mkdirSync, writeFileSync, cpSync, readdirSync, statSync } from "fs";
import { join } from "path";

export interface SnapshotInputs {
  /** Absolute path to the run output directory (`.gauntlet/results/<runId>`). */
  runDir: string;
  /** Exact bytes of the resolved story file, as the caller already read them. */
  storyContent: string;
  /**
   * Absolute path to the *source* context root (`.gauntlet/context/`). Copied
   * recursively to `<runDir>/inputs/context/`. If the source is missing or
   * empty, an empty `inputs/context/` is created — matching the existing
   * "degrade gracefully when no context is present" semantics.
   */
  contextRoot: string;
}

/**
 * Snapshot a run's inputs into `<runDir>/inputs/` so history views and future
 * resumed-chat sessions see the world as the agent saw it at run start.
 *
 * Synchronous and idempotent within a fresh run directory. Callers run this
 * exactly once, before adapter construction.
 */
export function snapshotRunInputs(opts: SnapshotInputs): void {
  const inputsDir = join(opts.runDir, "inputs");
  mkdirSync(inputsDir, { recursive: true });

  writeFileSync(join(inputsDir, "story.md"), opts.storyContent, "utf-8");

  const destContext = join(inputsDir, "context");
  mkdirSync(destContext, { recursive: true });
  if (sourceIsPopulated(opts.contextRoot)) {
    cpSync(opts.contextRoot, destContext, { recursive: true });
  }
}

function sourceIsPopulated(root: string): boolean {
  try {
    const stat = statSync(root);
    if (!stat.isDirectory()) return false;
    return readdirSync(root).length > 0;
  } catch {
    return false;
  }
}
```

- [ ] **Step 1.1.4: Run test — expect PASS**

```
bun test test/runs/snapshot.test.ts
```

Expected: 1 pass.

### Step 1.2: Test — copies a populated context tree verbatim

- [ ] **Step 1.2.1: Add the test**

Append inside the same `describe` block in `test/runs/snapshot.test.ts`:

```ts
  test("copies a populated context tree verbatim", () => {
    const tmp = mkdtempSync(join(tmpdir(), "gauntlet-snap-"));
    try {
      const runDir = join(tmp, "run");
      mkdirSync(runDir);
      const contextRoot = join(tmp, "ctx");
      mkdirSync(join(contextRoot, "matt"), { recursive: true });
      writeFileSync(join(contextRoot, "matt", "identity.md"), "name: matt");
      writeFileSync(
        join(contextRoot, "matt", "passkey.json"),
        JSON.stringify({ credentialId: "abc" }),
      );
      mkdirSync(join(contextRoot, "alice"), { recursive: true });
      writeFileSync(join(contextRoot, "alice", "identity.md"), "name: alice");

      snapshotRunInputs({ runDir, storyContent: "story", contextRoot });

      const snapCtx = join(runDir, "inputs", "context");
      expect(readFileSync(join(snapCtx, "matt", "identity.md"), "utf-8")).toBe("name: matt");
      expect(JSON.parse(readFileSync(join(snapCtx, "matt", "passkey.json"), "utf-8")))
        .toEqual({ credentialId: "abc" });
      expect(readFileSync(join(snapCtx, "alice", "identity.md"), "utf-8")).toBe("name: alice");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
```

- [ ] **Step 1.2.2: Run — expect PASS**

```
bun test test/runs/snapshot.test.ts
```

Expected: 2 pass.

### Step 1.3: Test — empty source yields empty inputs/context/

- [ ] **Step 1.3.1: Add the test**

Append inside the same `describe` block:

```ts
  test("empty source context yields an empty inputs/context/", () => {
    const tmp = mkdtempSync(join(tmpdir(), "gauntlet-snap-"));
    try {
      const runDir = join(tmp, "run");
      mkdirSync(runDir);
      const contextRoot = join(tmp, "ctx");
      mkdirSync(contextRoot);

      snapshotRunInputs({ runDir, storyContent: "story", contextRoot });

      const snapCtx = join(runDir, "inputs", "context");
      expect(existsSync(snapCtx)).toBe(true);
      expect(readdirSync(snapCtx)).toEqual([]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
```

(Add `readdirSync` to the top-of-file `fs` import.)

- [ ] **Step 1.3.2: Run — expect PASS**

```
bun test test/runs/snapshot.test.ts
```

Expected: 3 pass.

### Step 1.4: Test — missing source path yields empty inputs/context/

- [ ] **Step 1.4.1: Add the test**

```ts
  test("missing source context yields an empty inputs/context/", () => {
    const tmp = mkdtempSync(join(tmpdir(), "gauntlet-snap-"));
    try {
      const runDir = join(tmp, "run");
      mkdirSync(runDir);
      const contextRoot = join(tmp, "does-not-exist");

      snapshotRunInputs({ runDir, storyContent: "story", contextRoot });

      const snapCtx = join(runDir, "inputs", "context");
      expect(existsSync(snapCtx)).toBe(true);
      expect(readdirSync(snapCtx)).toEqual([]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
```

- [ ] **Step 1.4.2: Run — expect PASS**

Expected: 4 pass.

### Step 1.5: Test — creates runDir/inputs if runDir is bare

- [ ] **Step 1.5.1: Add the test**

```ts
  test("creates inputs/ even when runDir does not exist yet", () => {
    const tmp = mkdtempSync(join(tmpdir(), "gauntlet-snap-"));
    try {
      const runDir = join(tmp, "not-yet", "run-xyz");
      const contextRoot = join(tmp, "ctx");
      mkdirSync(contextRoot);

      snapshotRunInputs({ runDir, storyContent: "story", contextRoot });

      expect(existsSync(join(runDir, "inputs", "story.md"))).toBe(true);
      expect(existsSync(join(runDir, "inputs", "context"))).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
```

- [ ] **Step 1.5.2: Run — expect PASS**

Expected: 5 pass.

### Step 1.6: Commit

- [ ] **Step 1.6.1: Commit**

```
git add src/runs/snapshot.ts test/runs/snapshot.test.ts
git commit -m "$(cat <<'EOF'
feat(runs): add snapshotRunInputs helper

Writes <runDir>/inputs/story.md from in-memory bytes and copies the
full .gauntlet/context/ tree recursively. Missing/empty source
context yields an empty inputs/context/, matching existing
degrade-gracefully semantics.
EOF
)"
```

---

## Task 2: Wire snapshot into the CLI run flow

**Files:**
- Modify: `src/cli/run.ts` — lines 22–106 (the whole `run` function body)
- Create: `test/cli/snapshot.test.ts`

### Step 2.1: Write failing integration test

- [ ] **Step 2.1.1: Write the test**

Create `test/cli/snapshot.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { run } from "../../src/cli/run";
import { gauntletPath } from "../../src/paths";
import type { AppConfig } from "../../src/config";

function makeConfig(projectRoot: string): AppConfig {
  // Minimal AppConfig sufficient for the CLIAdapter path. The agent is
  // driven by the `echo` provider — see test/fixtures/echo-app.sh and
  // existing cli tests for the pattern.
  return {
    projectRoot,
    models: { agent: "echo", available: [] },
    sources: { defaultChrome: "default" },
    defaultChrome: undefined,
    defaultViewport: undefined,
    defaultTurns: 1,
  } as unknown as AppConfig;
}

describe("CLI run — snapshot", () => {
  test("writes story.md and context/ into <runDir>/inputs/", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "gauntlet-cli-snap-"));
    try {
      // Seed stories dir
      const storiesDir = gauntletPath(projectRoot, "stories");
      mkdirSync(storiesDir, { recursive: true });
      const storyBody =
        "---\nid: snap-story\ntitle: Snap Story\n---\n" +
        "# Snap Story\n\nBody.\n\n## Acceptance Criteria\n- passes\n";
      const storyPath = join(storiesDir, "snap-story.md");
      writeFileSync(storyPath, storyBody);

      // Seed context dir
      const ctxRoot = gauntletPath(projectRoot, "context");
      mkdirSync(join(ctxRoot, "matt"), { recursive: true });
      writeFileSync(join(ctxRoot, "matt", "identity.md"), "name: matt");

      // Known outDir so we can assert on it
      const outDir = join(projectRoot, "run-out");

      await run({
        scenarioPath: storyPath,
        target: "cli:echo",
        outDir,
        adapterType: "cli",
        config: makeConfig(projectRoot),
      });

      const inputsDir = join(outDir, "inputs");
      expect(existsSync(inputsDir)).toBe(true);
      expect(readFileSync(join(inputsDir, "story.md"), "utf-8")).toBe(storyBody);
      expect(readFileSync(join(inputsDir, "context", "matt", "identity.md"), "utf-8"))
        .toBe("name: matt");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("snapshot is immutable — editing source story mid-setup does not affect snapshot", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "gauntlet-cli-snap-"));
    try {
      const storiesDir = gauntletPath(projectRoot, "stories");
      mkdirSync(storiesDir, { recursive: true });
      const original =
        "---\nid: snap-story\ntitle: Original\n---\n# Original\n\nBody.\n";
      const storyPath = join(storiesDir, "snap-story.md");
      writeFileSync(storyPath, original);

      const ctxRoot = gauntletPath(projectRoot, "context");
      mkdirSync(ctxRoot);

      const outDir = join(projectRoot, "run-out");
      const runPromise = run({
        scenarioPath: storyPath,
        target: "cli:echo",
        outDir,
        adapterType: "cli",
        config: makeConfig(projectRoot),
      });

      // Mutate the source AFTER run() starts. The snapshot must already
      // reflect `original`, not this revision.
      writeFileSync(storyPath, "---\nid: snap-story\ntitle: Mutated\n---\n# Mutated\n");
      await runPromise;

      expect(readFileSync(join(outDir, "inputs", "story.md"), "utf-8")).toBe(original);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2.1.2: Run — expect FAIL**

```
bun test test/cli/snapshot.test.ts
```

Expected: FAIL — `inputs/` directory does not exist. (`run()` is not yet calling the snapshot helper.)

**Note:** if the `echo`-backed test harness is not available in this project, use whatever minimal client fixture the other `src/cli/*` tests already use — `test/cli/args.test.ts`, `test/cli/validate.test.ts` — rather than inventing a new one. The key behavior under test is the snapshot, not the agent loop.

### Step 2.2: Wire the snapshot call

- [ ] **Step 2.2.1: Update `src/cli/run.ts`**

Replace lines 28–41 (from `const content = readFileSync(...)` through `const contextTree = renderContextTree(contextRoot);`) with:

```ts
  const content = readFileSync(scenarioPath, "utf-8");
  const card = parseStoryCard(content);
  // Generate runId first so we can derive the default outDir. Mirrors
  // the serve path (src/api/routes/run.ts): `gauntletPath(projectRoot,
  // "results", runId)` is the canonical run output location; `--out`
  // stays available as an explicit override for ad-hoc debugging.
  const runId = makeRunId(card.id);
  const outDir = opts.outDir ?? gauntletPath(config.projectRoot, "results", runId);
  const logger = new EvidenceLogger(outDir);
  const client = createClient(config.models.agent);
  // Snapshot story + context into <outDir>/inputs/ before anything reads
  // the context. Every downstream consumer (read-tool, passkey tool,
  // context-tree renderer) uses the snapshotted root, so the agent sees
  // a frozen view even if the source files change during the run.
  snapshotRunInputs({
    runDir: outDir,
    storyContent: content,
    contextRoot: gauntletPath(config.projectRoot, "context"),
  });
  const contextRoot = join(outDir, "inputs", "context");
  // Render the tree **once per run** — the immutability invariant
  // (spec §4.2) forbids re-rendering during the run.
  const contextTree = renderContextTree(contextRoot);
```

Then add at the top of the file:

```ts
import { join } from "path";
import { snapshotRunInputs } from "../runs/snapshot";
```

- [ ] **Step 2.2.2: Run test — expect PASS (both cases)**

```
bun test test/cli/snapshot.test.ts
```

Expected: 2 pass.

- [ ] **Step 2.2.3: Run the pre-existing CLI-adjacent tests — expect UNCHANGED**

```
bun test test/cli test/context test/adapters/cli
```

Expected: all still green. The snapshot is additive; the root swap is transparent because every consumer was already taking `contextRoot` by argument.

### Step 2.3: Commit

- [ ] **Step 2.3.1: Commit**

```
git add src/cli/run.ts test/cli/snapshot.test.ts
git commit -m "$(cat <<'EOF'
feat(cli): snapshot story + context into run dir before agent start

CLI run flow now calls snapshotRunInputs after outDir is decided and
swaps contextRoot to <outDir>/inputs/context/ for downstream consumers
(read-tool, passkey tool, context-tree renderer). Behavior live is
unchanged — only the root shifts.
EOF
)"
```

---

## Task 3: Wire snapshot into the API run flow

**Files:**
- Modify: `src/api/routes/run.ts` — the `POST /:id` handler and its direct helpers
- Modify: `src/cards/store.ts` — `findCard` currently returns `{ card, filename }`; the route needs the absolute path (or the raw bytes) to snapshot faithfully.
- Create: `test/api/routes/run-snapshot.test.ts`

### Step 3.1: Expose the raw story content through findCard

The spec requires the snapshot to be byte-identical to what the card was parsed from. `findCard` already reads the bytes but throws them away. The minimal change is to also return them.

- [ ] **Step 3.1.1: Update `CardEntry` and both return sites**

In `src/cards/store.ts`, replace the `CardEntry` interface and the two return sites:

```ts
export interface CardEntry {
  card: StoryCard;
  filename: string;
  /** Raw file bytes, as `parseStoryCard` was given them. */
  raw: string;
}
```

In the direct-hit branch (around line 32–41):

```ts
  if (existsSync(directPath)) {
    const content = readFileSync(directPath, "utf-8");
    const card = parseStoryCard(content);
    if (card.id === id) {
      return { card, filename: `${id}.md`, raw: content };
    }
  }
```

In the scan branch (`loadAllCards`, around line 64–70):

```ts
    try {
      const content = readFileSync(join(storiesDir, filename), "utf-8");
      entries.push({ card: parseStoryCard(content), filename, raw: content });
    } catch (err) {
```

- [ ] **Step 3.1.2: Run the cards tests — expect PASS**

```
bun test test/cards
```

Expected: green. (Existing tests key off `card.*` and `filename`; adding a field is additive.)

### Step 3.2: Write failing route integration test

- [ ] **Step 3.2.1: Write the test**

Create `test/api/routes/run-snapshot.test.ts`. Mirror the structure used by `test/api/results.test.ts` (already uses `mkdtempSync` + `gauntletPath` to construct a minimal project root):

```ts
import { describe, test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Hono } from "hono";
import { runRoutes } from "../../../src/api/routes/run";
import { gauntletPath } from "../../../src/paths";
import type { AppConfig } from "../../../src/config";
import type { LLMClient } from "../../../src/models/provider";

function stubClient(): LLMClient {
  // Minimal client that terminates the agent loop immediately.
  // Matches the existing test-client pattern used elsewhere in test/api/.
  return {
    async chat() {
      return {
        stopReason: "end_turn",
        content: [{ type: "text", text: "done" }],
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
  } as unknown as LLMClient;
}

describe("POST /run/:id — snapshot", () => {
  test("writes <runDir>/inputs/{story.md,context/} before executeRun", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "gauntlet-api-snap-"));
    try {
      const storiesDir = gauntletPath(projectRoot, "stories");
      mkdirSync(storiesDir, { recursive: true });
      const storyBody =
        "---\nid: snap-story\ntitle: Snap\n---\n# Snap\n\nBody.\n";
      writeFileSync(join(storiesDir, "snap-story.md"), storyBody);

      const ctxRoot = gauntletPath(projectRoot, "context");
      mkdirSync(join(ctxRoot, "matt"), { recursive: true });
      writeFileSync(join(ctxRoot, "matt", "identity.md"), "name: matt");

      const config: AppConfig = {
        projectRoot,
        models: { agent: "stub", available: [] },
        sources: { defaultChrome: "default" },
        defaultChrome: undefined,
        defaultViewport: undefined,
        defaultTurns: 1,
      } as unknown as AppConfig;

      const app = new Hono();
      app.route("/run", runRoutes(config, undefined, undefined, undefined));
      // Override client factory. If runRoutes doesn't accept an injection
      // point today, add a minimal factory parameter mirroring what
      // fanoutRoutes already does (src/api/routes/fanout.ts). See note below.

      const res = await app.request("/run/snap-story", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: "cli:echo" }),
      });
      expect(res.status).toBe(202);
      const body = (await res.json()) as { runId: string };

      // Snapshot is synchronous in the request handler (before the
      // detached executeRun), so it MUST be present as soon as the
      // response is returned.
      const runDir = gauntletPath(projectRoot, "results", body.runId);
      expect(existsSync(join(runDir, "inputs", "story.md"))).toBe(true);
      expect(readFileSync(join(runDir, "inputs", "story.md"), "utf-8")).toBe(storyBody);
      expect(readFileSync(join(runDir, "inputs", "context", "matt", "identity.md"), "utf-8"))
        .toBe("name: matt");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
```

**Client injection note:** `runRoutes` uses `createClient(effective.model)` internally (line 79). If existing API tests already have a pattern for substituting a non-network client (see `test/api/` for reference), follow that pattern. If not, accept a `clientFactory?: (model: string) => LLMClient` parameter on `runRoutes` identical in shape to what `fanoutRoutes` already accepts, and thread it through. Do not add a network mock library.

- [ ] **Step 3.2.2: Run the test — expect FAIL**

```
bun test test/api/routes/run-snapshot.test.ts
```

Expected: FAIL — `inputs/story.md` not found.

### Step 3.3: Wire the snapshot into `POST /run/:id`

- [ ] **Step 3.3.1: Modify `src/api/routes/run.ts`**

Add imports at the top of the file:

```ts
import { snapshotRunInputs } from "../../runs/snapshot";
```

Replace the `runRoutes` handler body (lines 56–146) so that, between the `runId` creation and `createAdapter`, the snapshot runs and `contextRoot` is swapped:

```ts
    const runId = makeRunId(entry.card.id);
    const outDir = gauntletPath(config.projectRoot, "results", runId);
    // Snapshot story + context into <outDir>/inputs/ synchronously,
    // before the adapter, the tree renderer, or the detached
    // executeRun touch anything. Downstream consumers then see the
    // snapshotted paths.
    snapshotRunInputs({
      runDir: outDir,
      storyContent: entry.raw,
      contextRoot: gauntletPath(config.projectRoot, "context"),
    });
    const contextRoot = join(outDir, "inputs", "context");
    // Create the logger *before* the adapter so WebAdapter can open its
    // background observer session against it in start().
    const logger = new EvidenceLogger(outDir);
```

Remove the existing `const contextRoot = gauntletPath(config.projectRoot, "context");` on line 54 (lifted out of the outer scope into the per-request handler above).

Verify `join` is already imported at the top of the file (line 2).

- [ ] **Step 3.3.2: Run the snapshot test — expect PASS**

```
bun test test/api/routes/run-snapshot.test.ts
```

Expected: 1 pass.

- [ ] **Step 3.3.3: Run the full API test suite — expect UNCHANGED**

```
bun test test/api
```

Expected: all still green.

### Step 3.4: Commit

- [ ] **Step 3.4.1: Commit**

```
git add src/cards/store.ts src/api/routes/run.ts test/api/routes/run-snapshot.test.ts
git commit -m "$(cat <<'EOF'
feat(api): snapshot run inputs in POST /run/:id before dispatch

findCard now returns the raw story bytes alongside the parsed card, so
the snapshot is byte-identical to what parseStoryCard was given. The
snapshot runs synchronously in the handler — available before 202
returns — and contextRoot is swapped to <runDir>/inputs/context/ for
every downstream consumer.
EOF
)"
```

---

## Task 4: Full suite sanity + docs pointer

**Files:**
- Run the entire project test suite.
- Update `README.md` or `docs/format.md` if either documents the run directory layout — cross-check before editing.

### Step 4.1: Run the full test suite

- [ ] **Step 4.1.1: Run everything**

```
bun test
```

Expected: all green. If anything unrelated to this work fails, investigate whether it was already flaky on `main` (run `bun test` on `main` to compare) before assuming this change caused it.

### Step 4.2: Cross-check existing docs for layout references

- [ ] **Step 4.2.1: Check for docs that describe run layout**

```
rg -n "results/<runId>|results/.*runId|\\.gauntlet/results" README.md docs/ 2>/dev/null
```

- [ ] **Step 4.2.2: Update if needed**

If any doc enumerates the contents of a run directory, add `inputs/` alongside `screenshots/`, `frames/`, `run.jsonl`, etc. If no doc enumerates that layout, skip — don't invent documentation the project didn't have.

### Step 4.3: Commit docs (if any)

- [ ] **Step 4.3.1: Commit only if there were doc changes**

```
git add -A
git commit -m "docs: note inputs/ in run directory layout"
```

Skip if nothing changed.

---

## Self-Review Notes

**Spec coverage (each requirement maps to a task):**

| Spec section | Task |
|---|---|
| Layout (`inputs/story.md`, `inputs/context/`) | Task 1 |
| Snapshot timing (before adapter) | Tasks 2, 3 |
| Byte-for-byte story copy | Task 1.1, Task 3.1 (raw bytes through findCard) |
| Recursive context copy | Task 1.2 |
| Missing/empty context → empty `inputs/context/` | Tasks 1.3, 1.4 |
| Root-swap contract (read-tool, passkey, tree renderer) | Tasks 2.2, 3.3 |
| Story injection from snapshot | Implicit — the agent consumes the parsed `StoryCard` already in memory; `story.md` on disk is for history/resumed chat, not re-read during the run. Matches the design. |
| Resumed-chat forward compatibility | No task — spec explicitly says this is out of scope; the snapshot layout sets up the future change. |
| Testing: edit-during-run | Task 2.1 (second case). |

**Type consistency:** `snapshotRunInputs` signature is identical everywhere it's referenced. `CardEntry.raw` is the only new field; both `findCard` return sites and the new API test reference it with the same name.

**Placeholder scan:** No TBDs, no "handle edge cases", no references to undefined types. One "Note" (Task 3.2) points at adapting to whatever existing client-injection pattern the project uses — this is an intentional deference to existing convention, not a placeholder.

---

## Plan complete

Plan saved to `docs/superpowers/plans/2026-04-22-hermetic-run-snapshots.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
