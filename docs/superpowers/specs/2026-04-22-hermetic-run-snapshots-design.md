# Hermetic run snapshots — design

**Status:** drafted, awaiting review.
**Author:** Piranesi (Bob 40eed199/Opus 4.7)
**Related:** `src/paths.ts`, `src/cli/run.ts`, `src/api/routes/run.ts`, `src/context/read-tool.ts`, `src/adapters/web/passkey.ts`

## Problem

A Gauntlet run's output directory (`.gauntlet/results/<runId>/`) captures what
the agent *produced* — screenshots, `run.jsonl`, `result.json`, etc. — but
the two inputs that shape the run are referenced by path:

- **Story** (`.gauntlet/stories/<name>.md`) — the prompt text.
- **Context profile** (`.gauntlet/context/<profile>/`) — a directory tree
  the agent reads via `read_tool` (identity, credentials, etc.).

Both get edited over time. If a story is refined or a context file changes
between runs, historical results silently lose fidelity: the `result.json`
still says "scenario: networkeffect-mhat-1", but the text behind that name
may no longer match what the agent actually saw.

Two concrete failure modes:

1. **Audit drift.** Comparing two runs of the same story assumes the story
   was the same. Today there's no way to know it wasn't.
2. **Post-hoc chat with the agent** (future feature). To introspect *why*
   an agent made a decision, a resumed agent must see the exact world-state
   it originally saw — not a hybrid of then + now.

## Goals

1. **Each run is hermetic w.r.t. its inputs.** The story text and the full
   context profile as-of run start live inside the run directory.
2. **Agent behavior unchanged during live runs.** No changes to tool
   semantics, prompt structure, or agent-visible paths. Only the *root* of
   the read-tool / passkey tool moves.
3. **Foundation for post-hoc chat.** A resumed agent points at the same
   snapshot and sees what the original agent saw.

## Non-goals

- **Re-running a past run from scratch.** We don't need the snapshot to be
  executable end-to-end; config/model/target are already captured in
  `result.json`.
- **Secret scrubbing.** Context profiles contain credentials (passkey
  material). `.gauntlet/results/` is already local and treated as
  authoritative artifact; verbatim copies are acceptable at this stage.
- **Drift detection.** A follow-up can diff `run/inputs/*` against live
  `.gauntlet/stories|context/*` to flag drift; out of scope here.
- **Whole-run read access for the agent.** The agent currently reads
  screenshots via a separate path; expanding `read_tool`'s root beyond
  `context/` is deferred until it's clearly useful.
- **Content-addressed / deduplicated snapshots.** Overkill at this scale.
- **Multi-story runs.** One run = one story. Fanout generates new stories
  from a past run but doesn't bundle multiple into a single run.

## Layout

```
.gauntlet/results/<runId>/
├── inputs/
│   ├── story.md                   ← snapshot of .gauntlet/stories/<name>.md
│   └── context/
│       └── <profile>/...          ← snapshot of .gauntlet/context/<profile>/
├── screenshots/
├── frames/
├── run.jsonl
├── network-ws.jsonl
└── result.json
```

The `inputs/` boundary is deliberate: it labels the snapshot without relying
on naming conventions, and keeps "what the agent was given" separate from
"what the agent produced." This matters when a future resumed-chat agent
reads around inside the run directory.

Existing output layout (`screenshots/`, `frames/`, top-level jsonl files,
`result.json`) is unchanged — the snapshot lands alongside them as a new
sibling, not a reshuffle.

## Snapshot mechanics

### When

Synchronously at run start, before the adapter is constructed and before the
agent loop begins. The snapshot is immutable for the duration of the run —
edits to live `.gauntlet/stories/` or `.gauntlet/context/` after this point
do not affect the running agent.

### What

- `story.md`: byte-for-byte copy of the resolved story file. Path resolution
  matches current behavior (`storiesDir/<scenario>.md`).
- `context/<profile>/...`: recursive copy of the context profile directory.
  Preserves file contents and directory structure. No filtering, no
  redaction.

### Failure handling

A snapshot failure fails the run loudly before the agent starts:

- **Missing story** — the story file doesn't exist on disk. Same failure
  mode as today when the CLI/API tries to load a non-existent scenario;
  surfaced at the same point.
- **Context profile not found or empty** — already handled by
  `contextRootIsPopulated` (`src/adapters/web/passkey.ts:142`). Today a
  missing/empty profile degrades gracefully (no passkey tool registered).
  The snapshot must preserve that semantics: if the live profile is missing
  or empty, snapshot nothing and carry on — don't synthesize a false
  snapshot.
- **Copy error (permissions, I/O)** — bubble up; the run fails with a clear
  error before the agent starts.

### Idempotency

Run directories are created fresh per run (`runId` is unique). The snapshot
is written once; there's no update path and no reuse across runs.

## Root-swap contract

Two call sites consume `contextRoot` today:

- `buildReadTool(contextRoot)` — `src/context/read-tool.ts`. Exposes a
  `read` tool to the agent; paths resolve via `resolveInside(contextRoot,
  relPath)`.
- `buildPasskeyTool(contextRoot, ...)` — `src/adapters/web/passkey.ts`.
  Loads `passkey.json` relative to the context root.

Both receive `gauntletPath(projectRoot, "context")` today — i.e., the
shared `.gauntlet/context/` directory. After this change, both receive
`<runDir>/inputs/context/`.

Agent-visible behavior is unchanged:

- The system prompt's rendered context tree is built from the new root;
  profiles listed are the same profiles (they were copied in).
- A `read matt/identity.md` call still resolves to `matt/identity.md`
  relative to the root — just a different root.
- Containment enforcement via `resolveInside` is unchanged.

Call-site changes:

- `src/cli/run.ts:38` — compute `contextRoot` as
  `gauntletPath(projectRoot, "results", runId, "inputs", "context")`
  instead of `gauntletPath(projectRoot, "context")`.
- `src/api/routes/run.ts:54` — same swap.
- The pre-existing `.gauntlet/context/` path remains the *source* for the
  snapshot; only what the agent sees moves.

## Story injection

Current prompt builder reads the story from `.gauntlet/stories/<name>.md`.
After this change it reads from `<runDir>/inputs/story.md`. The `scenario`
field in `result.json` still records the original story name, so the
mapping between snapshot and source remains traceable.

## Resumed-chat forward compatibility

The snapshot makes resumed chat trivial to implement later: point
`read_tool` at `<runDir>/inputs/context/` (identical to live) and inject
`<runDir>/inputs/story.md` as the story. The resumed agent sees byte-exact
the same world its originator did.

If we later decide to expose the full run directory to the resumed agent
for introspection (screenshots, `run.jsonl`, etc.), that's a pure additive
change — swap the read-tool root from `inputs/context/` to the run dir.
This spec deliberately doesn't commit to that.

## Testing

- **Unit**: snapshot helper produces the expected tree for a fixture story
  + context profile; handles missing-profile and missing-story cases.
- **Integration (existing run flow)**: after a run completes, assert
  `<runDir>/inputs/story.md` byte-matches the source story at run-start
  time, and that `<runDir>/inputs/context/` mirrors the source profile.
- **Agent behavior**: existing adapter/agent tests continue to pass
  unchanged — the root-swap is transparent.
- **Edit-during-run**: mutate the source story mid-run; assert the
  snapshot is unaffected and the agent used the snapshot content.

## Implementation notes

- A single helper — `snapshotRunInputs(runDir, storyPath, contextProfileDir)`
  — handles the copy. Lives alongside the other run-infra code (likely
  `src/paths.ts` or a new `src/runs/snapshot.ts`).
- Call sites invoke this once, during run setup, between `runId` assignment
  and adapter construction.
- No changes to `src/adapters/*`, `src/context/read-tool.ts`, or
  `src/adapters/web/passkey.ts` beyond the root they receive from callers.

## Open questions

None that block the implementation. Drift detection, whole-run read
access, and resumed chat each get their own spec when picked up.
