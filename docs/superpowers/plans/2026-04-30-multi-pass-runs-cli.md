# Multi-pass runs (CLI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `--passes N` to `gauntlet run` and `gauntlet batch` so a story can be run N times in one invocation, with an aggregated summary across attempts. Web UI and HTTP API surfaces are deferred to a follow-on plan (Phase B).

**Architecture:** A new `RunSet` orchestrator drives N executions of an injected per-attempt executor (`runOne` for the CLI, `executeRun` for the API in the follow-on). A new `RunSetWriter` owns `<.gauntlet>/run-sets/<runSetId>/`. The per-attempt code paths gain one optional parameter (`runSetCtx?: RunSetCtx`) and stamp it onto the returned `VetResult` before persistence — `writeResultFiles` is unchanged. The `BatchTableRenderer` extends to key rows by `(cardId, attemptNumber)` and emits a per-card rollup as a third permanent line on the final attempt's commit. Solo `gauntlet run story.md` (no flag, or `--passes 1`) is byte-identical to today.

**Tech Stack:** TypeScript / Bun, `bun:test` for tests, Hono (API, untouched in this plan), no new runtime deps.

**Spec:** `docs/superpowers/specs/2026-04-29-multi-pass-runs-design.md`. The body of this plan refers to that spec as "the spec." Phase A here covers spec phases 1 (Identity + persistence + orchestrator) and 2 (CLI surface). Spec phase 3 (API + Web UI + cancel UI) is a separate follow-on plan.

---

## File map

```
NEW
  src/runs/run-set.ts                    Orchestrator (cards × attempts loop)
  src/runs/run-set-types.ts              RunSetCtx, RunSetKind, RunSetSummary types
  src/evidence/run-set-writer.ts         set.json + summary.md writer
  test/runs/run-set.test.ts              Orchestrator tests (mocked executor)
  test/evidence/run-set-writer.test.ts   Writer + status derivation tests
  test/cli/run-passes.test.ts            Integration: run --passes N
  test/cli/batch-passes.test.ts          Integration: batch --passes N
  test/cli/cancel.test.ts                Integration: SIGINT cancel

MODIFY
  src/types.ts                           Add VetResult.runSet?: RunSetCtx
  src/util/id.ts                         Add makeRunSetId()
  src/cli/args.ts                        Add "passes" flag, parse + validate
  src/cli/run-one.ts                     Add runSetCtx? to options, stamp result
  src/cli/run.ts                         Use orchestrator when passes > 1
  src/cli/batch.ts                       Use orchestrator (cards × attempts loop)
  src/cli/stream/batch-table.ts          Key by (cardId, attemptNumber); rollup line
  src/api/routes/run.ts                  Add runSetCtx? to ExecuteRunOpts (no behavior change in this plan)
  test/cli/stream/batch-table.test.ts    Update existing tests for new keying
```

---

## Phase A.1 — Plumbing

User-invisible. Adds types, ID generator, the orchestrator and writer, and threads the optional ctx parameter through both per-attempt code paths. After this phase, `gauntlet run story.md` is byte-identical to today.

### Task 1: Add `RunSetCtx` types and extend `VetResult`

**Files:**
- Create: `src/runs/run-set-types.ts`
- Modify: `src/types.ts` (add `runSet?: RunSetCtx` field to `VetResult` interface around line 89)
- Test: `test/runs/run-set-types.test.ts`

- [ ] **Step 1: Create the types module**

```ts
// src/runs/run-set-types.ts

export type RunSetKind = "single" | "batch";

export interface RunSetCtx {
  runSetId: string;
  kind: RunSetKind;
  passes: number;
  cards: string[];      // cardIds, in deterministic order
  cardIndex: number;    // 0-indexed position in `cards`
  attemptNumber: number; // 1-indexed within the (cards × attempts) loop
}

export type SetBucket =
  | "consistent_pass"
  | "consistent_investigate"
  | "consistent_fail"
  | "mixed"
  | "mixed_with_errors"
  | "errored";
```

- [ ] **Step 2: Extend `VetResult`**

In `src/types.ts`, find the `VetResult` interface (starts around line 40). Add the import at the top and the optional field at the end of the interface, right after the existing `config?: RunConfigSnapshot` field:

```ts
// Add near the top of src/types.ts (with other imports)
import type { RunSetCtx } from "./runs/run-set-types";

// In the VetResult interface, after `config?: RunConfigSnapshot`:
  runSet?: RunSetCtx;
```

- [ ] **Step 3: Write a smoke test**

```ts
// test/runs/run-set-types.test.ts
import { describe, test, expect } from "bun:test";
import type { RunSetCtx, SetBucket } from "../../src/runs/run-set-types";

describe("RunSetCtx", () => {
  test("type compiles with valid shape", () => {
    const ctx: RunSetCtx = {
      runSetId: "single_20260430T000000Z_abcd",
      kind: "single",
      passes: 3,
      cards: ["login-ok"],
      cardIndex: 0,
      attemptNumber: 2,
    };
    expect(ctx.attemptNumber).toBe(2);
  });

  test("SetBucket admits all six values", () => {
    const buckets: SetBucket[] = [
      "consistent_pass",
      "consistent_investigate",
      "consistent_fail",
      "mixed",
      "mixed_with_errors",
      "errored",
    ];
    expect(buckets).toHaveLength(6);
  });
});
```

- [ ] **Step 4: Run tests**

Run: `bun test test/runs/run-set-types.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Verify the wider codebase still typechecks**

Run: `bun run tsc --noEmit` (or whatever the repo's typecheck command is — check `package.json`)
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/runs/run-set-types.ts src/types.ts test/runs/run-set-types.test.ts
git commit -m "feat(runs): add RunSetCtx type and VetResult.runSet field (PRI-1440)"
```

---

### Task 2: Add `makeRunSetId()` to `src/util/id.ts`

**Files:**
- Modify: `src/util/id.ts` (existing `makeRunId` lives at lines 17–21)
- Test: `test/util/id.test.ts` (extend existing or create)

- [ ] **Step 1: Write failing tests**

```ts
// In test/util/id.test.ts (extend existing file, or create with the same imports)
import { describe, test, expect } from "bun:test";
import { makeRunSetId } from "../../src/util/id";

describe("makeRunSetId", () => {
  test("kind=single produces single_<ts>_<nonce>", () => {
    const id = makeRunSetId("single");
    expect(id).toMatch(/^single_\d{8}T\d{6}Z_[a-z0-9]{4}$/);
  });

  test("kind=batch produces batch_<ts>_<nonce>", () => {
    const id = makeRunSetId("batch");
    expect(id).toMatch(/^batch_\d{8}T\d{6}Z_[a-z0-9]{4}$/);
  });

  test("two consecutive ids differ", () => {
    const a = makeRunSetId("single");
    const b = makeRunSetId("single");
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run tests; expect failure**

Run: `bun test test/util/id.test.ts -t makeRunSetId`
Expected: FAIL with "makeRunSetId is not a function" or similar.

- [ ] **Step 3: Implement `makeRunSetId`**

In `src/util/id.ts`, after the existing `makeRunId` function (around line 22):

```ts
export function makeRunSetId(kind: "single" | "batch"): string {
  const ts = isoBasicNow();
  const nonce = Math.random().toString(36).slice(2, 6).padEnd(4, "0");
  return `${kind}_${ts}_${nonce}`;
}
```

`isoBasicNow` already exists in the file — reuse it.

- [ ] **Step 4: Run tests**

Run: `bun test test/util/id.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/util/id.ts test/util/id.test.ts
git commit -m "feat(util): add makeRunSetId for run set identity (PRI-1440)"
```

---

### Task 3: Thread `runSetCtx?` through `runOne`

**Files:**
- Modify: `src/cli/run-one.ts` (existing `RunOneOptions` at lines 21–32, `runOne` body at lines 40–125, `writeResultFiles` call at line 112)
- Test: `test/cli/run-one.test.ts` (extend existing or create new test for ctx propagation)

- [ ] **Step 1: Extend `RunOneOptions`**

In `src/cli/run-one.ts`:

```ts
// Add to imports at the top:
import type { RunSetCtx } from "../runs/run-set-types";

// In RunOneOptions interface (lines 21–32), add at the end:
  runSetCtx?: RunSetCtx;
```

- [ ] **Step 2: Stamp `runSet` onto the result before persistence**

Find the line where `writeResultFiles` is called (around line 112). Just **before** that call, add:

```ts
if (opts.runSetCtx) {
  result.runSet = opts.runSetCtx;
}
writeResultFiles(outDir, result);
```

The mutation is safe — `result` is the local return value from `runAgent`, not shared.

- [ ] **Step 3: Write a test that passes a ctx and asserts it lands in result.json**

```ts
// test/cli/run-one.test.ts (or extend existing run-one tests)
import { describe, test, expect } from "bun:test";
import { mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runOne } from "../../src/cli/run-one";
import type { RunSetCtx } from "../../src/runs/run-set-types";

describe("runOne — runSetCtx propagation", () => {
  test("stamps runSet field onto result.json when ctx supplied", async () => {
    const outRoot = mkdtempSync(join(tmpdir(), "gauntlet-runone-"));
    const ctx: RunSetCtx = {
      runSetId: "single_20260430T000000Z_test",
      kind: "single",
      passes: 3,
      cards: ["story-a"],
      cardIndex: 0,
      attemptNumber: 2,
    };

    // Use the cli adapter and a stubbed scenario to keep the test hermetic.
    // (Match whatever the existing tests use — see test/cli/run-one.test.ts
    //  if it exists, or test/e2e/cli-adapter for the helpers.)
    const summary = await runOne({
      scenarioPath: "test/fixtures/stories/trivial-pass.md",
      target: "stub",
      outDir: outRoot,
      adapterType: "cli",
      config: { /* minimal AppConfig from existing test helper */ } as any,
      runSetCtx: ctx,
    });

    const resultJson = JSON.parse(readFileSync(join(outRoot, "result.json"), "utf8"));
    expect(resultJson.runSet).toEqual(ctx);
    expect(summary.result.runSet).toEqual(ctx);
  });

  test("omits runSet field when no ctx supplied", async () => {
    const outRoot = mkdtempSync(join(tmpdir(), "gauntlet-runone-"));
    const summary = await runOne({
      scenarioPath: "test/fixtures/stories/trivial-pass.md",
      target: "stub",
      outDir: outRoot,
      adapterType: "cli",
      config: { /* minimal AppConfig */ } as any,
    });
    const resultJson = JSON.parse(readFileSync(join(summary.outDir, "result.json"), "utf8"));
    expect(resultJson.runSet).toBeUndefined();
  });
});
```

If `test/fixtures/stories/trivial-pass.md` doesn't exist, look for an existing fixture used by other run-one tests (e.g. in `test/e2e/`). Match the existing pattern; do not invent new fixtures.

- [ ] **Step 4: Run tests**

Run: `bun test test/cli/run-one.test.ts -t "runSetCtx propagation"`
Expected: PASS.

- [ ] **Step 5: Run the existing run-one and run.ts tests; they must still pass unchanged**

Run: `bun test test/cli/run-one.test.ts test/cli/run.test.ts` (whichever exist)
Expected: existing tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/cli/run-one.ts test/cli/run-one.test.ts
git commit -m "feat(cli): thread runSetCtx through runOne (PRI-1440)"
```

---

### Task 4: Thread `runSetCtx?` through `executeRun`

**Files:**
- Modify: `src/api/routes/run.ts` (existing `ExecuteRunOpts` at lines 170–213, `executeRun` body at lines 215–323, `writeResultFiles` call near line 295)
- No new tests in this task — we test via integration in Task 17. The change is symmetric to Task 3 and the `executeRun` path is exercised by existing API tests.

- [ ] **Step 1: Extend `ExecuteRunOpts`**

In `src/api/routes/run.ts`:

```ts
// Add to imports:
import type { RunSetCtx } from "../../runs/run-set-types";

// In ExecuteRunOpts (lines 170–213), add at the end:
  runSetCtx?: RunSetCtx;
```

- [ ] **Step 2: Stamp `runSet` onto the result before `writeResultFiles`**

In the `executeRun` body, just before the `writeResultFiles(outDir, result)` call (near line 295):

```ts
if (opts.runSetCtx) {
  result.runSet = opts.runSetCtx;
}
writeResultFiles(outDir, result);
```

- [ ] **Step 3: Run the existing API route tests**

Run: `bun test test/api/`
Expected: PASS — no behavior change for existing callers (none pass `runSetCtx`).

- [ ] **Step 4: Commit**

```bash
git add src/api/routes/run.ts
git commit -m "feat(api): thread runSetCtx through executeRun (PRI-1440)"
```

---

### Task 5: `RunSetWriter` — owns `<.gauntlet>/run-sets/<id>/`

**Files:**
- Create: `src/evidence/run-set-writer.ts`
- Test: `test/evidence/run-set-writer.test.ts`

- [ ] **Step 1: Write the test first**

```ts
// test/evidence/run-set-writer.test.ts
import { describe, test, expect } from "bun:test";
import { mkdtempSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { RunSetWriter } from "../../src/evidence/run-set-writer";
import type { RunSetCtx } from "../../src/runs/run-set-types";
import type { VetResult } from "../../src/types";

const baseCtx = (overrides: Partial<RunSetCtx> = {}): RunSetCtx => ({
  runSetId: "single_20260430T000000Z_test",
  kind: "single",
  passes: 3,
  cards: ["card-a"],
  cardIndex: 0,
  attemptNumber: 1,
  ...overrides,
});

const fakeResult = (status: VetResult["status"], turns = 5, duration = 4000): VetResult => ({
  schemaVersion: 2,
  runId: "card-a_20260430T000001Z_x000",
  scenario: "card-a",
  status,
  summary: "",
  reasoning: "",
  observations: [],
  evidence: { screenshots: [], log: "run.jsonl" },
  duration_ms: duration,
  usage: { inputTokens: 0, outputTokens: 0, turns },
});

describe("RunSetWriter", () => {
  test("start() creates dir and stub set.json with all attempts queued", () => {
    const root = mkdtempSync(join(tmpdir(), "gauntlet-rsw-"));
    const ctx = baseCtx();
    const allRuns = [
      { runId: "card-a_t1_a000", cardId: "card-a", attemptNumber: 1 },
      { runId: "card-a_t2_b000", cardId: "card-a", attemptNumber: 2 },
      { runId: "card-a_t3_c000", cardId: "card-a", attemptNumber: 3 },
    ];

    const w = new RunSetWriter(root, ctx);
    w.start(allRuns);

    const dir = join(root, "run-sets", ctx.runSetId);
    expect(existsSync(dir)).toBe(true);

    const set = JSON.parse(readFileSync(join(dir, "set.json"), "utf8"));
    expect(set.runSetId).toBe(ctx.runSetId);
    expect(set.passes).toBe(3);
    expect(set.runs).toHaveLength(3);
    expect(set.runs[0].status).toBe("queued");
    expect(set.summary).toBeNull();
    expect(set.completedAt).toBeNull();
  });

  test("recordRunStart marks attempt as running", () => {
    const root = mkdtempSync(join(tmpdir(), "gauntlet-rsw-"));
    const w = new RunSetWriter(root, baseCtx());
    w.start([
      { runId: "r1", cardId: "card-a", attemptNumber: 1 },
      { runId: "r2", cardId: "card-a", attemptNumber: 2 },
      { runId: "r3", cardId: "card-a", attemptNumber: 3 },
    ]);
    w.recordRunStart("r2");
    const set = JSON.parse(readFileSync(join(root, "run-sets", baseCtx().runSetId, "set.json"), "utf8"));
    expect(set.runs[1].status).toBe("running");
    expect(set.runs[0].status).toBe("queued");
  });

  test("recordRunEnd marks attempt with the final status", () => {
    const root = mkdtempSync(join(tmpdir(), "gauntlet-rsw-"));
    const w = new RunSetWriter(root, baseCtx());
    w.start([{ runId: "r1", cardId: "card-a", attemptNumber: 1 }]);
    w.recordRunEnd("r1", "pass");
    const set = JSON.parse(readFileSync(join(root, "run-sets", baseCtx().runSetId, "set.json"), "utf8"));
    expect(set.runs[0].status).toBe("pass");
  });

  test("finalize() — consistent_pass for 3 passes", () => {
    const root = mkdtempSync(join(tmpdir(), "gauntlet-rsw-"));
    const w = new RunSetWriter(root, baseCtx({ passes: 3 }));
    w.start([
      { runId: "r1", cardId: "card-a", attemptNumber: 1 },
      { runId: "r2", cardId: "card-a", attemptNumber: 2 },
      { runId: "r3", cardId: "card-a", attemptNumber: 3 },
    ]);
    const results = [fakeResult("pass", 5, 4000), fakeResult("pass", 6, 5000), fakeResult("pass", 7, 6000)];
    w.finalize((runId) => {
      const i = ["r1", "r2", "r3"].indexOf(runId);
      return results[i];
    });

    const set = JSON.parse(readFileSync(join(root, "run-sets", baseCtx().runSetId, "set.json"), "utf8"));
    expect(set.summary.perCard[0].cardStatus).toBe("consistent_pass");
    expect(set.summary.perCard[0].byStatus.pass).toBe(3);
    expect(set.summary.perCard[0].medianTurns).toBe(6);
    expect(set.summary.perCard[0].medianDurationMs).toBe(5000);
    expect(set.summary.overall.overallStatus).toBe("consistent_pass");
    expect(set.completedAt).not.toBeNull();
    expect(existsSync(join(root, "run-sets", baseCtx().runSetId, "summary.md"))).toBe(true);
  });

  test("finalize() — mixed bucket for pass + investigate", () => {
    const root = mkdtempSync(join(tmpdir(), "gauntlet-rsw-"));
    const w = new RunSetWriter(root, baseCtx({ passes: 3 }));
    w.start([
      { runId: "r1", cardId: "card-a", attemptNumber: 1 },
      { runId: "r2", cardId: "card-a", attemptNumber: 2 },
      { runId: "r3", cardId: "card-a", attemptNumber: 3 },
    ]);
    const results = [fakeResult("pass"), fakeResult("pass"), fakeResult("investigate")];
    w.finalize((runId) => results[["r1", "r2", "r3"].indexOf(runId)]);
    const set = JSON.parse(readFileSync(join(root, "run-sets", baseCtx().runSetId, "set.json"), "utf8"));
    expect(set.summary.perCard[0].cardStatus).toBe("mixed");
  });

  test("finalize() — mixed_with_errors covers errored present + non-errored", () => {
    const root = mkdtempSync(join(tmpdir(), "gauntlet-rsw-"));
    const w = new RunSetWriter(root, baseCtx({ passes: 3 }));
    w.start([
      { runId: "r1", cardId: "card-a", attemptNumber: 1 },
      { runId: "r2", cardId: "card-a", attemptNumber: 2 },
      { runId: "r3", cardId: "card-a", attemptNumber: 3 },
    ]);
    // Mark r3 as errored via recordRunEnd; finalize fetches results only for non-errored.
    w.recordRunEnd("r3", "errored");
    const results = [fakeResult("pass"), fakeResult("pass")];
    w.finalize((runId) => {
      if (runId === "r3") return null; // errored attempts have no result
      return results[["r1", "r2"].indexOf(runId)];
    });
    const set = JSON.parse(readFileSync(join(root, "run-sets", baseCtx().runSetId, "set.json"), "utf8"));
    expect(set.summary.perCard[0].cardStatus).toBe("mixed_with_errors");
    expect(set.summary.perCard[0].byStatus.errored).toBe(1);
    expect(set.summary.perCard[0].byStatus.pass).toBe(2);
  });

  test("finalize() — errored bucket when all errored", () => {
    const root = mkdtempSync(join(tmpdir(), "gauntlet-rsw-"));
    const w = new RunSetWriter(root, baseCtx({ passes: 2 }));
    w.start([
      { runId: "r1", cardId: "card-a", attemptNumber: 1 },
      { runId: "r2", cardId: "card-a", attemptNumber: 2 },
    ]);
    w.recordRunEnd("r1", "errored");
    w.recordRunEnd("r2", "errored");
    w.finalize(() => null);
    const set = JSON.parse(readFileSync(join(root, "run-sets", baseCtx().runSetId, "set.json"), "utf8"));
    expect(set.summary.perCard[0].cardStatus).toBe("errored");
    expect(set.summary.overall.overallStatus).toBe("errored");
  });

  test("finalize() — batch overall sums across cards", () => {
    const root = mkdtempSync(join(tmpdir(), "gauntlet-rsw-"));
    const ctx: RunSetCtx = {
      runSetId: "batch_20260430T000000Z_test",
      kind: "batch",
      passes: 2,
      cards: ["card-a", "card-b"],
      cardIndex: 0,
      attemptNumber: 1,
    };
    const w = new RunSetWriter(root, ctx);
    w.start([
      { runId: "a1", cardId: "card-a", attemptNumber: 1 },
      { runId: "a2", cardId: "card-a", attemptNumber: 2 },
      { runId: "b1", cardId: "card-b", attemptNumber: 1 },
      { runId: "b2", cardId: "card-b", attemptNumber: 2 },
    ]);
    const map: Record<string, VetResult> = {
      a1: fakeResult("pass"),
      a2: fakeResult("pass"),
      b1: fakeResult("fail"),
      b2: fakeResult("fail"),
    };
    w.finalize((id) => map[id]);
    const set = JSON.parse(readFileSync(join(root, "run-sets", ctx.runSetId, "set.json"), "utf8"));
    expect(set.summary.perCard[0].cardStatus).toBe("consistent_pass");
    expect(set.summary.perCard[1].cardStatus).toBe("consistent_fail");
    expect(set.summary.overall.byStatus).toEqual({ pass: 2, fail: 2, investigate: 0, errored: 0 });
    expect(set.summary.overall.overallStatus).toBe("mixed");
  });
});
```

- [ ] **Step 2: Run the tests; they should fail (module not found)**

Run: `bun test test/evidence/run-set-writer.test.ts`
Expected: FAIL with "cannot find module".

- [ ] **Step 3: Implement `RunSetWriter`**

```ts
// src/evidence/run-set-writer.ts
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import type { RunSetCtx, SetBucket } from "../runs/run-set-types";
import type { VetResult, VetStatus } from "../types";

interface RunEntry {
  runId: string;
  cardId: string;
  attemptNumber: number;
  status: "queued" | "running" | "cancelled" | VetStatus;
}

interface CardSummary {
  cardId: string;
  passes: number;
  byStatus: { pass: number; fail: number; investigate: number; errored: number; cancelled?: number };
  cardStatus: SetBucket;
  medianTurns: number;
  medianDurationMs: number;
}

interface OverallSummary {
  totalRuns: number;
  byStatus: { pass: number; fail: number; investigate: number; errored: number; cancelled?: number };
  overallStatus: SetBucket;
}

interface SetManifest {
  schemaVersion: 1;
  runSetId: string;
  kind: "single" | "batch";
  createdAt: string;
  completedAt: string | null;
  passes: number;
  cards: string[];
  runs: RunEntry[];
  summary: { perCard: CardSummary[]; overall: OverallSummary } | null;
}

export class RunSetWriter {
  private dir: string;
  private manifest!: SetManifest;

  constructor(private resultsRoot: string, private ctx: RunSetCtx) {
    this.dir = join(resultsRoot, "run-sets", ctx.runSetId);
  }

  start(allRuns: Array<{ runId: string; cardId: string; attemptNumber: number }>): void {
    mkdirSync(this.dir, { recursive: true });
    this.manifest = {
      schemaVersion: 1,
      runSetId: this.ctx.runSetId,
      kind: this.ctx.kind,
      createdAt: new Date().toISOString(),
      completedAt: null,
      passes: this.ctx.passes,
      cards: this.ctx.cards,
      runs: allRuns.map((r) => ({ ...r, status: "queued" })),
      summary: null,
    };
    this.flush();
  }

  recordRunStart(runId: string): void {
    const r = this.manifest.runs.find((x) => x.runId === runId);
    if (r) r.status = "running";
    this.flush();
  }

  recordRunEnd(runId: string, status: VetStatus | "errored" | "cancelled"): void {
    const r = this.manifest.runs.find((x) => x.runId === runId);
    if (r) r.status = status;
    this.flush();
  }

  /**
   * `lookup` returns the per-run VetResult for runs whose status is in
   * {pass, fail, investigate}. For errored / cancelled runs (no result.json),
   * lookup may return null and the writer derives turn/duration solely from
   * the runs whose results exist.
   */
  finalize(lookup: (runId: string) => VetResult | null): void {
    const perCard: CardSummary[] = this.ctx.cards.map((cardId) => {
      const cardRuns = this.manifest.runs.filter((r) => r.cardId === cardId);
      return summarizeCard(cardId, cardRuns, lookup);
    });
    const overall = summarizeOverall(perCard);
    this.manifest.summary = { perCard, overall };
    this.manifest.completedAt = new Date().toISOString();
    this.flush();
    writeFileSync(join(this.dir, "summary.md"), renderSummaryMarkdown(this.manifest), "utf8");
  }

  private flush(): void {
    writeFileSync(join(this.dir, "set.json"), JSON.stringify(this.manifest, null, 2), "utf8");
  }
}

function summarizeCard(
  cardId: string,
  cardRuns: RunEntry[],
  lookup: (runId: string) => VetResult | null,
): CardSummary {
  const byStatus = { pass: 0, fail: 0, investigate: 0, errored: 0, cancelled: 0 };
  const turns: number[] = [];
  const durations: number[] = [];

  for (const r of cardRuns) {
    if (r.status === "queued" || r.status === "running") continue; // shouldn't happen at finalize
    if (r.status === "cancelled") {
      byStatus.cancelled++;
      continue;
    }
    if (r.status === "errored") {
      byStatus.errored++;
      continue;
    }
    byStatus[r.status]++;
    const result = lookup(r.runId);
    if (result) {
      if (result.usage?.turns != null) turns.push(result.usage.turns);
      if (result.duration_ms != null) durations.push(result.duration_ms);
    }
  }

  return {
    cardId,
    passes: cardRuns.length,
    byStatus,
    cardStatus: deriveBucket(byStatus),
    medianTurns: median(turns),
    medianDurationMs: median(durations),
  };
}

function summarizeOverall(perCard: CardSummary[]): OverallSummary {
  const byStatus = { pass: 0, fail: 0, investigate: 0, errored: 0, cancelled: 0 };
  for (const c of perCard) {
    byStatus.pass += c.byStatus.pass;
    byStatus.fail += c.byStatus.fail;
    byStatus.investigate += c.byStatus.investigate;
    byStatus.errored += c.byStatus.errored;
    byStatus.cancelled += c.byStatus.cancelled ?? 0;
  }
  return {
    totalRuns: byStatus.pass + byStatus.fail + byStatus.investigate + byStatus.errored + byStatus.cancelled,
    byStatus,
    overallStatus: deriveBucket(byStatus),
  };
}

function deriveBucket(by: {
  pass: number; fail: number; investigate: number; errored: number; cancelled?: number;
}): SetBucket {
  const cancelled = by.cancelled ?? 0;
  const errAndCancel = by.errored + cancelled;
  const total = by.pass + by.fail + by.investigate + errAndCancel;
  if (total === 0) return "errored"; // degenerate
  if (by.pass === total) return "consistent_pass";
  if (by.investigate === total) return "consistent_investigate";
  if (by.fail === total) return "consistent_fail";
  if (errAndCancel === total) return "errored";
  if (errAndCancel > 0) return "mixed_with_errors";
  return "mixed";
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function renderSummaryMarkdown(m: SetManifest): string {
  const lines: string[] = [];
  lines.push(`# Run set ${m.runSetId}`);
  lines.push("");
  lines.push(`- kind: ${m.kind}`);
  lines.push(`- passes: ${m.passes}`);
  lines.push(`- cards: ${m.cards.join(", ")}`);
  lines.push(`- created: ${m.createdAt}`);
  if (m.completedAt) lines.push(`- completed: ${m.completedAt}`);
  if (m.summary) {
    lines.push("");
    lines.push(`## Overall: ${m.summary.overall.overallStatus}`);
    for (const c of m.summary.perCard) {
      lines.push("");
      lines.push(`### ${c.cardId}: ${c.cardStatus}`);
      lines.push(`- byStatus: ${JSON.stringify(c.byStatus)}`);
      lines.push(`- median turns: ${c.medianTurns}`);
      lines.push(`- median duration_ms: ${c.medianDurationMs}`);
    }
  }
  return lines.join("\n") + "\n";
}
```

- [ ] **Step 4: Run tests**

Run: `bun test test/evidence/run-set-writer.test.ts`
Expected: PASS, all 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/evidence/run-set-writer.ts test/evidence/run-set-writer.test.ts
git commit -m "feat(evidence): RunSetWriter for set.json + summary.md (PRI-1440)"
```

---

### Task 6: `RunSet` orchestrator (`src/runs/run-set.ts`)

**Files:**
- Create: `src/runs/run-set.ts`
- Test: `test/runs/run-set.test.ts`

The orchestrator is the loop body that iterates `cards × attempts` and calls an injected executor. It owns the `RunSetWriter` lifecycle and threads `runSetCtx` into the executor.

- [ ] **Step 1: Write tests first**

```ts
// test/runs/run-set.test.ts
import { describe, test, expect } from "bun:test";
import { mkdtempSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runRunSet } from "../../src/runs/run-set";
import type { VetResult } from "../../src/types";
import type { RunSetCtx } from "../../src/runs/run-set-types";

const baseConfig = (overrides = {}) => ({
  resultsRoot: mkdtempSync(join(tmpdir(), "gauntlet-runset-")),
  cards: ["card-a"],
  passes: 1,
  kind: "single" as const,
  generateRunId: (cardId: string, i: number) => `${cardId}_t${i}_x000`,
  ...overrides,
});

const fakeResult = (status: VetResult["status"]): VetResult => ({
  schemaVersion: 2,
  runId: "x",
  scenario: "x",
  status,
  summary: "",
  reasoning: "",
  observations: [],
  evidence: { screenshots: [], log: "run.jsonl" },
  duration_ms: 1000,
  usage: { inputTokens: 0, outputTokens: 0, turns: 5 },
});

describe("runRunSet — orchestrator loop", () => {
  test("executes all attempts of one card in order", async () => {
    const cfg = baseConfig({ passes: 3 });
    const calls: Array<{ cardId: string; ctx: RunSetCtx }> = [];
    const result = await runRunSet({
      ...cfg,
      executor: async ({ cardId, runSetCtx }) => {
        calls.push({ cardId, ctx: runSetCtx });
        return { runId: runSetCtx.runSetId + "/x", outDir: "x", result: fakeResult("pass") };
      },
    });

    expect(calls).toHaveLength(3);
    expect(calls[0].ctx.attemptNumber).toBe(1);
    expect(calls[1].ctx.attemptNumber).toBe(2);
    expect(calls[2].ctx.attemptNumber).toBe(3);
    expect(result.summary?.overall.overallStatus).toBe("consistent_pass");
  });

  test("card-major serial: card[0] all attempts before card[1]", async () => {
    const cfg = baseConfig({ cards: ["a", "b"], passes: 2, kind: "batch" as const });
    const order: string[] = [];
    await runRunSet({
      ...cfg,
      executor: async ({ cardId, runSetCtx }) => {
        order.push(`${cardId}/${runSetCtx.attemptNumber}`);
        return { runId: "x", outDir: "x", result: fakeResult("pass") };
      },
    });
    expect(order).toEqual(["a/1", "a/2", "b/1", "b/2"]);
  });

  test("an attempt that throws is recorded as errored; loop continues", async () => {
    const cfg = baseConfig({ passes: 3 });
    const result = await runRunSet({
      ...cfg,
      executor: async ({ runSetCtx }) => {
        if (runSetCtx.attemptNumber === 2) throw new Error("kapow");
        return { runId: "x", outDir: "x", result: fakeResult("pass") };
      },
    });
    expect(result.summary?.perCard[0].byStatus.pass).toBe(2);
    expect(result.summary?.perCard[0].byStatus.errored).toBe(1);
    expect(result.summary?.perCard[0].cardStatus).toBe("mixed_with_errors");
  });

  test("writes set.json and summary.md", async () => {
    const cfg = baseConfig({ passes: 2 });
    const result = await runRunSet({
      ...cfg,
      executor: async () => ({ runId: "x", outDir: "x", result: fakeResult("pass") }),
    });
    expect(existsSync(join(cfg.resultsRoot, "run-sets", result.runSetId, "set.json"))).toBe(true);
    expect(existsSync(join(cfg.resultsRoot, "run-sets", result.runSetId, "summary.md"))).toBe(true);
  });

  test("cancel signal aborts after current attempt; remaining attempts marked cancelled", async () => {
    const cfg = baseConfig({ passes: 4 });
    const cancelToken = { cancelled: false };
    const result = await runRunSet({
      ...cfg,
      cancelToken,
      executor: async ({ runSetCtx }) => {
        if (runSetCtx.attemptNumber === 2) cancelToken.cancelled = true; // simulate cancel during attempt 2
        return { runId: "x", outDir: "x", result: fakeResult("pass") };
      },
    });
    // Attempts 1 and 2 completed (pass); 3 and 4 cancelled.
    expect(result.summary?.perCard[0].byStatus.pass).toBe(2);
    expect(result.summary?.perCard[0].byStatus.cancelled).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests; expect fail**

Run: `bun test test/runs/run-set.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the orchestrator**

```ts
// src/runs/run-set.ts
import { RunSetWriter } from "../evidence/run-set-writer";
import { makeRunSetId, makeRunId } from "../util/id";
import type { RunSetCtx, RunSetKind } from "./run-set-types";
import type { VetResult } from "../types";

export interface ExecutorArgs {
  cardId: string;
  runSetCtx: RunSetCtx;
  // The orchestrator hands the executor a stable runId so set.json's
  // pre-populated runs[] matches what the executor will write to disk.
  runId: string;
}

export interface ExecutorReturn {
  runId: string;
  outDir: string;
  result: VetResult;
}

export type Executor = (args: ExecutorArgs) => Promise<ExecutorReturn>;

export interface CancelToken {
  cancelled: boolean;
}

export interface RunSetConfig {
  resultsRoot: string;
  cards: string[];
  passes: number;
  kind: RunSetKind;
  executor: Executor;
  /**
   * Optional override for runId generation. Defaults to makeRunId(cardId).
   * Only override in tests for deterministic output.
   */
  generateRunId?: (cardId: string, attemptNumber: number) => string;
  cancelToken?: CancelToken;
  /**
   * Optional hook fired immediately after the orchestrator generates all
   * runIds. Lets the caller pre-register attempts in ActiveRunRegistry.
   */
  onAllRunsKnown?: (runs: Array<{ runId: string; cardId: string; attemptNumber: number }>) => void;
}

export interface RunSetResult {
  runSetId: string;
  runs: Array<{ runId: string; cardId: string; attemptNumber: number; status: string }>;
  summary: {
    perCard: Array<{ cardId: string; cardStatus: string; byStatus: Record<string, number> }>;
    overall: { overallStatus: string; byStatus: Record<string, number>; totalRuns: number };
  } | null;
}

export async function runRunSet(cfg: RunSetConfig): Promise<RunSetResult> {
  const runSetId = makeRunSetId(cfg.kind);
  const gen = cfg.generateRunId ?? ((cardId, _i) => makeRunId(cardId));

  // Eagerly generate all runIds so set.json is fully populated up front.
  const allRuns: Array<{ runId: string; cardId: string; attemptNumber: number }> = [];
  for (let cardIndex = 0; cardIndex < cfg.cards.length; cardIndex++) {
    for (let attemptNumber = 1; attemptNumber <= cfg.passes; attemptNumber++) {
      allRuns.push({
        runId: gen(cfg.cards[cardIndex], attemptNumber),
        cardId: cfg.cards[cardIndex],
        attemptNumber,
      });
    }
  }
  cfg.onAllRunsKnown?.(allRuns);

  const ctx0: RunSetCtx = {
    runSetId,
    kind: cfg.kind,
    passes: cfg.passes,
    cards: cfg.cards,
    cardIndex: 0,
    attemptNumber: 1,
  };
  const writer = new RunSetWriter(cfg.resultsRoot, ctx0);
  writer.start(allRuns);

  const resultsByRunId = new Map<string, VetResult>();

  outer: for (let cardIndex = 0; cardIndex < cfg.cards.length; cardIndex++) {
    for (let attemptNumber = 1; attemptNumber <= cfg.passes; attemptNumber++) {
      if (cfg.cancelToken?.cancelled) break outer;

      const idx = allRuns.findIndex(
        (r) => r.cardId === cfg.cards[cardIndex] && r.attemptNumber === attemptNumber,
      );
      const runEntry = allRuns[idx];
      const ctx: RunSetCtx = { ...ctx0, cardIndex, attemptNumber };

      writer.recordRunStart(runEntry.runId);
      try {
        const ret = await cfg.executor({
          cardId: cfg.cards[cardIndex],
          runSetCtx: ctx,
          runId: runEntry.runId,
        });
        resultsByRunId.set(runEntry.runId, ret.result);
        writer.recordRunEnd(runEntry.runId, ret.result.status);
      } catch (_e) {
        writer.recordRunEnd(runEntry.runId, "errored");
      }
    }
  }

  // Mark anything still queued as cancelled.
  for (const r of allRuns) {
    // We can read back set.json, but easier: track our own state.
  }
  // Re-fetch the writer's view via a sneaky finalize-and-mark step:
  if (cfg.cancelToken?.cancelled) {
    for (const r of allRuns) {
      if (!resultsByRunId.has(r.runId)) {
        // Was either errored (already recorded) or never started.
        // recordRunEnd is idempotent for status overwrite; we only mark
        // truly never-started runs. Detect those by re-reading set.json:
        // simplest: every entry currently still "queued" or "running" → cancelled.
        writer.recordRunEnd(r.runId, "cancelled"); // safe: if it was a real status, this overwrites; orchestrator only reaches here when cancelled, so the only "still queued" entries are post-cancel skips.
      }
    }
    // The above is too aggressive — it would clobber pass/fail entries.
    // Cleaner version: track a Set<string> of runIds we actually processed.
  }

  writer.finalize((runId) => resultsByRunId.get(runId) ?? null);

  // Read back the final manifest to construct the return value.
  const set = JSON.parse(
    require("fs").readFileSync(
      `${cfg.resultsRoot}/run-sets/${runSetId}/set.json`,
      "utf8",
    ),
  );
  return { runSetId, runs: set.runs, summary: set.summary };
}
```

- [ ] **Step 4: Spot the bug from Step 3 and fix it**

The cancel-tracking block above is buggy — it tries to mark cancelled entries by looking at "is the result missing" but that's also true for errored attempts. Fix by tracking processed run IDs explicitly:

Replace the cancellation block in the implementation with:

```ts
  const processedRunIds = new Set<string>();

  outer: for (let cardIndex = 0; cardIndex < cfg.cards.length; cardIndex++) {
    for (let attemptNumber = 1; attemptNumber <= cfg.passes; attemptNumber++) {
      if (cfg.cancelToken?.cancelled) break outer;

      const runEntry = allRuns.find(
        (r) => r.cardId === cfg.cards[cardIndex] && r.attemptNumber === attemptNumber,
      )!;
      const ctx: RunSetCtx = { ...ctx0, cardIndex, attemptNumber };

      writer.recordRunStart(runEntry.runId);
      processedRunIds.add(runEntry.runId);
      try {
        const ret = await cfg.executor({
          cardId: cfg.cards[cardIndex],
          runSetCtx: ctx,
          runId: runEntry.runId,
        });
        resultsByRunId.set(runEntry.runId, ret.result);
        writer.recordRunEnd(runEntry.runId, ret.result.status);
      } catch (_e) {
        writer.recordRunEnd(runEntry.runId, "errored");
      }
    }
  }

  // Anything we never started is `cancelled`.
  if (cfg.cancelToken?.cancelled) {
    for (const r of allRuns) {
      if (!processedRunIds.has(r.runId)) {
        writer.recordRunEnd(r.runId, "cancelled");
      }
    }
  }
```

- [ ] **Step 5: Run tests**

Run: `bun test test/runs/run-set.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add src/runs/run-set.ts test/runs/run-set.test.ts
git commit -m "feat(runs): RunSet orchestrator (cards × attempts loop) (PRI-1440)"
```

---

## Phase A.2 — CLI surface

User-visible. After this phase, `gauntlet run story.md --passes 3` and `gauntlet batch a.md b.md --passes 2` work end to end with a live table, a rollup row, and a cancel-on-SIGINT path.

### Task 7: Add `--passes` flag to args parsing

**Files:**
- Modify: `src/cli/args.ts` (existing flag sets at lines 33–44; `RunArgs` at 60–69; `BatchArgs` at 71–79; `parseRunArgs` ~line 156; `parseBatchArgs` ~line 206)
- Test: `test/cli/args.test.ts` (extend or create)

- [ ] **Step 1: Write the failing tests**

```ts
// test/cli/args.test.ts (extend existing or create)
import { describe, test, expect } from "bun:test";
import { parseArgs } from "../../src/cli/args";

describe("--passes flag", () => {
  test("run defaults to passes: 1 when omitted", () => {
    const args = parseArgs(["run", "story.md", "--target", "https://x"]);
    expect(args.command).toBe("run");
    if (args.command === "run") expect(args.passes).toBe(1);
  });

  test("run accepts --passes 3", () => {
    const args = parseArgs(["run", "story.md", "--target", "https://x", "--passes", "3"]);
    if (args.command === "run") expect(args.passes).toBe(3);
  });

  test("batch accepts --passes", () => {
    const args = parseArgs(["batch", "a.md", "b.md", "--target", "https://x", "--passes", "2"]);
    if (args.command === "batch") expect(args.passes).toBe(2);
  });

  test("rejects --passes 0", () => {
    expect(() => parseArgs(["run", "story.md", "--target", "https://x", "--passes", "0"])).toThrow(/passes/i);
  });

  test("rejects --passes 51 (over soft cap)", () => {
    expect(() => parseArgs(["run", "story.md", "--target", "https://x", "--passes", "51"])).toThrow(/passes/i);
  });

  test("rejects non-integer --passes", () => {
    expect(() => parseArgs(["run", "story.md", "--target", "https://x", "--passes", "1.5"])).toThrow(/passes/i);
  });
});
```

- [ ] **Step 2: Run tests; expect fail**

Run: `bun test test/cli/args.test.ts -t passes`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/cli/args.ts`:

1. Add `"passes"` to `RUN_ALLOWED` (around line 33–37). Since `BATCH_ALLOWED = new Set([...RUN_ALLOWED].filter(f => f !== "out"))`, batch inherits it automatically.

2. Add `passes: number` to `RunArgs` (lines 60–69) and `BatchArgs` (lines 71–79):

```ts
export interface RunArgs {
  // ...existing fields...
  passes: number;
}

export interface BatchArgs {
  // ...existing fields...
  passes: number;
}
```

3. In `parseRunArgs` and `parseBatchArgs`, parse and validate:

```ts
function parsePasses(raw: string | undefined): number {
  if (raw === undefined) return 1;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 50) {
    throw new Error(`--passes must be an integer in [1, 50], got: ${raw}`);
  }
  return n;
}

// In parseRunArgs:
const passes = parsePasses(flags.passes);
return { command: "run", /* ...existing fields..., */ passes, cli: cliArgs };

// Same in parseBatchArgs.
```

- [ ] **Step 4: Run tests**

Run: `bun test test/cli/args.test.ts`
Expected: PASS, all new tests + existing.

- [ ] **Step 5: Commit**

```bash
git add src/cli/args.ts test/cli/args.test.ts
git commit -m "feat(cli): add --passes flag to run and batch (PRI-1440)"
```

---

### Task 8: Plumb `passes` into `BatchOptions`

**Files:**
- Modify: `src/cli/batch.ts` (`BatchOptions` interface lines 9–19)

This task plumbs the field into the type, but does not yet change the loop. The default-1 case keeps today's behavior.

- [ ] **Step 1: Extend `BatchOptions`**

```ts
// src/cli/batch.ts, in BatchOptions interface:
  passes: number;
```

- [ ] **Step 2: Update the call site that builds `BatchOptions`**

Find where the CLI entry point (likely `src/cli/index.ts` or `src/index.ts`) constructs `BatchOptions` from `BatchArgs`. Add `passes: args.passes`. The recon doc says:

```
src/cli/batch.ts:9-19   BatchOptions
src/cli/run.ts:6-15     RunCommandOptions
```

Find the call site by `grep -rn "runBatch(" src/` or `grep -rn "as BatchOptions" src/`. Add `passes: args.passes` to whatever object is being built.

- [ ] **Step 3: Run typecheck**

Run: `bun run tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run existing batch tests**

Run: `bun test test/cli/batch`
Expected: still PASS — no behavior change.

- [ ] **Step 5: Commit**

```bash
git add src/cli/batch.ts src/cli/index.ts  # adjust paths to actual call sites
git commit -m "feat(cli): plumb passes into BatchOptions (PRI-1440)"
```

---

### Task 9: Plumb `passes` into `RunCommandOptions`

**Files:**
- Modify: `src/cli/run.ts` (`RunCommandOptions` interface lines 6–15)

Symmetric to Task 8.

- [ ] **Step 1: Extend `RunCommandOptions`**

```ts
// src/cli/run.ts, in RunCommandOptions interface:
  passes: number;
```

- [ ] **Step 2: Update the call site to pass `args.passes`**

- [ ] **Step 3: Typecheck + existing tests**

Run: `bun run tsc --noEmit && bun test test/cli/run` (whichever paths exist)
Expected: PASS, no behavior change.

- [ ] **Step 4: Commit**

```bash
git add src/cli/run.ts src/cli/index.ts
git commit -m "feat(cli): plumb passes into RunCommandOptions (PRI-1440)"
```

---

### Task 10: Extend `BatchTableRenderer` to accept `attemptNumber` (no rollup yet)

**Files:**
- Modify: `src/cli/stream/batch-table.ts` (lines 46–304)
- Test: `test/cli/stream/batch-table.test.ts` (extend)

The renderer's existing methods take `cardId`. We add an optional `attemptNumber` parameter (defaults to 1) and re-key internal state by `(cardId, attemptNumber)`. Behavior with `attemptNumber === 1` is byte-identical to today.

- [ ] **Step 1: Write tests for the new keying first**

```ts
// test/cli/stream/batch-table.test.ts (extend)
describe("BatchTableRenderer (attemptNumber)", () => {
  test("attemptNumber defaults to 1, behavior unchanged", () => {
    const sink = collect();
    const r = new BatchTableRenderer(sink, NON_TTY);
    r.setQueued("story-a");
    r.setRunning("story-a", "story-a_t1_x", 50);
    r.onTurn("story-a", 1);
    r.setDone("story-a", "pass", 5);
    r.finalize();
    expect(sink.out).toContain("story-a");
    expect(sink.out).toContain("pass");
  });

  test("two attempts of same card render distinct rows", () => {
    const sink = collect();
    const r = new BatchTableRenderer(sink, NON_TTY);
    r.setQueued("story-a", 1);
    r.setQueued("story-a", 2);
    r.setRunning("story-a", "story-a_t1_x", 50, 1);
    r.setDone("story-a", "pass", 5, 1);
    r.setRunning("story-a", "story-a_t2_y", 50, 2);
    r.setDone("story-a", "fail", 7, 2);
    r.finalize();
    // Both attempts represented in non-TTY append output:
    expect(sink.out.match(/story-a.*pass/)).toBeTruthy();
    expect(sink.out.match(/story-a.*fail/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests; expect fail**

Run: `bun test test/cli/stream/batch-table.test.ts -t attemptNumber`
Expected: FAIL — methods don't accept the extra arg yet.

- [ ] **Step 3: Implement**

In `src/cli/stream/batch-table.ts`:

1. Change the row key. Today rows are keyed by `cardId`. Replace `private rows = new Map<string, CardRow>()` with `private rows = new Map<string, CardRow>()` where the key is `${cardId}#${attemptNumber}`. Add a helper:

```ts
private rowKey(cardId: string, attemptNumber = 1): string {
  return `${cardId}#${attemptNumber}`;
}
```

2. Change `setQueued`, `setRunning`, `onTurn`, `setDone`, `setErrored` to accept an optional `attemptNumber: number = 1` as the last param. Internally use `this.rowKey(cardId, attemptNumber)` to look up / create rows.

3. Add `attemptNumber` and `passes` to `CardRow`:

```ts
interface CardRow {
  cardId: string;
  attemptNumber: number;
  passes: number;
  // ...existing fields...
}
```

4. Default `attemptNumber=1, passes=1` if not provided. The non-TTY append output and the TTY commit pattern stay the same — just the row identity differs.

- [ ] **Step 4: Run tests**

Run: `bun test test/cli/stream/batch-table.test.ts`
Expected: PASS, all (existing + new).

- [ ] **Step 5: Commit**

```bash
git add src/cli/stream/batch-table.ts test/cli/stream/batch-table.test.ts
git commit -m "feat(cli): BatchTableRenderer keyed by (cardId, attemptNumber) (PRI-1440)"
```

---

### Task 11: Add per-card rollup as a third permanent line on the final attempt's commit

**Files:**
- Modify: `src/cli/stream/batch-table.ts`
- Test: `test/cli/stream/batch-table.test.ts`

The two-line commit (status line + run-dir hint) becomes a three-line commit when the row's `attemptNumber === passes` for that card. The third line is the rollup. This preserves the "result lines never move once written" invariant.

- [ ] **Step 1: Write the test**

```ts
describe("BatchTableRenderer rollup line", () => {
  test("emits rollup as third line on final attempt of each card", () => {
    const sink = collect();
    const r = new BatchTableRenderer(sink, NON_TTY);
    // 3 attempts of one card: pass, pass, investigate → cardStatus=mixed
    r.setRunning("story-a", "rA1", 50, 1, 3);
    r.setDone("story-a", "pass", 5, 1, 3);
    r.setRunning("story-a", "rA2", 50, 2, 3);
    r.setDone("story-a", "pass", 6, 2, 3);
    r.setRunning("story-a", "rA3", 50, 3, 3);
    r.setDone("story-a", "investigate", 8, 3, 3);
    r.finalize();
    // Rollup line should appear after the third attempt's commit:
    expect(sink.out).toContain("mixed");
    expect(sink.out.match(/story-a/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  test("no rollup line when passes === 1 (default)", () => {
    const sink = collect();
    const r = new BatchTableRenderer(sink, NON_TTY);
    r.setRunning("story-a", "rA1", 50);
    r.setDone("story-a", "pass", 5);
    r.finalize();
    expect(sink.out).not.toContain("mixed");
    expect(sink.out).not.toContain("consistent_pass");
  });
});
```

- [ ] **Step 2: Implement**

In `setDone` and `setErrored`, after writing the existing two-line commit, check if `row.attemptNumber === row.passes`. If yes, compute the per-card rollup from the renderer's accumulated rows for that `cardId` and write a third line:

```ts
// Add a method:
private rollupFor(cardId: string): { cardStatus: SetBucket; medianTurns: number; medianDurationMs: number } | null {
  const rowsForCard = [...this.rows.values()].filter((r) => r.cardId === cardId);
  if (rowsForCard.length === 0) return null;
  const passes = rowsForCard[0].passes;
  if (passes <= 1) return null; // no rollup for solo
  const allDone = rowsForCard.every((r) => r.state === "done" || r.state === "errored");
  if (!allDone) return null;
  // Tally and derive — use the same logic as RunSetWriter.deriveBucket.
  // For DRY: import deriveBucket from a shared module.
  // ...
}
```

To keep things DRY, extract `deriveBucket` and `median` from `RunSetWriter` into a small shared module `src/runs/aggregate.ts` and import from both places. (If you do this in a separate commit, reference it in the commit message.)

After the existing two-line commit in `setDone`/`setErrored`, write the rollup line if `rollupFor(cardId)` returns non-null.

For TTY mode, ensure the third line increments the `pendingBlankAboveSpinner` accounting so the next card's spinner positioning is correct: a 3-line commit means an extra `\n` to count when the next `setRunning` arrives.

- [ ] **Step 3: Run tests**

Run: `bun test test/cli/stream/batch-table.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit (consider as 1-2 commits)**

```bash
git add src/runs/aggregate.ts src/evidence/run-set-writer.ts src/cli/stream/batch-table.ts test/cli/stream/batch-table.test.ts
git commit -m "feat(cli): per-card rollup on final attempt commit (PRI-1440)"
```

---

### Task 12: Refactor `runBatch` to call the orchestrator

**Files:**
- Modify: `src/cli/batch.ts` (existing loop at lines 50–100)
- Test: existing `test/cli/batch.test.ts` should continue to PASS unchanged

`runBatch` today loops `for (const c of cards) await runOne(...)`. Replace with a call to `runRunSet({ cards, passes, executor: runOne, ... })`. When `passes === 1`, the orchestrator's behavior collapses to today's batch (the orchestrator still creates a RunSet because `cards.length > 1`).

When `passes === 1 && cards.length === 1` is impossible here — `runBatch` requires >= 1 card and a single card with passes=1 wouldn't go through batch. But when `passes === 1 && cards.length === 1` happens via `gauntlet batch a.md` (which is a degenerate batch with 1 card and 1 pass), we still create a RunSet because the user *invoked batch*. That matches the spec: the kind prefix tells you whether the user invoked single or batch.

Actually re-read the spec: "A solo `gauntlet run story.md` (1 card × 1 pass) does **not** produce a RunSet — it is byte-identical to today." This refers to `run`, not `batch`. For `batch` with one card and passes=1, the existing batch tests already produce per-card output but no aggregated artifact. To preserve compatibility, when `passes === 1` and the invocation is `batch`, **still skip RunSet creation** to keep on-disk byte-equivalence with today's batch.

Actually that's wrong too — we *want* batch to produce a RunSet artifact when passes>1 OR cards>1. For passes=1 cards=1 in batch, byte-equivalence means no RunSet artifact. For passes=1 cards>1 in batch (today's typical batch), the spec is silent on whether the artifact gets created. Re-reading the Decisions section: "passes > 1, or cards > 1, or both" creates a RunSet. So `batch a.md b.md` (cards>1) **does** create a RunSet artifact.

That's a small on-disk impact for current batch users (one extra `<.gauntlet>/run-sets/batch_…/` dir per `gauntlet batch` call). The spec accepts this; the change is additive.

- [ ] **Step 1: Replace the loop**

In `src/cli/batch.ts`, replace the `for (const c of cards) { ... }` block with:

```ts
import { runRunSet } from "../runs/run-set";

// Inside runBatch:
const cardIds = cards.map((c) => c.id);
const useRunSet = opts.passes > 1 || cardIds.length > 1;
if (useRunSet) {
  const setResult = await runRunSet({
    resultsRoot: getResultsRoot(opts.config),
    cards: cardIds,
    passes: opts.passes,
    kind: "batch",
    executor: async ({ cardId, runSetCtx, runId }) => {
      const card = cards.find((c) => c.id === cardId)!;
      const onLogger = makeBatchObserver(renderer, cardId, runSetCtx); // existing observer wiring
      return runOneImpl({
        scenarioPath: card.scenarioPath,
        target: opts.target,
        adapterType: opts.adapterType,
        config: opts.config,
        onLogger,
        runSetCtx,
        // explicit runId override is not currently a runOne option;
        // see Task 6's generateRunId hook — pass it through if needed
      });
    },
  });
  // Compute exit code from setResult.summary
} else {
  // Single card, single pass — preserve today's batch behavior exactly:
  // call runOneImpl once, no RunSet artifact.
  // (This branch is only hit by `gauntlet batch a.md` with no --passes.)
}
```

The implementation needs `getResultsRoot(config)` — find the existing helper in `src/cards/store.ts` or wherever results paths come from. Match the existing convention.

The `runId` ownership question: `runRunSet` generates runIds eagerly (via `generateRunId` or `makeRunId`). `runOne` today calls `makeRunId(card.id)` itself. To make the runIds match what's in `set.json#runs[]`, `runOne` needs to accept an externally-provided runId. **Add an optional `runId?: string` to `RunOneOptions`** and use it when present. This is a small extension to Task 3.

- [ ] **Step 2: Extend `RunOneOptions` with `runId?: string` (back-fill from Task 3)**

```ts
// src/cli/run-one.ts
export interface RunOneOptions {
  // ...existing...
  runId?: string;  // override for orchestrator-generated runIds
}

// In runOne body, around line 45:
const runId = opts.runId ?? makeRunId(card.id);
```

- [ ] **Step 3: Run existing batch tests**

Run: `bun test test/cli/batch.test.ts`
Expected: PASS — single-card batch behavior unchanged; multi-card batch now produces a RunSet artifact (a new dir, but no behavioral regression).

- [ ] **Step 4: Add a focused integration test for multi-card batch with `passes=1`**

```ts
test("gauntlet batch a.md b.md (passes=1) produces a RunSet artifact", async () => {
  // ...assert that .gauntlet/run-sets/batch_*/ exists with set.json
  // ...assert that set.json has 2 runs (one per card)
});
```

- [ ] **Step 5: Commit**

```bash
git add src/cli/batch.ts src/cli/run-one.ts test/cli/batch.test.ts
git commit -m "feat(cli): runBatch routes through RunSet orchestrator (PRI-1440)"
```

---

### Task 13: Refactor `run` to use orchestrator when `passes > 1`

**Files:**
- Modify: `src/cli/run.ts`

For solo runs (`passes === 1`), keep today's code path exactly as is — no orchestrator, no RunSet. For `passes > 1`, route through `runRunSet({ kind: "single", cards: [card.id], passes, executor: runOne })`.

- [ ] **Step 1: Update `run`**

```ts
// src/cli/run.ts
import { runRunSet } from "../runs/run-set";

export async function run(opts: RunCommandOptions): Promise<void> {
  if (opts.passes === 1) {
    // existing behavior, unchanged
    await runOne({ /* existing args */ });
    return;
  }
  // Multi-pass:
  const card = await loadCard(opts.scenarioPath);
  const setResult = await runRunSet({
    resultsRoot: getResultsRoot(opts.config),
    cards: [card.id],
    passes: opts.passes,
    kind: "single",
    executor: async ({ runSetCtx }) => {
      const onLogger = makeRendererObserver(/* existing wiring */, runSetCtx);
      return runOne({
        scenarioPath: opts.scenarioPath,
        target: opts.target,
        adapterType: opts.adapterType,
        config: opts.config,
        onLogger,
        runSetCtx,
      });
    },
  });
  // Print rollup summary to stdout (mirroring batch's final summary)
}
```

For `passes > 1` single-card runs, the renderer choice is the same as batch: use `BatchTableRenderer` (it now supports the `(cardId, attemptNumber)` keying). The single-card pretty `PrettyRenderer` is bypassed when `passes > 1`.

- [ ] **Step 2: Run existing run tests**

Run: `bun test test/cli/run.test.ts`
Expected: PASS — `passes === 1` is unchanged.

- [ ] **Step 3: Commit**

```bash
git add src/cli/run.ts
git commit -m "feat(cli): gauntlet run routes through RunSet for --passes > 1 (PRI-1440)"
```

---

### Task 14: SIGINT handler for graceful cancel

**Files:**
- Modify: `src/cli/run.ts` and/or `src/cli/batch.ts` (or a shared `src/cli/signals.ts`)

When a multi-pass run is in flight, first Ctrl-C should set the orchestrator's `cancelToken.cancelled = true`, let the current attempt finish (or abort via the existing `adapter.close()` in `runOne`'s `finally`), mark remaining attempts cancelled in `set.json`, finalize, and exit `130`. Second Ctrl-C within ~2s force-exits.

- [ ] **Step 1: Create `src/cli/signals.ts`**

```ts
// src/cli/signals.ts
import type { CancelToken } from "../runs/run-set";

export function installSigintHandler(token: CancelToken): () => void {
  let firedOnce = false;
  let firedAt = 0;

  const handler = () => {
    const now = Date.now();
    if (firedOnce && now - firedAt < 2000) {
      // Hard exit
      process.stderr.write("\nReceived second SIGINT, forcing exit.\n");
      process.exit(130);
    }
    firedOnce = true;
    firedAt = now;
    token.cancelled = true;
    process.stderr.write("\nReceived SIGINT, cancelling… (Ctrl-C again to force exit)\n");
  };

  process.on("SIGINT", handler);
  return () => process.removeListener("SIGINT", handler);
}
```

- [ ] **Step 2: Wire into `run` and `batch` for multi-pass paths**

```ts
// In run.ts and batch.ts, where you call runRunSet:
const cancelToken = { cancelled: false };
const detach = installSigintHandler(cancelToken);
try {
  await runRunSet({ /* ..., */ cancelToken });
} finally {
  detach();
}
if (cancelToken.cancelled) process.exit(130);
```

- [ ] **Step 3: Test**

```ts
// test/cli/cancel.test.ts
import { describe, test, expect } from "bun:test";
import { runRunSet } from "../../src/runs/run-set";

describe("cancel via cancelToken", () => {
  test("cancels remaining attempts after current finishes", async () => {
    // (same shape as the cancel test in run-set.test.ts; this is a duplicate
    //  intentionally to test the CLI signal wiring — but the actual signal
    //  install is hard to test in-process. Either:
    //  (a) test installSigintHandler in isolation by calling its handler
    //      programmatically and asserting token mutation;
    //  (b) skip integration; the logic was tested in Task 6.)
  });

  test("installSigintHandler: first call sets token, returns detach", () => {
    const token = { cancelled: false };
    const onSpy = jest.spyOn(process, "on");        // bun:test ships jest API
    const removeSpy = jest.spyOn(process, "removeListener");

    const detach = installSigintHandler(token);
    expect(onSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));

    // Pull the registered handler and invoke it directly:
    const handler = (onSpy.mock.calls.find((c) => c[0] === "SIGINT") as [string, Function])[1];
    handler();
    expect(token.cancelled).toBe(true);

    detach();
    expect(removeSpy).toHaveBeenCalledWith("SIGINT", handler);
  });

  // The "second SIGINT within 2s force-exits" branch calls process.exit,
  // which crashes the test runner. It's covered by the manual sanity in
  // Task 17. If you want machine coverage, refactor installSigintHandler
  // to take an injectable `exit` callback (e.g. `(code) => never`) and
  // assert that callback is invoked. Out of scope here.
});
```

- [ ] **Step 4: Commit**

```bash
git add src/cli/signals.ts src/cli/run.ts src/cli/batch.ts test/cli/cancel.test.ts
git commit -m "feat(cli): SIGINT cancel for multi-pass runs (PRI-1440)"
```

---

### Task 15: Integration test — `gauntlet run --passes 3` end to end

**Files:**
- Create: `test/cli/run-passes.test.ts`

- [ ] **Step 1: Write the test using the existing `cli` adapter against a stub fixture**

```ts
// test/cli/run-passes.test.ts
import { describe, test, expect } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { run } from "../../src/cli/run";
// Existing test helper — find the one that builds AppConfig with cli adapter:
import { makeTestConfig } from "../helpers/config"; // adjust to actual helper path

describe("gauntlet run --passes 3 (cli adapter)", () => {
  test("creates 3 per-run dirs and one run-set dir; aggregates correctly", async () => {
    const root = mkdtempSync(join(tmpdir(), "gauntlet-mp-"));
    const config = makeTestConfig({ resultsRoot: root /* etc */ });

    await run({
      scenarioPath: "test/fixtures/stories/trivial-pass.md", // or your standard pass-stub
      target: "stub",
      adapterType: "cli",
      config,
      silent: true,
      format: undefined,
      noColor: true,
      passes: 3,
    });

    const resultsDir = join(root, "results");
    const runDirs = readdirSync(resultsDir);
    expect(runDirs.length).toBe(3); // 3 per-run directories

    const setsDir = join(root, "run-sets");
    expect(existsSync(setsDir)).toBe(true);
    const setIds = readdirSync(setsDir);
    expect(setIds).toHaveLength(1);
    expect(setIds[0]).toMatch(/^single_/);

    const setManifest = JSON.parse(readFileSync(join(setsDir, setIds[0], "set.json"), "utf8"));
    expect(setManifest.passes).toBe(3);
    expect(setManifest.runs).toHaveLength(3);
    expect(setManifest.summary.overall.overallStatus).toBe("consistent_pass");

    // Each per-run result.json has runSet field
    for (const d of runDirs) {
      const rj = JSON.parse(readFileSync(join(resultsDir, d, "result.json"), "utf8"));
      expect(rj.runSet?.runSetId).toBe(setIds[0]);
    }
  });

  test("--passes 1 (default) produces no RunSet artifact", async () => {
    const root = mkdtempSync(join(tmpdir(), "gauntlet-mp-"));
    const config = makeTestConfig({ resultsRoot: root });
    await run({
      scenarioPath: "test/fixtures/stories/trivial-pass.md",
      target: "stub",
      adapterType: "cli",
      config,
      silent: true,
      format: undefined,
      noColor: true,
      passes: 1,
    });
    expect(existsSync(join(root, "run-sets"))).toBe(false);
    const resultsDir = join(root, "results");
    const runDirs = readdirSync(resultsDir);
    expect(runDirs).toHaveLength(1);
    const rj = JSON.parse(readFileSync(join(resultsDir, runDirs[0], "result.json"), "utf8"));
    expect(rj.runSet).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run**

Run: `bun test test/cli/run-passes.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 3: Commit**

```bash
git add test/cli/run-passes.test.ts
git commit -m "test(cli): end-to-end --passes 3 (PRI-1440)"
```

---

### Task 16: Integration test — `gauntlet batch a.md b.md --passes 2`

**Files:**
- Create: `test/cli/batch-passes.test.ts`

- [ ] **Step 1: Write the test**

```ts
// test/cli/batch-passes.test.ts
import { describe, test, expect } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runBatch } from "../../src/cli/batch";
import { runOne } from "../../src/cli/run-one";
import { makeTestConfig } from "../helpers/config";

describe("gauntlet batch --passes 2", () => {
  test("4 per-run dirs (2 cards × 2 passes), one run-set dir", async () => {
    const root = mkdtempSync(join(tmpdir(), "gauntlet-mpb-"));
    const config = makeTestConfig({ resultsRoot: root });

    await runBatch({
      scenarioPaths: ["test/fixtures/stories/trivial-pass.md", "test/fixtures/stories/trivial-pass.md"], // adjust if you need two distinct fixtures
      target: "stub",
      adapterType: "cli",
      config,
      silent: true,
      format: undefined,
      noColor: true,
      sink: { write: () => {} },
      isTTY: false,
      passes: 2,
    }, runOne);

    const setsDir = join(root, "run-sets");
    const setIds = readdirSync(setsDir);
    expect(setIds).toHaveLength(1);
    expect(setIds[0]).toMatch(/^batch_/);

    const set = JSON.parse(readFileSync(join(setsDir, setIds[0], "set.json"), "utf8"));
    expect(set.passes).toBe(2);
    expect(set.cards).toHaveLength(2);
    expect(set.runs).toHaveLength(4);

    // Card-major order
    expect(set.runs[0].cardId).toBe(set.cards[0]);
    expect(set.runs[1].cardId).toBe(set.cards[0]);
    expect(set.runs[2].cardId).toBe(set.cards[1]);
    expect(set.runs[3].cardId).toBe(set.cards[1]);
  });
});
```

- [ ] **Step 2: Run**

Run: `bun test test/cli/batch-passes.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add test/cli/batch-passes.test.ts
git commit -m "test(cli): end-to-end batch --passes 2 (PRI-1440)"
```

---

### Task 17: Final sanity — full test suite passes

- [ ] **Step 1: Run the entire test suite**

Run: `bun test`
Expected: PASS, all tests including pre-existing ones.

- [ ] **Step 2: Hand-verify the CLI**

Run, in the worktree:

```bash
bun run src/index.ts run test/fixtures/stories/trivial-pass.md --target stub --adapter cli --passes 3
```

Verify the output shows three attempt rows, a rollup line, and that `.gauntlet/run-sets/single_*/set.json` exists with status `consistent_pass`.

```bash
bun run src/index.ts batch test/fixtures/stories/trivial-pass.md test/fixtures/stories/trivial-pass.md --target stub --adapter cli --passes 2
```

Verify four attempt rows, two rollup lines, and `.gauntlet/run-sets/batch_*/set.json` with `cards: [...]` of length 2.

- [ ] **Step 3: Move PRI-1440 to In Review and write the reflective comment**

Use the linear-ticket-lifecycle skill. The state transition is silent; the comment is honest, not performative.

- [ ] **Step 4: Final commit (if anything tweaked during sanity)**

```bash
git status
# If anything changed, commit it.
```

---

## Out of scope (Phase B — separate plan)

These belong to a follow-on plan that lands after Phase A is in users' hands:

- `POST /api/run/:id` body extension (`passes: N`) and the new uniform response shape.
- New endpoints: `GET /api/run-sets/:id`, `GET /api/run-sets/:id/summary`, `DELETE /api/run-sets/:id`, `DELETE /api/runs/:id`.
- `RunSetBroadcaster` WS channel.
- Web UI: `passes` field in `NewRunModal`, `/run-sets/:id` page, run-row badge in `RunsList`, cancel button.
- `ActiveRunRegistry` extension to surface queued attempts (Q8 in spec).

The orchestrator and `runSetCtx` plumbing in Phase A are already designed to plug into `executeRun` (Task 4). Phase B is mostly route handlers and React.
