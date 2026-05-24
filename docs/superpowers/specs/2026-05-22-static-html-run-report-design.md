# Static HTML Run Report — Design

**Status:** Approved (design phase). Plan to follow.
**Ticket:** [PRI-1785](https://linear.app/prime-radiant/issue/PRI-1785/gauntlet-self-contained-html-run-report-auto-emit-gauntlet-render)
**Author:** Dirk Gently@d9ef02a6

## Problem

For one-shot runs — a single story executed inside another tool — looking at what happened currently requires spinning up `gauntlet serve` just to view one transcript. That's friction every time. We want each run to leave behind a self-contained, double-clickable HTML artifact: the same view `gauntlet serve` shows at the run's main route, but as a file you open without a server.

A neighbour idea — flattening `.gauntlet/results/<run-id>/...` into `.gauntlet/results/` so the output path is shallower — was considered and dropped. The real annoyance with the nested run dir isn't depth, it's the random nonce in the run-id that makes the path non-deterministic. The HTML report dissolves the underlying need: once `index.html` lives in the run dir and the run prints its path on completion, you stop caring about the nesting because you never navigate the dir manually.

## What we're building

One renderer with two call sites.

```
renderRun(runDir) → writes <runDir>/index.html
        ↑                ↑
   gauntlet run    gauntlet render <run-id>
   (auto, at end)  (manual, on existing runs)
```

1. **Auto-emit on every `gauntlet run`.** After `result.json` is written, the renderer drops `<runDir>/index.html` next to it. Best-effort: a renderer failure is logged and does not fail the run itself. A styling bug must not break real runs.
2. **`gauntlet render <run-id>` command.** Re-renders an existing run's HTML from its on-disk artifacts. Two reasons it earns its keep:
   - Styling iteration without re-executing stories (the explicit motivating use case — we expect to spend time on styling).
   - Backfilling runs that predate this feature or were rendered with an older template.

The two call sites share a single renderer function. There is one source of truth for "what an HTML report looks like."

## How it's built

The static HTML uses **the exact React components `gauntlet serve` already renders.** No fork.

### Build pipeline

A second Vite build target in `ui/` produces a single-file inlined HTML template via `vite-plugin-singlefile` (or equivalent inline-everything plugin) — all CSS and JS inlined into one `.html` artifact. This template ships as part of the gauntlet distribution, alongside the existing `ui/dist/` server bundle.

The template contains a placeholder data-injection point — a `<script type="application/json" id="__GAUNTLET_RUN__"></script>` tag. At render time, the runtime renderer reads the template from disk, replaces that script tag's contents with the serialised run data (the parsed contents of `result.json` and `run.jsonl`), and writes the result to `<runDir>/index.html`. Evidence files are referenced by relative path from inside the rendered components — not inlined into the data blob.

### Static mode in the React app

The React app gains a small "static mode" branch in its data-loading layer (`ui/src/hooks/useTranscript.ts` and the equivalent for result/summary data):

- If `window.__GAUNTLET_RUN__` is present, parse it and use it as the data source — no fetch.
- Otherwise, behave exactly as today (fetch from `/api/results/...`).

WebSocket-driven "live" mode is irrelevant in static HTML and remains gated behind the existing live-route check.

### File layout in the run dir

```
.gauntlet/results/<run-id>/
  result.json
  result.md
  run.jsonl
  index.html         ← new
  inputs/
  issues/
  ... (adapter artifacts: screenshots, frames, captures)
```

Evidence files (screenshots, video, ANSI captures) stay as separate files. The HTML references them by **relative path** from the run dir, so double-clicking `index.html` shows screenshots inline. Tradeoff acknowledged: copying `index.html` out of the run dir without its siblings breaks evidence links. For the one-shot in-place viewing case this is fine; if "ship this HTML to a ticket as one file" becomes a need, base64-inlining is a future-feature change.

## Page scope

The HTML contains the **whole picture** for a single run — the same content `gauntlet serve` shows at its run route:

- Status (pass / fail / investigate)
- Summary and reasoning
- Observations
- Evidence pointers (with working relative links)
- Full transcript (`TranscriptView` content, parsed from `run.jsonl`)

Not just the transcript pane. If you ran a story once and want to know what happened, one file tells you.

## Decisions captured

| Question | Decision | Notes |
| --- | --- | --- |
| Filename | `index.html` | Run dir functions as a self-contained mini-site |
| Command name | `gauntlet render <run-id>` | "Export" implies format conversion; "render" describes what it does |
| Trigger | Auto-emit on every run + manual command | The manual command is for styling iteration on existing runs |
| Batch behavior | Every per-card run gets its own `index.html` | No run-set-level summary HTML in this feature |
| Opt-out flag | None for now | Add `--no-html` only if noise turns out to matter |
| Evidence files | Separate files, relative-path links | Not inlined |
| Failure mode in `run` | Non-fatal: log error, run still succeeds | A renderer bug must not break runs |
| Renderer relationship | Reuse React components, single-file Vite bundle | One source of truth; styling work benefits both surfaces |

## Components

### `renderRun(runDir)` — the renderer function

- **Input:** absolute path to a run dir containing at minimum `result.json` and `run.jsonl`.
- **Output:** writes `<runDir>/index.html`. Returns the path (or throws on failure).
- **Responsibilities:**
  - Locate the bundled single-file template (shipped with gauntlet).
  - Read `result.json` + `run.jsonl` from the run dir.
  - Serialise into the data blob shape the React app's static-mode branch expects.
  - Splice into the template's data-injection script tag.
  - Write the final HTML.
- **Lives in:** new module under `src/` (exact placement to be settled in the plan — likely `src/render/` alongside other artifact emitters).

### `gauntlet run` integration

After `result.json` is written and just before final reporting, call `renderRun(runDir)`. Wrap in try/catch; on failure, log a warning with the error and continue. The run's exit status is unaffected.

### `gauntlet render` subcommand

- **CLI:** `gauntlet render <run-id-or-path>`.
- **Behavior:** resolves the run dir (by run-id under the configured state dir, or by direct path), calls `renderRun(runDir)`, prints the resulting file path.
- **Flag parsing:** follows the existing homegrown CLI parser pattern (`src/cli/args.ts`).
- **Lives in:** `src/cli/render.ts`, dispatched from `src/index.ts`.

### `ui/` build target

- Second Vite config (or a build-mode flag in the existing config) producing a single-file inlined HTML output.
- The data-injection script tag is the only placeholder; everything else (CSS, JS, fonts) is inlined.
- Build output path: to be determined in the plan (likely `ui/dist-static/template.html` or similar — kept separate from `ui/dist/` so the server build is untouched).

### Static-mode branch in `ui/src/`

- Hooks/loaders that currently `fetch(...)` check for `window.__GAUNTLET_RUN__` first.
- A small `lib/static-run.ts` (or similar) module exposes the parsed data blob to whoever needs it.
- Live-mode (WebSocket) paths remain gated by their existing route checks — they are never reached in static HTML.

## Acceptance criteria

- `gauntlet run <card>` produces `<runDir>/index.html`. Opening it in a browser with no server running shows the same content as `gauntlet serve`'s run view: status, summary, observations, evidence, transcript.
- Screenshots and other evidence files render inline via relative-path references.
- `gauntlet render <run-id>` (or `<path>`) re-renders the HTML for an existing run dir, overwriting any prior `index.html`.
- Styling changes made to `ui/src/**` show up in both `gauntlet serve` and the static HTML after a single rebuild step (one `bun run build:ui` or equivalent — exact command shape decided in the plan).
- A renderer error during `gauntlet run` is logged at warning level but does not fail the run or change its exit code.

## Out of scope

- **Run-set summary HTML.** Aggregating multiple cards' results into one HTML index. Separate feature.
- **Flattening the run dir** (the killed idea #1). Random nonce in run-id is the real annoyance, and this feature dissolves the underlying pain.
- **Customizable templating / theming.**
- **Embedding binary artifacts** (screenshots, video frames) into the HTML. Relative-path references only.
- **`--no-html` opt-out flag.** Add only if the per-card cost in batch runs turns out to matter.
- **A "live" static HTML** that updates while a run is in progress. Static means post-hoc.

## Risk and unknowns

- **Single-file bundle size.** Inlining CSS + JS + React + the run's full JSONL could push the file into the megabyte range. The plan will measure this on a representative run and confirm the result is tolerable for the one-shot use case. If too large, future tradeoffs include code-splitting (breaks single-file property) or pruning unused components from the static bundle.
- **Static-mode branch in the React app.** Adding a branch to data hooks adds a small amount of cognitive load to that code. The plan will minimise blast radius — likely a single `useRunData` adapter that handles both modes, rather than scattering checks throughout.
- **`vite-plugin-singlefile` compatibility.** The exact plugin and its current support for the project's Vite version will be confirmed in the plan; equivalent inline-everything strategies exist if it does not fit.

## Open in the plan

- Exact file layout (`src/render/`?), function signatures, build commands.
- Where the bundled template is located on disk at runtime (alongside `ui/dist`? a sibling dir?), and how the renderer finds it.
- How `gauntlet render` resolves `<run-id>` to a path (search results dir; share with whatever existing code does this for `serve`).
- Test approach: a representative run dir, render, snapshot the output, assert it opens as a static page (probably via Playwright or a smaller headless check).
