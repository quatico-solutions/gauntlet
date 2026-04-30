# Multi-pass runs — design

**Status:** drafted overnight, reviewed by Tarquin (Bob 4f7a2c10), revised. Awaiting Matt's review of open questions.
**Author:** Mosscap (Bob 320e9b00/Opus 4.7)
**Linear:** [PRI-1440](https://linear.app/prime-radiant/issue/PRI-1440)
**Related:** PRI-1382 (CLI batch), `src/cli/run-one.ts`, `src/cli/batch.ts`, `src/api/routes/run.ts`, `src/api/ws.ts`, `src/api/active-runs.ts`, `src/util/id.ts`, `src/types.ts`, `src/evidence/writer.ts`, `ui/src/components/NewRunModal.tsx`
**Companion recon:** Raven, 2026-04-29 (in-conversation, not committed)
**Spec review:** Tarquin, 2026-04-29 (in-conversation, applied below)

---

## Problem

Gauntlet is an LLM-driven e2e testing tool. Each `gauntlet run` exercises the
SUT through a non-deterministic agent: the same story can pass on attempt 1,
fail on attempt 2, surface a different fail mode on attempt 3. That variance
is signal — sometimes more useful than a single pass/fail verdict — but the
tool today treats every run as a one-shot.

The only way to repeat a story is to invoke `gauntlet run` (or click "New
Run") N times by hand and read N independent result directories. A batch
run can only run *different* cards, never the same card twice. There is no
first-class concept of "run this card N times and tell me how it behaved
across the set."

We want to embrace stochasticity as part of the test signal. Same story, N
attempts, one aggregated answer.

## Goal

Add a `passes` dimension to both Single Run and Batch Run. One invocation
produces N independent runs of the same card (Single) or N runs of every
card (Batch), grouped under a stable identity, with an aggregated summary
on top of the per-pass results.

Per-pass runs continue to write to the same on-disk layout that exists
today. The new entity is the *group* — a `RunSet` — that sits above one or
more individual runs.

### In scope (v1)

- A `RunSet` entity with stable identity, persisted to disk.
- `--passes N` flag on `gauntlet run` (and same on `gauntlet batch`).
- `passes` field in `POST /api/run/:id` and the web UI's New Run modal.
- Aggregated summary across passes: per-status counts, derived "set status",
  median turns / median duration. Written to disk and exposed to the UI.
- CLI rendering: extend `BatchTableRenderer` to show one row per pass and
  one rollup row per card.
- Web UI: a Run Set view at `/run-sets/:id` showing all constituent passes
  side-by-side, with links into each pass's existing live and post-hoc
  views. Existing `/runs/:id` views are unchanged.

### Out of scope (v1)

- **Concurrent passes.** v1 runs passes strictly serially within a card.
  See open question Q6.
- **Cross-run-set comparison.** Showing "this card across the last K run
  sets" is a follow-on.
- **Statistical analysis beyond medians and counts.** No per-observation
  diffing across passes, no "which screenshots differ", no LLM-driven
  variance summary. Could be a follow-on once the data exists.
- **Re-running just the failures.** "Re-run the failures from this set"
  is a feature suggested by the UI but deferred.

## Decisions (summary)

- **New entity: `RunSet`.** A RunSet is a *non-trivial* group of runs
  produced by one invocation: passes > 1, or cards > 1, or both. A
  solo `gauntlet run story.md` (1 card × 1 pass) does **not** produce
  a RunSet — it is byte-identical to today. The UI and tooling only
  see the RunSet affordance when it adds something. (See "Why not
  one-RunSet-per-invocation" below.)
- **`--passes N` flag** on `run` and `batch`, default 1. `1` means
  today's behavior — no aggregate view, no extra disk artifacts, no
  changes to `result.json`.
- **Serial within a card; card-major within a batch.** v1 runs all N
  passes of `card[0]` serially, then all N passes of `card[1]`, etc.
  This iteration order is part of the v1 contract — concurrency v2
  may interleave (see Concurrency section).
- **Per-pass evidence is unchanged.** Each pass writes to its own
  `<.gauntlet>/results/<runId>/` exactly as today. The per-run
  `result.json` shape is unchanged for solo runs and gains an
  optional `runSet` field for runs that are part of a RunSet.
- **New on-disk artifact (RunSets only): `<.gauntlet>/run-sets/<runSetId>/`.**
  Holds `set.json` (manifest, includes the ordered runs list and the
  computed summary block) and `summary.md` (human readable). Disk
  linkage from set → runs is by runId in `set.json`.
- **Reverse pointer in `result.json` (RunSets only):** runs that
  belong to a RunSet gain an optional `runSet` field
  (`{ runSetId, kind, passes, cards, cardIndex, attemptNumber }`).
  Solo runs omit the field entirely.
- **Aggregate "set status" is a derived field**, not a stored verdict.
  Computed from the constituent statuses on read. v1 buckets:
  `consistent_pass`, `consistent_investigate`, `consistent_fail`,
  `mixed`, `mixed_with_errors`, `errored`. (See Aggregation policy.
  Q1 — bucket names are up for review.)
- **No new exit-code semantics yet.** `gauntlet run --passes 3` exits
  `0` iff every attempt is `pass`; otherwise `1`. Same rule as batch.
- **No `result.json` schema-version bump.** The `runSet` field is an
  optional additive change. Readers written for the current schema
  parse the new shape correctly (they ignore unknown fields).

## Identity and naming

```
RunSet                 — only created for non-trivial groupings
                         (passes > 1 or cards > 1).
  ├ runSetId           — primary key. <kind>_<YYYYMMDDTHHMMSSZ>_<nonce>
  │                       where kind ∈ {single, batch}.
  ├ passes             — N (>= 1)
  ├ cards              — list of cardIds (length 1 for single, >=1 for batch)
  └ runs[]             — runIds in deterministic order
                          (cardOrder × attemptOrder)

Run                    — unchanged from today. May gain one optional field:
  ├ runId              — unchanged. <cardId>_<YYYYMMDDTHHMMSSZ>_<nonce>
  └ runSet?            — { runSetId, kind, passes, cards, cardIndex,
                          attemptNumber }
                         Only present when this run is part of a RunSet.
```

`runSetId` format: `single_<ts>_<nonce>` or `batch_<ts>_<nonce>`. Generated
once when the CLI command parses or the API receives the request, before
any pass is dispatched. `attemptNumber` is 1-indexed; `passes` is the total.

The `kind` prefix exists so the id tells you whether this is a 1-card or
N-card grouping without a manifest read. `single` ⇒ `cards.length === 1`
and `passes > 1`. `batch` ⇒ `cards.length > 1` (and `passes >= 1`).

**Naming note: pass vs attempt.** "Pass" is overloaded here — it's both
the user-facing flag (`--passes 3`, what Matt asked for) and a possible
`VetStatus` (`pass | fail | investigate`). To avoid `attempt 1/3 → pass`
becoming `pass 1/3 → pass` in CLI output and code, the spec uses
**`attemptNumber`** as the per-run counter and **"attempt N/M"** in CLI
rendering, while keeping **`--passes N`** as the user-facing flag (Matt's
word). Q4 — Matt may prefer to fully rename to `--attempts` for
consistency.

**Timestamp note:** `runSetId.ts` is the orchestrator start time;
per-attempt `runId.ts` is each attempt's own start. So
`runSetId.ts <= runs[0].ts`, and listings sorted by timestamp will
group correctly. All timestamps are UTC, second-resolution; the nonce
disambiguates collisions.

## On-disk layout

```
<.gauntlet>/results/                              # unchanged
  <runId>/
    result.json                                   # gains optional runSet field
    result.md                                     #   (only when part of a RunSet)
    run.jsonl
    inputs/...
    screenshots/...
    issues/...

<.gauntlet>/run-sets/                             # NEW (only for RunSets)
  <runSetId>/
    set.json                                      # canonical manifest + summary
    summary.md                                    # human-readable rollup
```

`set.json` schema (v1):

```jsonc
{
  "schemaVersion": 1,
  "runSetId": "single_20260429T235959Z_abcd",
  "kind": "single" | "batch",
  "createdAt": "2026-04-29T23:59:59Z",
  "completedAt": "2026-04-30T00:14:22Z" | null,
  "passes": 3,
  "cards": ["login-ok"],
  // Eagerly populated at orchestrator start. All runIds known up
  // front (see "API surface" — no TBD placeholders).
  "runs": [
    { "runId": "login-ok_20260429T235959Z_a1b2", "cardId": "login-ok", "attemptNumber": 1 },
    { "runId": "login-ok_20260430T000022Z_c3d4", "cardId": "login-ok", "attemptNumber": 2 },
    { "runId": "login-ok_20260430T000051Z_e5f6", "cardId": "login-ok", "attemptNumber": 3 }
  ],
  // Computed at finalize() and rewritten in place.
  "summary": {
    "perCard": [
      {
        "cardId": "login-ok",
        "passes": 3,
        "byStatus": { "pass": 2, "fail": 0, "investigate": 1, "errored": 0 },
        "setStatus": "mixed",
        "medianTurns": 6,
        "medianDurationMs": 4210
      }
    ],
    "overall": {
      "totalRuns": 3,
      "byStatus": { "pass": 2, "fail": 0, "investigate": 1, "errored": 0 },
      "setStatus": "mixed"
    }
  }
}
```

Per-run additions to `result.json` (no schema-version bump — additive
optional field):

```jsonc
{
  // ...existing fields...
  "schemaVersion": 2,                              // unchanged
  "runSet": {                                      // optional, present
    "runSetId": "single_20260429T235959Z_abcd",   //   only when this run
    "kind": "single",                             //   is part of a RunSet
    "passes": 3,
    "cards": ["login-ok"],
    "cardIndex": 0,
    "attemptNumber": 2
  }
}
```

**Why not one-RunSet-per-invocation?** An earlier draft proposed every
run carry a RunSet (size 1 for solo runs) so the UI never special-cased
"solo run." Tarquin's review (F1) pointed out this contradicted itself,
created on-disk noise for users who never use multi-pass, and forced a
schema bump. Resolution: solo runs stay solo. The UI's special case is
one `if (run.runSet)` check; the disk impact is zero for users who don't
use the feature.

## CLI surface

`gauntlet run`:

```
gauntlet run <story.md> --target <url> [flags]
  ...existing flags...
  --passes <n>           Run the same card N times. Default: 1.
                         When > 1, output includes a per-pass table
                         and an aggregated summary; the run set is
                         persisted under <.gauntlet>/run-sets/<id>/.
```

`gauntlet batch`:

```
gauntlet batch <story1.md> [story2.md ...] --target <url> [flags]
  ...existing flags...
  --passes <n>           Run each card N times. Default: 1.
                         The batch produces one run set with cards × passes
                         total runs, executed serially.
```

Validation: `--passes 0` is a usage error. `--passes` must be a positive
integer. v1 ships with a soft cap of 50 (see Concurrency); Q6 covers
whether/when to add `--concurrency K`.

CLI output, multi-pass single run (default TTY mode), `--passes 3`.
"attempt N/M" deliberately avoids saying "pass" so it doesn't collide
with the `VetStatus = pass` verdict on the same line:

```
Gauntlet · login-ok · 3 attempts · target https://app.local

  ✓  attempt 1/3   pass          6 turns · 4.2s
        → /Users/mw/.gauntlet/results/login-ok_…_a1b2/
  !  attempt 2/3   investigate   9 turns · 8.1s
        → /Users/mw/.gauntlet/results/login-ok_…_c3d4/
  ⠋ [3/3] attempt 3/3   turn 4 / 50

run set: 1 pass · 0 fail · 1 investigate · 0 errored · mixed
set: <.gauntlet>/run-sets/single_…_abcd/
```

CLI output, batch with passes (default TTY mode),
`gauntlet batch a.md b.md --passes 2`:

```
Gauntlet · 2 cards × 2 attempts · target https://app.local

  ✓  login-ok          attempt 1/2   pass         6t 4.2s
  ✓  login-ok          attempt 2/2   pass         5t 3.9s
        → consistent_pass · median 5.5t / 4.0s
  ✗  login-locked-out  attempt 1/2   fail        10t 9.7s
  ⠋ [4/4] login-locked-out  attempt 2/2   turn 3 / 50
```

The per-card rollup is **part of the final attempt's commit** for that
card — it's the third permanent line written when
`attemptNumber === passes` (see Architecture §4 for why this matters
for the renderer's "result lines never move once written" invariant).
Batch overall summary at end mirrors today's batch summary plus a
"mixed / consistent / errored" breakdown.

`--silent` and `--format jsonl` interactions inherit batch mode's
contract. In jsonl mode, every per-attempt event is emitted with
both `runId` and (when in a RunSet) `runSetId` injected. There is
also one additional event class:

```
{ "kind": "run_set_summary", "runSetId": "...", ...summary block... }
```

emitted once at the end of the invocation (after the last
`run_end`).

## API surface

`POST /api/run/:id` body extension:

```jsonc
{
  // ...existing fields...
  "passes": 3   // optional, default 1
}
```

Response shape — **always** the new shape (back-compat: solo invocations
return a one-element `runs` array with `runSetId: null`). All N runIds
are generated eagerly at orchestrator start and embedded in the
response; no `TBD` placeholders.

```jsonc
// passes > 1 (RunSet)
{
  "runSetId": "single_20260429T235959Z_abcd",
  "kind": "single",
  "passes": 3,
  "runs": [
    { "runId": "login-ok_20260429T235959Z_a1b2", "attemptNumber": 1, "status": "running" },
    { "runId": "login-ok_20260429T235959Z_c3d4", "attemptNumber": 2, "status": "queued"  },
    { "runId": "login-ok_20260429T235959Z_e5f6", "attemptNumber": 3, "status": "queued"  }
  ]
}

// passes === 1 (solo, no RunSet)
{
  "runSetId": null,
  "kind": "single",
  "passes": 1,
  "runs": [
    { "runId": "login-ok_20260429T235959Z_a1b2", "attemptNumber": 1, "status": "running" }
  ]
}
```

The UI updates atomically — the response shape is uniform regardless of
`passes` value, no two-shape branch.

Eager runId generation: `makeRunId(cardId)` already includes a random
nonce, but the orchestrator generates all N at once. To eliminate any
timestamp-collision risk during a fast loop, the orchestrator uses one
base timestamp and embeds the attempt number into the nonce as a
prefix (e.g. `a1b2`, `a2c3`, `a3d4`) so attempts within a set are
guaranteed distinct without needing different `Date.now()` reads. Cross-set
collisions remain handled by the random portion of the nonce.

New endpoints:

- `GET /api/run-sets/:runSetId` — full manifest (`set.json`).
- `GET /api/run-sets/:runSetId/summary` — just the `summary` block
  (cheap polling endpoint while the set is in flight).
- `GET /api/run-sets?cardId=<id>&limit=...` — list of recent run sets
  for a card. (Optional in v1; gates on Q2 — UI surface scope.)

WebSocket: each pass continues to broadcast on its own per-`runId`
channel. There is a new top-level event the UI can subscribe to keyed
by `runSetId`:

```
ws://.../api/ws/run-sets/<runSetId>
```

Emits:

```
{ kind: "pass_start", runSetId, runId, attemptNumber, passes }
{ kind: "pass_end",   runSetId, runId, attemptNumber, finalStatus }
{ kind: "set_done",   runSetId, summary }
```

The per-pass `runs/live/:runId` WS channel is unchanged. The set-level
WS exists so the Run Set view can render progress without subscribing
to all N pass channels at once.

## Web UI

**New Run modal.** Adds a numeric input "Passes" (default 1) below the
existing turns/viewport row. When `passes > 1` and submit succeeds:
navigate to `/run-sets/:runSetId` instead of `/runs/live/:runId`.

**`/run-sets/:runSetId` view.** New page. Layout:

```
┌─ Run Set login-ok · 3 passes ─────────────────────────────┐
│ overall: 1 pass · 0 fail · 1 investigate · 0 errored      │
│ set status: mixed · median 6 turns · median 5.4s          │
├───────────────────────────────────────────────────────────┤
│ pass 1/3   ✓ pass          6 turns · 4.2s     [view] [transcript]
│ pass 2/3   ! investigate   9 turns · 8.1s     [view] [transcript]
│ pass 3/3   … running       turn 4 / 50        [watch live]
└───────────────────────────────────────────────────────────┘
```

For `kind: "batch"`, the layout groups by card:

```
┌─ Batch · 2 cards × 2 passes ──────────────────────────────┐
│ overall: 3 pass · 1 fail · 0 investigate · 0 errored      │
├ login-ok ─────────────────────────────────────────────────┤
│ pass 1/2  ✓ pass · 6t · 4.2s                              │
│ pass 2/2  ✓ pass · 5t · 3.9s                              │
│ rollup:   consistent_pass · median 5.5t / 4.0s            │
├ login-locked-out ─────────────────────────────────────────┤
│ pass 1/2  ✗ fail · 10t · 9.7s                             │
│ pass 2/2  … running · turn 3 / 50                         │
└───────────────────────────────────────────────────────────┘
```

Each pass row links to its `/runs/:runId` (post-hoc) or
`/runs/live/:runId` (live) view. The set view is the only new screen;
all per-pass screens are reused as-is.

**Run Again from a pass-set.** "Run Again" on `/run-sets/:id` prefills
the modal with the same `passes` count. (See Q2 — also allow "rerun
just the failed passes" or "rerun with passes+1"?)

**Sidebar / runs list.** When `RunsList` shows runs that belong to a
RunSet of size >= 2, the row shows a small badge: `pass 2/3 · set abc…`,
clickable to the set view. v1 does not collapse pass-set rows in the
list. (Q2 — would Matt prefer collapsed grouping by default?)

## Architecture

The serial-loop pattern from `src/cli/batch.ts` already implements
"run multiple cards once each, observe each, table on top." The
multi-pass extension builds on the same shape, but the seam has to
work on **both** call paths — the CLI's `runOne` (`src/cli/run-one.ts`)
*and* the API's `executeRun` (`src/api/routes/run.ts`). Today these
are parallel implementations: `runOne` is a synchronous wrapper, while
`executeRun` adds broadcaster, registry, and screencast wiring. The
multi-pass orchestrator drives whichever is appropriate for its caller.

1. **`RunSet` orchestrator** (new module, e.g. `src/runs/run-set.ts`).
   Owns the loop:
   ```
   for cardIndex in 0..cards.length-1:
     for attemptNumber in 1..passes:
       executor(cards[cardIndex], { ...opts, runSetCtx })
   ```
   `executor` is injected — `runOne` for the CLI, `executeRun` for
   the API. The orchestrator's only job is the loop, the ctx
   threading, the writer lifecycle, and error containment.

   - Cards × passes collapses to today's batch loop when `passes === 1`
     and to today's single run when `passes === 1` and
     `cards.length === 1`.
   - When `passes === 1 && cards.length === 1` the orchestrator is
     bypassed entirely — the existing single-run code path runs as
     today, no RunSet, no writer, no extra disk artifacts.

   The orchestrator is invoked from both `src/cli/run.ts` (single-card
   wrapper) and `src/cli/batch.ts` (multi-card wrapper). Each retains
   its thin command surface for argument parsing and renderer wiring;
   the loop body is unified.

2. **`runSetCtx` is the seam through *both* `runOne` and `executeRun`.**
   Both call sites grow an optional parameter:

   ```ts
   interface RunSetCtx {
     runSetId: string;
     kind: "single" | "batch";
     passes: number;
     cards: string[];          // cardIds, in order
     cardIndex: number;
     attemptNumber: number;
   }

   // src/cli/run-one.ts
   runOne(opts: RunOneOpts & { runSetCtx?: RunSetCtx }): Promise<RunSummary>;

   // src/api/routes/run.ts
   executeRun(opts: ExecuteRunOpts & { runSetCtx?: RunSetCtx }): Promise<void>;
   ```

   Both call paths route to `evidence/writer.ts`'s `writeResultFiles`,
   which gains a third parameter:

   ```ts
   writeResultFiles(outDir: string, result: VetResult, runSetCtx?: RunSetCtx): void;
   ```

   When `runSetCtx` is set, the writer stamps a `runSet` field into
   the `result.json` payload before serializing. The `VetResult` type
   in `src/types.ts` does **not** grow a `runSet` field — that
   metadata lives at the JSON level only, kept out of the in-memory
   result type so vetting logic stays orthogonal to set membership.
   (Alternative considered: add `runSet?` to `VetResult` directly. Q7
   below — happy to flip.)

3. **`RunSetWriter`** (new module under `src/evidence/`, e.g.
   `evidence/run-set-writer.ts`). Owns the `<.gauntlet>/run-sets/<id>/`
   directory:

   - `start(ctx, allRuns)`: creates the dir; writes the initial
     `set.json` with the eagerly-generated full `runs[]` (every runId
     is known up front, see "API surface") and `summary: null`,
     `completedAt: null`.
   - `recordRunStart(runId, attemptNumber)`: marks that run's status
     in `set.json#runs[i].status = "running"`.
   - `recordRunEnd(runId, finalStatus)`: marks
     `set.json#runs[i].status = finalStatus`. The full per-run details
     remain in `<.gauntlet>/results/<runId>/result.json`.
   - `finalize()`: reads each per-run `result.json`, computes the
     `summary` block, rewrites `set.json` with `completedAt` and the
     summary, writes `summary.md`.

   The writer is created by the orchestrator, not by `runOne` /
   `executeRun`. This keeps the per-run code paths ignorant of
   multi-pass concerns. `set.json` rewrites are full file writes
   (atomic via `fs.writeFile` to a temp + rename) — the file is small
   so this is cheap.

4. **`BatchTableRenderer` extension.** Today the renderer keys rows by
   `cardId`. Extend to key by `(cardId, attemptNumber)` and integrate
   the per-card rollup into the **commit pattern** (so it doesn't
   violate "result lines never move once written"). Concretely:

   ```ts
   class BatchTableRenderer {
     // existing API extends — attemptNumber defaults to 1, passes defaults to 1
     setQueued(cardId, attemptNumber?, passes?): void;
     setRunning(cardId, runId, maxTurns, attemptNumber?, passes?): void;
     onTurn(cardId, turn, attemptNumber?): void;
     setDone(cardId, finalStatus, turn, attemptNumber?): void;
     setErrored(cardId, turn|null, message, attemptNumber?): void;

     // batch-level totals, called once after all cards finish
     setOverall(overall): void;
   }
   ```

   - **Per-card rollup is implicit, not a separate API call.** When
     `setDone`/`setErrored` is called and the renderer notices
     `attemptNumber === passes` for that card, it commits a
     three-line block instead of two: status, run-dir hint, rollup
     line. This extends the existing two-line commit shape and
     keeps the "result lines never move once written" invariant
     intact.
   - The renderer's `pendingBlankAboveSpinner` accounting needs to
     understand a 3-line commit so the next card's spinner positions
     correctly.
   - For `passes === 1` the third line is suppressed and the renderer
     behaves exactly as today.
   - The renderer needs to compute the rollup itself from the per-pass
     records it has already seen — it does *not* read from
     `set.json` (which is still being written). Computing
     `byStatus`/`medianTurns`/`medianDurationMs` over N integers is
     trivial.

5. **HTTP route.** `src/api/routes/run.ts`'s `POST /api/run/:id`
   handler grows a `passes` validator (positive integer; usage error
   for 0; soft cap of 50 — see Concurrency).
   - When `passes > 1`, it generates all N runIds eagerly, builds the
     orchestrator with `executor = executeRun`, returns the new-shape
     `202` response with the full `runs[]`, and detaches the
     orchestrator as a background task.
   - When `passes === 1`, the response is the same shape (one-element
     `runs[]`, `runSetId: null`) and the existing `executeRun`
     codepath runs unchanged.
   - `ActiveRunRegistry` is updated by the orchestrator: all N runs
     are pre-registered with `status: "queued"` at orchestrator start,
     transitioning to `"running"` and then unregistered as each pass
     completes. (See Q8 — should `/api/active-runs` surface queued
     future passes? My recommendation: yes, pre-register.)

6. **WebSocket.** New `RunSetBroadcaster` in `src/api/ws.ts`, parallel
   to `RunBroadcaster` (not derived from it). The orchestrator emits
   set-level events (`pass_start`, `pass_end`, `set_done`) directly
   to the set broadcaster. Per-run events continue to flow through
   `RunBroadcaster` unchanged. Clients subscribe to one or both
   channels independently — the `/run-sets/:id` view subscribes to
   the set broadcaster and to each pass's run broadcaster as needed
   for live transcripts.

## Aggregation policy

Per-card aggregation across N attempts:

| field | computation |
|---|---|
| `byStatus` | count of each VetStatus across the N attempts |
| `setStatus` | derived bucket (see below) |
| `medianTurns` | median of `usage.turns` across the N attempts |
| `medianDurationMs` | median of `duration_ms` across the N attempts |

`setStatus` derivation (v1; six buckets; bucket names pending Q3):

```
all N pass                                → "consistent_pass"
all N investigate                         → "consistent_investigate"
all N fail                                → "consistent_fail"
all N errored                             → "errored"
mix WITHOUT errored                       → "mixed"
mix WITH errored AND at least one non-errored → "mixed_with_errors"
```

Rationale for splitting `errored`: an errored attempt is usually an
infra blip (Chrome crashed, network dropped) not a SUT signal. A 5-pass
set with 4 passes + 1 errored is `mixed_with_errors`, not `errored` —
that retains the "the SUT mostly passes" signal which would otherwise
be hidden. A set where every attempt errored *is* a useful "stop
running this, the infra is broken" signal, which the dedicated
`errored` bucket preserves.

Pessimism note: a mix of fail + investigate (no pass, no error) lands
in `mixed`, not `consistent_fail`. The earlier draft was pessimistic
about this; Tarquin (F4) caught the inconsistency. Treating it as
`mixed` is the more honest signal.

`setStatus` for `passes === 1`: the field is computed but the UI/CLI
**suppress the rollup display** when `passes === 1` (and at that point
RunSet creation is also suppressed — there's no rollup to show). The
field exists in `set.json` only when a RunSet exists.

Batch overall: sum `byStatus` counts across all cards. `setStatus` at
the batch level follows the same rules over the totals (e.g. one card
all-pass + one card all-fail → batch overall `mixed`).

We are explicitly **not** computing means or std-dev in v1. Median is
robust to one-off outliers (one slow attempt dragging the average) and
is enough to support "is this card slower than it used to be." For
`N === 2` the median collapses to the mean of the two values, which
we accept as a degenerate case.

## Concurrency

v1 is **card-major serial**: all attempts of `card[0]`, then all
attempts of `card[1]`, etc. The full ordering is part of v1's contract:

```
card[0].attempt[1] → card[0].attempt[2] → ... → card[0].attempt[N]
  → card[1].attempt[1] → ... → card[1].attempt[N]
  → ... → card[M-1].attempt[N]
```

A soft cap of `passes <= 50` ships in v1 to prevent accidental
1000-attempt invocations.

Concurrency v2 is anticipated but **not** locked in by this spec. Two
viable axes:

- **Across cards, serial within card.** Caps in-flight at
  `cards.length` browsers; preserves the "all attempts of this card
  see similar SUT load" property.
- **Interleaved.** `card[0].attempt[1] → card[1].attempt[1] → ...`,
  giving early-CTRL-C signal across all cards before any one card
  finishes.

v2 may pick either; v1 forecloses neither. The orchestrator's loop
is the only place this knowledge lives.

## Error handling

- **An attempt throws or its run errors:** caught at the orchestrator
  boundary, recorded in the set as `errored` for that attempt, the
  orchestrator continues to the next attempt. Same semantics as
  today's batch on per-card errors.
- **Card path missing or unparseable:** caught before the first
  attempt for that card, all N attempts for that card are recorded
  as `errored before start` in the set, no per-run dirs are created,
  the orchestrator continues to the next card.
- **SIGINT:** waits for the current attempt to finish (or aborts via
  the existing `adapter.close()` in the per-run `finally`), writes
  whatever has happened so far to `set.json`, emits `set_done` with
  partial summary, exits.
- **Orchestrator crash before `finalize()`:** `set.json` is left with
  `completedAt: null` and `summary: null`. A reader can detect this
  and recompute the summary from the `runs[]` pointers if the per-run
  `result.json` files exist. v1 accepts orphan sets; a follow-on
  `gauntlet finalize-set <runSetId>` CLI is the v2 escape hatch (a
  ~20-line addition that reads the per-run results and rewrites
  `set.json` with the computed summary).
- **Cancel while in flight (API users):** v1 has no cancel endpoint
  for run sets. Q9 covers the design.

## Testing

- **Unit:** `RunSetWriter` against scripted run sequences. Cover:
  start → recordRunStart × N → recordRunEnd × N → finalize; partial
  finalize; status derivation; median computation.
- **Refactor guard:** existing single-card `gauntlet run` tests must
  pass unmodified after the orchestrator extraction. Existing
  `gauntlet batch` tests must pass after `BatchTableRenderer`'s
  attemptNumber-aware extension.
- **Integration:**
  - `gauntlet run a.md` (no `--passes`): solo path, no RunSet
    artifact, `result.json` lacks `runSet` field. Byte-identical to
    today.
  - `gauntlet run a.md --passes 3` with the `cli` adapter against a
    stub. Assert: 3 per-run dirs created, one run-set dir, `set.json`
    has 3 runs (eagerly populated), summary computed at finalize,
    exit 0 if all 3 pass.
  - `gauntlet batch a.md b.md --passes 2`. Assert: 4 per-run dirs,
    one run-set dir with 4 runs ordered (a×2, b×2), per-card
    rollups committed in three-line form, batch-level rollup.
  - Mixed status: stub adapter returns `pass`, `pass`, `investigate`
    for `--passes 3` → `setStatus: "mixed"`.
  - Mixed-with-errors: stub returns `pass`, `pass`, throws on attempt 3
    → `setStatus: "mixed_with_errors"`, `byStatus: { pass: 2, errored: 1 }`.
    Orchestrator continues past errored attempts; no attempt is
    skipped.
  - All-errored: stub throws on every attempt → `setStatus: "errored"`.
- **Web:** snapshot test of `/run-sets/:id` with mock data for each
  bucket: `consistent_pass`, `mixed`, `mixed_with_errors`, `errored`,
  in-flight.

## Migration / compatibility

- `result.json` schemaVersion stays at **2** (no bump). The new
  `runSet` field is purely additive and optional; readers written for
  the current schema parse new shapes correctly.
- Old `result.json` files (v1, v2 without `runSet`) remain readable.
  The Run Set views and aggregation are forward-only — running them
  against historical runs is out of scope.
- `gauntlet run <story.md>` with no `--passes` (or `--passes 1`) is
  **byte-identical** to today's invocation. No new directories, no
  new files, no `runSet` field in `result.json`. The on-disk impact
  of this feature is zero for users who don't use it.
- `POST /api/run/:id` response shape changes from `{ runId, cardId }`
  to the new `{ runSetId, kind, passes, runs[] }` shape — applied
  uniformly regardless of `passes` value. The web UI is updated in
  the same change set; no external API consumers exist today.

## Phasing (for the implementation plan)

The spec implies enough scope to break implementation into three
gated commits:

1. **Identity + persistence + orchestrator.** `RunSetCtx` type, the
   orchestrator module, `RunSetWriter`, the optional `runSet` field
   in `result.json` (no schema bump — additive). The seam lands in
   both `runOne` and `executeRun` with the new optional parameter,
   but neither code path's existing callers pass it yet. No CLI
   flag, no API change. Solo runs are byte-identical to today. Unit
   tests on writer + ctx threading. No user-visible behavior change.
2. **CLI surface.** `--passes N` on `run` and `batch`. Extend
   `BatchTableRenderer` for `(cardId, attemptNumber)` keying and the
   three-line commit. Unit + integration tests on the loop. CLI
   users can multi-pass; web UI still does single-attempt.
3. **API + Web UI.** New uniform `POST /api/run/:id` response shape
   (single + multi). `passes` body field. `/api/run-sets/...` routes.
   `RunSetBroadcaster`. `/run-sets/:id` page. NewRunModal field.

If the team wants a tighter v1, phase 3 can ship CLI-only and the
web UI becomes a follow-on.

---

## Open Questions (queued for Matt)

These are decisions I made best-guesses on but want a sanity check.
Numbered for easy reference. Items the spec review (Tarquin)
flagged as no-brainers have already been decided in the body above
and removed from this list.

**Q1 — Set status bucket names.**
v1 proposes: `consistent_pass`, `consistent_investigate`,
`consistent_fail`, `mixed`, `mixed_with_errors`, `errored`. The word
"flaky" was considered for the mixed bucket but rejected because in
CI culture it usually means "the test is bad" — and here a mixed
result is more often "the SUT is non-deterministic" or "we just
measured stochasticity," which is the whole point of multi-pass.
Alternates I considered: `unstable`, `inconsistent`, plain `mixed`.
**My recommendation:** ship `mixed` / `mixed_with_errors`. Reverse
me with one word if `flaky` reads better in practice.

**Q2 — Web UI scope.**
Several UX details I made stub decisions on:
- Run Set view layout — drafted above; mockup-level only.
- `RunsList` row treatment for runs in a multi-pass set — drafted
  above as a badge, no row collapsing.
- "Rerun just the failed attempts" — flagged as out of scope.
- "Run Again with passes+1" / "Run Again same N" — drafted as
  "same N" for v1.
- Where the Run Set view lives in the sidebar nav.
**My recommendation:** ship the basics (the new page + modal field +
list badge), defer "rerun failures" and "+1 pass" to a follow-on.
Sidebar: a top-level "Run Sets" entry parallel to "Runs," paginated
the same way.

**Q3 — Naming: "RunSet" vs "Pass Set" vs "Ensemble."**
You used the word "passes." I used "RunSet" in the spec because it
generalizes across single+batch (a batch is also a RunSet, just
with multiple cards), and a "PassSet" feels card-specific. But
"RunSet" is a coined term and could feel jargony.
**My recommendation:** RunSet for the entity, "passes" for the
count, "attempt N/M" for individual constituents. If RunSet feels
wrong, alternates are: Run Group, Sweep, Trial Set, Ensemble.

**Q4 — `--passes` vs `--attempts` flag name.**
Spec keeps `--passes N` as the flag (matching your language) but
uses "attempt N/M" in CLI output and `attemptNumber` in code, to
avoid the cognitive collision with `VetStatus = pass`. The flag
mismatching the noun is a minor wart. Alternate: rename the flag
to `--attempts N` for consistency.
**My recommendation:** keep `--passes` — your word, and "I want
this to pass three times" reads natural. Live with the mild
internal naming mismatch.

**Q5 — "Run again" as a multi-pass invocation.**
Should the existing "Run Again" button on `/runs/:id` (a solo run)
gain a "Run Again × N" affordance? It would turn a solo run into a
multi-pass investigation in one click.
**My recommendation:** yes, but as a follow-on. Out of v1 scope.

**Q6 — Concurrency in v1?**
v1 is card-major serial. Reasons to keep serial:
- Browser profile names already include `runId` so concurrency
  works in principle, but each parallel browser session burns
  ~50MB.
- Stochasticity under timing pressure can be different from
  stochasticity under no contention.
- Aggregated medians are noisier with low N concurrent than serial.
Reasons to add it now:
- Wall clock. 10 attempts serial × 1 minute each = 10 minutes.
  Parallel is 1 minute.
**My recommendation:** ship serial in v1; add `--concurrency K`
later as a localized change to the orchestrator loop. The
50-passes soft cap in v1 limits accidental wall-clock pain.

**Q7 — Should `runSet` field live on `VetResult` or only in JSON?**
Spec says: writer stamps `runSet` into `result.json` payload, but
the `VetResult` TypeScript type does not gain a `runSet` field —
that metadata is JSON-level only. The argument: vetting outcome is
orthogonal to set membership; a vetting policy module shouldn't
have to know about RunSet identity.
Alternate: add `runSet?: RunSetCtx` to `VetResult` directly. This
is simpler, keeps the type aligned with the JSON, and lets any
caller of `runOne`/`executeRun` read `runSet` off the returned
result without re-reading `result.json`.
**My recommendation:** flip to the alternate (add to `VetResult`).
The orthogonality argument is principle without payoff. Easier to
read and test.

**Q8 — Should `/api/active-runs` surface queued attempts?**
Spec says: orchestrator pre-registers all N attempts with
`status: "queued"`, transitioning to `"running"` and unregistering
as each completes. So `/api/active-runs` shows all in-flight + queued
attempts in a multi-pass set.
Alternate: only register an attempt when it actually starts running
(today's behavior). The endpoint shows just the executing attempt.
**My recommendation:** pre-register. The UI's RunsList wants to
show "1 of 5 done, 1 running, 3 queued" — that's only possible if
the registry knows about the queued ones. Cost: small additional
in-memory state per multi-pass set.

**Q9 — Cancel-in-flight for run sets.**
v1 has no cancel endpoint. For a 50-attempt run, this is a real
UX gap — if the user realizes attempt 1 was misconfigured, they
have to wait. Two designs:
- `DELETE /api/run-sets/:id` — abort the current attempt
  (`adapter.close()`), mark remaining attempts as `cancelled`
  (new VetStatus? or just `errored` with reason `cancelled`?),
  finalize the set with whatever ran.
- Two-step: `POST /api/run-sets/:id/cancel` with a flag for
  "abort current and skip remaining" vs "let current finish and
  skip remaining."
**My recommendation:** ship `DELETE` semantics (abort + skip) in
v1 if web UI ships in v1. If web UI is deferred, defer cancel too.
Cancelled attempts mark with `errored` + reason `cancelled` to
avoid introducing a new VetStatus this round.

**Q10 — Naming inside `summary.perCard` and `summary.overall`.**
Currently both use `byStatus`, `setStatus`. The "set" in
`setStatus` at the per-card level is a slight stretch — really
it's a per-card status across attempts, not the whole set's
status. Calling it `cardStatus` and `overallStatus` (or
`overall.setStatus`) might read cleaner.
**My recommendation:** `cardStatus` per-card, `overallStatus` at
the top. Reverse me if you'd rather keep the symmetry of using
`setStatus` everywhere.

---

## Notes for whoever picks this up next (probably morning Matt)

I made best-guess decisions in the spec body and queued the things
I felt least sure about as Q1–Q10 above (originally 14, four were
no-brainers per Tarquin's review and have been promoted into the body
as decisions). The cleanest path forward is:

1. Read Q1–Q10. Mark agree / disagree / discuss.
2. Update the spec with your decisions.
3. Hand the spec to the next Bob to write the implementation plan
   (`writing-plans` skill). The phasing section already proposes
   3 PRs; the plan will turn each phase into a task graph.

If anything in the spec body feels wrong (not just the Qs), call
it out and we can revisit. The decisions aren't precious.

— Mosscap (Bob 320e9b00/Opus 4.7)
