# Hermetic Run Snapshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Snapshot each run's story and context tree into `<runDir>/inputs/` at run start so history views and future post-hoc chat see the world as the agent saw it.

**Architecture:** A new helper `snapshotRunInputs` copies the resolved story file to `<runDir>/inputs/story.md` and recursively copies `.gauntlet/context/` into `<runDir>/inputs/context/`. The CLI and API run flows call it once, synchronously, before the adapter is constructed, then pass `<runDir>/inputs/context/` as the `contextRoot` to every downstream consumer (read-tool, passkey tool, context-tree renderer).

**Tech Stack:** TypeScript, Bun runtime, `bun:test`. Node `fs` sync APIs (`cpSync`, `mkdirSync`).

**Spec reference:** `docs/superpowers/specs/2026-04-22-hermetic-run-snapshots-design.md`

---

## File Structure

**New files:**
- `src/runs/snapshot.ts` — exports `snapshotRunInputs({ runDir, storyPath, contextRoot })`. Pure I/O; no knowledge of story-card parsing, adapters, or agent internals.
- `test/runs/snapshot.test.ts` — unit tests for the helper (populated context, empty/missing context, byte-identity, directory structure).

**Modified files:**
- `src/cli/run.ts` — call `snapshotRunInputs` after `runId`/`outDir` are decided; swap `contextRoot` from `.gauntlet/context/` to `<outDir>/inputs/context/`.
- `src/api/routes/run.ts` — same wiring in the `POST /run/:id` handler; compose the absolute story path from `gauntletPath(projectRoot, "stories")` + `entry.filename`.
- `test/cli/snapshot.test.ts` — new integration test invoking `run()` end-to-end and asserting the snapshot tree.
- `test/api/routes/run-snapshot.test.ts` — new integration test POSTing to the route and asserting the snapshot tree.

**Unchanged:**
- `src/context/read-tool.ts`, `src/adapters/web/passkey.ts`, `src/adapters/*/adapter.ts`, `src/context/tree.ts`. They all receive `contextRoot` by argument; the root swap at the caller is transparent to them.

---

## Task 1: Snapshot helper module

**Files:**
- Create: `src/runs/snapshot.ts`
- Create: `test/runs/snapshot.test.ts`

### Step 1.1: Write failing test — copies the story file byte-for-byte

- [ ] **Step 1.1.1: Write the test**

Create `test/runs/snapshot.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { snapshotRunInputs } from "../../src/runs/snapshot";

describe("snapshotRunInputs", () => {
  test("copies the story file byte-for-byte", () => {
    const tmp = mkdtempSync(join(tmpdir(), "gauntlet-snap-"));
    try {
      const runDir = join(tmp, "run");
      mkdirSync(runDir);
      const contextRoot = join(tmp, "ctx");
      mkdirSync(contextRoot);
      const storyPath = join(tmp, "story.md");
      const storyContent = "---\nid: story-1\n---\n# Title\n\nBody with emoji 🧪.\n";
      writeFileSync(storyPath, storyContent);

      snapshotRunInputs({ runDir, storyPath, contextRoot });

      const snap = join(runDir, "inputs", "story.md");
      expect(existsSync(snap)).toBe(true);
      expect(readFileSync(snap, "utf-8")).toBe(storyContent);
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
import { mkdirSync, cpSync, readdirSync, statSync } from "fs";
import { join } from "path";

export interface SnapshotInputs {
  /** Absolute path to the run output directory (`.gauntlet/results/<runId>`). */
  runDir: string;
  /** Absolute path to the resolved story file. Copied to `<runDir>/inputs/story.md`. */
  storyPath: string;
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
 * Synchronous. Callers run this exactly once, before adapter construction.
 */
export function snapshotRunInputs(opts: SnapshotInputs): void {
  const inputsDir = join(opts.runDir, "inputs");
  mkdirSync(inputsDir, { recursive: true });

  cpSync(opts.storyPath, join(inputsDir, "story.md"));

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
  } catch (err) {
    // Only absence (ENOENT) or not-a-dir (ENOTDIR) degrade to "empty".
    // Permission errors etc. bubble up so the run fails loudly — spec §
    // "Failure handling" requires copy errors to surface before the
    // agent starts.
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw err;
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
      const storyPath = join(tmp, "story.md");
      writeFileSync(storyPath, "story");
      const contextRoot = join(tmp, "ctx");
      mkdirSync(join(contextRoot, "matt"), { recursive: true });
      writeFileSync(join(contextRoot, "matt", "identity.md"), "name: matt");
      writeFileSync(
        join(contextRoot, "matt", "passkey.json"),
        JSON.stringify({ credentialId: "abc" }),
      );
      mkdirSync(join(contextRoot, "alice"), { recursive: true });
      writeFileSync(join(contextRoot, "alice", "identity.md"), "name: alice");

      snapshotRunInputs({ runDir, storyPath, contextRoot });

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
      const storyPath = join(tmp, "story.md");
      writeFileSync(storyPath, "story");
      const contextRoot = join(tmp, "ctx");
      mkdirSync(contextRoot);

      snapshotRunInputs({ runDir, storyPath, contextRoot });

      const snapCtx = join(runDir, "inputs", "context");
      expect(existsSync(snapCtx)).toBe(true);
      expect(readdirSync(snapCtx)).toEqual([]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
```

(`readdirSync` is already in the top-of-file `fs` import from Step 1.1.)

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
      const storyPath = join(tmp, "story.md");
      writeFileSync(storyPath, "story");
      const contextRoot = join(tmp, "does-not-exist");

      snapshotRunInputs({ runDir, storyPath, contextRoot });

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
      const storyPath = join(tmp, "story.md");
      writeFileSync(storyPath, "story");
      const contextRoot = join(tmp, "ctx");
      mkdirSync(contextRoot);

      snapshotRunInputs({ runDir, storyPath, contextRoot });

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

Copies the resolved story file to <runDir>/inputs/story.md and the
full .gauntlet/context/ tree to <runDir>/inputs/context/ via cpSync.
Missing/empty source context yields an empty inputs/context/,
matching existing degrade-gracefully semantics. Permission errors on
the source bubble up so the run fails loudly before the agent starts.
EOF
)"
```

---

## Task 2: Wire snapshot into the CLI run flow

**Files:**
- Modify: `src/cli/run.ts` — the `run` function body

**Testing posture:** Task 3 builds a route-level integration test that exercises the snapshot wiring end-to-end (same helper, same root-swap, same handler-sync discipline). The CLI path is structurally identical — the only difference is whether `run()` is called directly or via an HTTP handler. Rather than duplicate the integration test with a new CLI-side client-injection surface, this task ships the wiring and relies on:

- Unit tests (Task 1) for snapshot-helper correctness.
- Route integration test (Task 3) for the wiring pattern.
- An explicit manual smoke-test step (below) for the CLI path.

### Step 2.1: Wire the snapshot call

- [ ] **Step 2.1.1: Update `src/cli/run.ts`**

Replace lines 28–41 (from `const content = readFileSync(...)` through `const contextTree = renderContextTree(contextRoot);`) with the block below.

**Important:** the snapshot must run **before** `createClient`. `createClient` can throw on unsupported models and would short-circuit the snapshot otherwise. The snapshot has no dependency on the client, so reorder freely.

```ts
  const content = readFileSync(scenarioPath, "utf-8");
  const card = parseStoryCard(content);
  // Generate runId first so we can derive the default outDir. Mirrors
  // the serve path (src/api/routes/run.ts): `gauntletPath(projectRoot,
  // "results", runId)` is the canonical run output location; `--out`
  // stays available as an explicit override for ad-hoc debugging.
  const runId = makeRunId(card.id);
  const outDir = opts.outDir ?? gauntletPath(config.projectRoot, "results", runId);
  // Snapshot story + context into <outDir>/inputs/ before anything
  // reads the context — and before createClient, which can throw on
  // unsupported models. Every downstream consumer (read-tool, passkey
  // tool, context-tree renderer) uses the snapshotted root, so the
  // agent sees a frozen view even if the source files change during
  // the run.
  snapshotRunInputs({
    runDir: outDir,
    storyPath: scenarioPath,
    contextRoot: gauntletPath(config.projectRoot, "context"),
  });
  const logger = new EvidenceLogger(outDir);
  const client = createClient(config.models.agent);
  const contextRoot = join(outDir, "inputs", "context");
  // Render the tree **once per run** — the immutability invariant
  // forbids re-rendering during the run.
  const contextTree = renderContextTree(contextRoot);
```

Then add at the top of the file:

```ts
import { join } from "path";
import { snapshotRunInputs } from "../runs/snapshot";
```

- [ ] **Step 2.1.2: Run the pre-existing CLI-adjacent tests — expect UNCHANGED**

```
bun test test/cli test/context test/adapters/cli
```

Expected: all still green. The snapshot is additive; the root swap is transparent because every consumer was already taking `contextRoot` by argument.

### Step 2.2: Manual smoke test

- [ ] **Step 2.2.1: Drive a real CLI run and inspect the run dir**

From the repo root, with whatever story and context already exist in `.gauntlet/`:

```
bun run src/index.ts run .gauntlet/stories/<any-story>.md --target <any-target> --adapter cli --out /tmp/gauntlet-smoke
```

(Use the project's actual entry script; `package.json` `"scripts"` is authoritative if different.)

Then:

```
ls /tmp/gauntlet-smoke/inputs
diff -r /tmp/gauntlet-smoke/inputs/context .gauntlet/context
diff /tmp/gauntlet-smoke/inputs/story.md .gauntlet/stories/<any-story>.md
```

Expected: `inputs/story.md` and `inputs/context/` exist; the diffs are empty (modulo files the agent wrote into context during the run, which the snapshot does not reflect because the snapshot is immutable). The run itself may pass or fail depending on the target — that's not what the smoke test validates.

### Step 2.3: Commit

- [ ] **Step 2.3.1: Commit**

```
git add src/cli/run.ts
git commit -m "$(cat <<'EOF'
feat(cli): snapshot story + context into run dir before agent start

CLI run flow now calls snapshotRunInputs after outDir is decided and
swaps contextRoot to <outDir>/inputs/context/ for downstream consumers
(read-tool, passkey tool, context-tree renderer). Live behavior is
unchanged — only the root shifts. Snapshot runs before createClient so
a model-resolution failure doesn't prevent the snapshot.
EOF
)"
```

---

## Task 3: Wire snapshot into the API run flow

**Files:**
- Modify: `src/api/routes/run.ts` — signature of `runRoutes` (add `clientFactory?`), and the `POST /:id` handler body.
- Modify: `src/api/server.ts` if it constructs `runRoutes(...)` — pass `undefined` explicitly only if the TS compiler complains; optional params don't need it.
- Create: `test/api/routes/run-snapshot.test.ts`.

The route already has `entry.filename` from `findCard`, which is the story filename relative to the stories dir. Composing `join(storiesDir, entry.filename)` gives an absolute path that `cpSync` can consume — no changes to `CardEntry` or `findCard` needed.

### Step 3.1: Add `clientFactory` injection to `runRoutes`

Rationale: the test in Step 3.2 needs a non-network LLM client. `fanoutRoutes` (`src/api/routes/fanout.ts:79`) already accepts a `clientFactory?: () => LLMClient` for the same reason — this step propagates the pattern to `runRoutes` rather than introducing a new one.

- [ ] **Step 3.1.1: Widen the signature**

In `src/api/routes/run.ts`, change the `runRoutes` signature to accept an optional client factory and use it if provided:

```ts
export function runRoutes(
  config: AppConfig,
  broadcaster?: RunBroadcaster,
  errorLog?: ErrorLog,
  registry?: ActiveRunRegistry,
  clientFactory?: (model: string) => LLMClient,
) {
  const router = new Hono();

  router.post("/:id", async (c) => {
    // ...existing body up through mergeRunConfig / model gate...

    const client = clientFactory
      ? clientFactory(effective.model)
      : createClient(effective.model);
    // ...rest of handler unchanged...
  });

  return router;
}
```

(Only the signature and the two `client` lines change; the rest of the handler body is modified in Step 3.2. `LLMClient` is already imported at the top of the file.)

- [ ] **Step 3.1.2: Run the existing suite — expect UNCHANGED**

```
bun test test/api
```

Expected: all still green. Adding an optional parameter is backward-compatible; production call sites don't pass it and continue to go through `createClient`.

### Step 3.2: Write failing route integration test

- [ ] **Step 3.2.1: Write the test**

Create `test/api/routes/run-snapshot.test.ts`:

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
  // Non-network client. The detached executeRun may call chat() — return
  // an end_turn so the background task terminates quickly. The test's
  // assertion is on disk state at handler return, not on the
  // background agent loop, so this body is essentially irrelevant.
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
  test("writes <runDir>/inputs/{story.md,context/} synchronously in the handler", async () => {
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
      app.route(
        "/run",
        runRoutes(config, undefined, undefined, undefined, () => stubClient()),
      );

      const res = await app.request("/run/snap-story", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: "cli:echo", adapter: "cli" }),
      });
      expect(res.status).toBe(202);
      const body = (await res.json()) as { runId: string };

      // Snapshot is synchronous in the request handler — so it MUST be
      // present as soon as the 202 is returned, regardless of what the
      // detached executeRun goes on to do (including failing).
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

- [ ] **Step 3.2.2: Run the test — expect FAIL**

```
bun test test/api/routes/run-snapshot.test.ts
```

Expected: FAIL — `inputs/story.md` not found. (Snapshot is not wired in yet.)

### Step 3.3: Wire the snapshot into `POST /run/:id`

- [ ] **Step 3.3.1: Modify `src/api/routes/run.ts`**

Add the import at the top of the file:

```ts
import { snapshotRunInputs } from "../../runs/snapshot";
```

Three surgical edits to the handler (all other lines unchanged):

1. **Remove** the outer-scope `const contextRoot = gauntletPath(config.projectRoot, "context");` (currently line 54). It moves into the handler below, scoped per-request.

2. **Insert** the snapshot + root-swap immediately after the `makeRunId` / `outDir` lines (currently lines 84–85). Do NOT re-declare `logger` here — `logger` already exists at line 88 and stays where it is. The only new lines are the snapshot call and the new local `contextRoot`:

```ts
    const runId = makeRunId(entry.card.id);
    const outDir = gauntletPath(config.projectRoot, "results", runId);
    // Snapshot story + context into <outDir>/inputs/ synchronously,
    // before the logger, the adapter, the tree renderer, or the
    // detached executeRun touch anything. Downstream consumers then
    // see the snapshotted paths. The story path is composed from the
    // stories dir + the filename findCard already resolved for us.
    snapshotRunInputs({
      runDir: outDir,
      storyPath: join(gauntletPath(config.projectRoot, "stories"), entry.filename),
      contextRoot: gauntletPath(config.projectRoot, "context"),
    });
    const contextRoot = join(outDir, "inputs", "context");
    // Create the logger *before* the adapter so WebAdapter can open its
    // background observer session against it in start().
    const logger = new EvidenceLogger(outDir);
```

3. **Confirm** `join` is already imported at the top of the file (line 2) — it is.

Double-check after the edit: `grep -n "const logger" src/api/routes/run.ts` should return **exactly one** match inside the `POST /:id` handler. Likewise `grep -n "const contextRoot" src/api/routes/run.ts` should return exactly one match, inside the handler (the outer-scope version from line 54 is gone).

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
git add src/api/routes/run.ts test/api/routes/run-snapshot.test.ts
git commit -m "$(cat <<'EOF'
feat(api): snapshot run inputs in POST /run/:id before dispatch

The snapshot runs synchronously in the handler — available before 202
returns — and contextRoot is swapped to <runDir>/inputs/context/ for
every downstream consumer. runRoutes also gains an optional
clientFactory parameter matching the pattern already in fanoutRoutes,
so route-level integration tests can run without a real LLM client.
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
| Snapshot timing (before adapter) | Tasks 2.1, 3.3 |
| Byte-for-byte story copy | Task 1.1 (`cpSync` of the resolved story path) |
| Recursive context copy | Task 1.2 |
| Missing/empty context → empty `inputs/context/` | Tasks 1.3, 1.4 |
| Permission errors bubble up (spec §"Failure handling") | Task 1.1.3 (`sourceIsPopulated` narrows catch to ENOENT/ENOTDIR) |
| Root-swap contract (read-tool, passkey, tree renderer) | Tasks 2.1, 3.3 |
| Story injection from snapshot | Implicit — the agent consumes the parsed `StoryCard` already in memory; `story.md` on disk is for history/resumed chat, not re-read during the run. Matches the design. |
| Resumed-chat forward compatibility | No task — spec explicitly says this is out of scope; the snapshot layout sets up the future change. |
| Testing: edit-during-run | Covered by Task 1 unit tests (snapshot is pure, synchronous, and has no live-file dependency after return). The Kepler review confirmed the invariant holds in the CLI call path. |

**Type consistency:** `snapshotRunInputs` signature is identical everywhere it's referenced (`{ runDir, storyPath, contextRoot }`). `runRoutes` gains one optional parameter (`clientFactory`) mirroring `fanoutRoutes`'s existing shape.

**Placeholder scan:** No TBDs, no "handle edge cases", no references to undefined types. No hedging comments ("if X doesn't exist, maybe add Y") — `clientFactory` is now an explicit numbered step rather than a hand-wave.

---

## Plan complete

Plan saved to `docs/superpowers/plans/2026-04-22-hermetic-run-snapshots.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
