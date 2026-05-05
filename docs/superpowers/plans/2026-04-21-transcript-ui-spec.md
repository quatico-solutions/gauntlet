---
title: Transcript UI — Specification
date: 2026-04-21
status: draft
author: Penelope (Bob bda03470 / Opus 4.7)
companion-doc: docs/plans/2026-04-21-transcript-ui-plan.md
companion-mocks: `.claude/worktrees/penelope-chat-ux-mocks/mocks/` (branch `worktree-penelope-chat-ux-mocks`)
---

# Transcript UI — Specification

> **Audience.** A future Bob (or a guppy) picking this up cold. You have
> the mocks, you have Boswell's expanded `run.jsonl`, you have not seen
> the brainstorm that produced this spec. Everything load-bearing is here.

---

## 1. One-paragraph summary

Boswell shipped an expanded `run.jsonl` — a near-complete transcript of
every agent run (system prompt, user message, per-turn llm responses
with thinking/text/toolCalls/usage, tool_call + tool_result pairs with
screenshots/artifacts, and a run_end verdict, all on a linear
`eventId`/`parentEventId` chain). Penelope shipped mocks that make that
data readable as a "bound account" of the run. This spec ports the
mocks into working React, wired to real data, **alongside** the
existing `LiveRun` and `RunDetail` components (not replacing them).
The MVP is two new routes — `/runs/:runId/transcript` and
`/runs/live/:runId/transcript` — sharing a single parser/reducer and
a single component tree, plus a small server-side extension that
broadcasts raw jsonl events over the existing WS so the live view
works without polling.

---

## 2. Goals

### In scope (MVP)

1. **Post-hoc transcript view** at `/runs/:runId/transcript`. Reads
   `run.jsonl` over HTTP, renders the mock's "bound book" layout: system
   prompt (collapsed), user message, turn blocks (marker, optional
   thinking, assistant text, paired tool cards, screenshots, artifact
   chips), event anomalies inline, run-end verdict panel with
   observations.
2. **Live transcript view** at `/runs/live/:runId/transcript`. Same
   component tree, fed by a live stream of events over the existing WS.
   Current turn highlights; pending tool card shows the "running" state
   while waiting for its `tool_result`.
3. **"View transcript" link** added to the existing `RunDetail` and
   `LiveRun` pages. Both existing views keep working unchanged.
4. **Minimal artifact drawer.** Click a paperclip chip → right-side
   slide-over panel that fetches the artifact text and renders it
   line-numbered in mono. Copy / close / open-raw buttons. No diff, no
   nav-next, no DOM pretty-printing.
5. **Shared parser.** Both views run the same pure reducer:
   `TranscriptEvent[] → TranscriptModel`. Live view applies the reducer
   incrementally; post-hoc view applies it in bulk.
6. **Server-side WS extension.** Broadcast each jsonl event verbatim as
   `{ type: "event", event }`. On WS connect, send a transcript
   snapshot containing all prior events on disk for that run. Existing
   `frame` / `progress` / `complete` / `gone` messages keep flowing
   untouched — the transcript view just ignores them and listens for
   the new `event` / `transcriptSnapshot` messages.
7. **Typography + palette imported from mocks.** Fraunces display +
   DM Sans body + JetBrains Mono code (Google Fonts). Warm cream/stone
   palette. No theme-token overhaul — scoped to the transcript routes.

### Explicit non-goals (MVP)

- No redesign of the Cards list, Runs list, Sidebar, AppShell, or the
  existing `RunDetail` / `LiveRun` screens. Those stay.
- No card-authoring UI changes.
- No artifact-nav (next/prev inside the drawer), no diff view, no
  binary artifact support — artifacts are assumed text.
- No screencast frames rendering, no `frames/` timeline scrubber.
- No filter/search within a transcript.
- No accessibility audit beyond keyboard-operable buttons + alt text
  on screenshots.
- No storybook, no visual-regression tests. Unit tests cover the
  reducer; everything visual is checked against the mocks by eye.

---

## 3. Architecture overview

```
┌─ Browser ──────────────────────────────────────────────┐
│                                                        │
│  /runs/:runId/transcript          /runs/live/:runId/transcript
│        │                                  │            │
│   useTranscript(runId)           useLiveTranscript(runId)
│        │                                  │            │
│   GET /api/results/:runId/file/run.jsonl  WS /api/ws?run=…
│   → parse JSONL → events[]           → snapshot + stream → events[]
│        │                                  │            │
│        └────────► reduceTranscript(events) ◄───────────┘
│                          │
│                  TranscriptModel
│                          │
│                   <Transcript/>
│           (SystemPromptPanel, UserMessagePanel,
│            TurnBlock×N, EventLine×N, RunEndPanel,
│            ArtifactDrawer)
└────────────────────────────────────────────────────────┘

┌─ Server ───────────────────────────────────────────────┐
│                                                        │
│  EvidenceLogger.writeEvent(type, body)                 │
│       │                                                │
│       ├── appendFileSync run.jsonl  (existing)         │
│       └── notifyEventObservers(entry)  (NEW)           │
│                   │                                    │
│   executeRun ─────┤                                    │
│                   ▼                                    │
│     broadcaster.send(runId, { type:"event", event })   │
│                                                        │
│  handleWsOpen (NEW branch):                            │
│    1. addClient                                        │
│    2. read run.jsonl from disk → send transcriptSnapshot
│    3. live events fan out via broadcaster              │
└────────────────────────────────────────────────────────┘
```

---

## 4. Data model

All types live in `ui/src/lib/transcript.ts`. The server writes the
same shapes via `src/evidence/logger.ts`; we mirror them here rather
than sharing at the module level (the UI has no direct import path to
`src/evidence/`, and the shapes are few and stable).

### 4.1 Event shapes (mirrors `logger.ts`)

Every event on disk carries `{ eventId, parentEventId, ts, type, ...body }`.
The discriminated union by `type`:

```ts
type TranscriptEvent =
  | RunStartEvent
  | SystemPromptEvent
  | UserMessageEvent
  | LlmRequestEvent
  | LlmResponseEvent
  | ToolCallEvent
  | ToolResultEvent
  | AnomalyEvent          // type: "event"
  | RunEndEvent;

interface BaseEvent {
  eventId: number;
  parentEventId: number;
  ts: string;             // ISO 8601
}

interface RunStartEvent extends BaseEvent {
  type: "run_start";
  runId: string;
  cardId: string;
  target?: string;
  provider: string;
  model: string;
  adapter: string;
  maxTurns: number;
  toolTimeoutMs: number;
  contextTreeBytes: number;
}

interface SystemPromptEvent extends BaseEvent {
  type: "system_prompt";
  content: string;
}

interface UserMessageEvent extends BaseEvent {
  type: "user_message";
  turn: number;           // always 0 at MVP
  content: string;
}

interface LlmRequestEvent extends BaseEvent {
  type: "llm_request";
  turn: number;
  messageCount: number;
}

interface LlmResponseEvent extends BaseEvent {
  type: "llm_response";
  turn: number;
  stopReason: string;
  text: string;
  thinking: Array<{ text: string; signature?: string }>;
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  };
  rawAssistantMessage: unknown;
}

interface ToolCallEvent extends BaseEvent {
  type: "tool_call";
  turn: number;
  toolUseId: string;
  name: string;
  arguments: Record<string, unknown>;
}

interface ToolResultEvent extends BaseEvent {
  type: "tool_result";
  turn: number;
  toolUseId: string;
  name: string;
  durationMs: number;
  text: string;
  image: string | null;      // relative path under run dir
  artifact: string | null;   // relative path under run dir
  textTruncated?: true;
  textBytes?: number;
  error: boolean;
}

interface AnomalyEvent extends BaseEvent {
  type: "event";
  name: string;
  [k: string]: unknown;      // payload is free-form per event
}

interface RunEndEvent extends BaseEvent {
  type: "run_end";
  status: string;            // "pass" | "fail" | "investigate"
  summary: string;
  reasoning: string;
  observationCount: number;
  durationMs: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
    turns: number;
  };
}
```

Note: `tool_result.image` and `.artifact` arrive as explicit `null`
(not `undefined`) in the real jsonl we inspected. Parser treats both as
optional.

### 4.2 Transcript model

```ts
interface TranscriptModel {
  runId?: string;                       // from run_start
  runStart?: RunStartEvent;
  systemPrompt?: SystemPromptEvent;
  userMessage?: UserMessageEvent;
  turns: Map<number, TurnModel>;        // keyed by turn number, ordered
  runEnd?: RunEndEvent;
  anomalies: AnomalyEvent[];            // chronological, may appear mid-turn
  // Flat chronological list — used to interleave anomalies with turn blocks
  // at render time (an anomaly with ts between turn N and turn N+1 renders
  // between those turn blocks).
  ordered: TranscriptEvent[];
}

interface TurnModel {
  turn: number;
  llmRequest?: LlmRequestEvent;
  llmResponse?: LlmResponseEvent;
  /** Tool invocations in this turn, in the order they appear in the
   *  llm_response.toolCalls array (preserved via ToolCallEvent arrival
   *  order — they are written sequentially by the logger). */
  tools: ToolPair[];
}

interface ToolPair {
  toolUseId: string;
  call: ToolCallEvent;
  result?: ToolResultEvent; // undefined while live & still running
}
```

### 4.3 Reducer contract

```ts
function reduceTranscript(events: TranscriptEvent[]): TranscriptModel;
function applyEvent(model: TranscriptModel, event: TranscriptEvent): TranscriptModel;
```

- Pure functions. `reduceTranscript` is `events.reduce(applyEvent, empty)`.
- Missing-parent events are still applied (best-effort; we don't
  validate the chain — eventId ordering is sufficient).
- A `tool_result` whose `toolUseId` has no matching `tool_call` in its
  turn is dropped with a `console.warn`. In practice this doesn't
  happen because the logger writes them in order.
- An `llm_response` with `toolCalls.length === 0` is allowed — it's a
  final-turn answer (often the `report_result` turn has a tool call,
  but arbitrary no-tool turns are possible).
- The reducer never mutates its input model; each call returns a new
  object (React-friendly).

---

## 5. Routes & component tree

### 5.1 Routes

```
/runs/:runId/transcript          → TranscriptView mode="posthoc"
/runs/live/:runId/transcript     → TranscriptView mode="live"
```

Both share the same `AppShell` + sidebar as existing routes. The
transcript view is the route's main content. From existing screens:

- `RunDetail` adds a small "View transcript" link near the top (next to
  the `StatusBadge`), pointing at `/runs/:runId/transcript`.
- `LiveRun` adds the same link, pointing at `/runs/live/:runId/transcript`.

No redirect, no automatic migration — the existing views stay default.

### 5.2 Component tree

```
<TranscriptView mode runId>                        // container
  <TranscriptHeader status? duration? cardId ts/>  // thin title bar
  <Transcript model>                               // pure render
    <SystemPromptPanel text/>                      // collapsed
    <UserMessagePanel text/>
    {interleaved:
      for each turn in order + anomalies between turns:
        <TurnBlock turn model/>                    // one per turn
          <TurnMarker n/N timing usage/>
          {thinking[].map(<ThinkingBlock/>)}
          {text && <AssistantText/>}
          {tools.map(<ToolPairCard call result?/>)}
          {result.image && <Screenshot src alt/>}  // inline in tool card
          {result.artifact && <ArtifactChip path onOpen/>}
        <EventLine event/>                         // anomaly between turns
    }
    <RunEndPanel runEnd observations/>             // verdict
  </Transcript>
  <ArtifactDrawer open path onClose/>              // slide-over overlay
</TranscriptView>
```

File layout:

```
ui/src/components/transcript/
  TranscriptView.tsx          ~120 lines
  Transcript.tsx              ~80 lines
  TurnBlock.tsx               ~60 lines
  ToolPairCard.tsx            ~90 lines (renders call head + result body)
  ThinkingBlock.tsx           ~30 lines
  SystemPromptPanel.tsx       ~40 lines
  UserMessagePanel.tsx        ~20 lines
  RunEndPanel.tsx             ~60 lines
  EventLine.tsx               ~25 lines
  ArtifactChip.tsx            ~25 lines
  ArtifactDrawer.tsx          ~80 lines
  Screenshot.tsx              ~20 lines
  index.ts                    barrel export
ui/src/hooks/
  useTranscript.ts            ~50 lines (post-hoc fetch + parse)
  useLiveTranscript.ts        ~90 lines (WS subscribe + incremental reduce)
ui/src/lib/
  transcript.ts               ~180 lines (types + reducer + parse)
ui/src/styles/
  transcript.css              scoped CSS with the mock's tokens
```

---

## 6. Data flow

### 6.1 Post-hoc

1. `useTranscript(runId)` calls `GET /api/results/:runId/file/run.jsonl`.
2. Response text split on `\n`, each non-empty line `JSON.parse`'d.
3. Invalid lines logged and skipped (JSONL robustness).
4. `reduceTranscript(events)` produces the model.
5. Component renders the model. Static from here — no live updates.

Existing `/api/results/:runId/file/:relativePath` endpoint already
allows `run.jsonl` because it's in the manifest. No server change
needed for post-hoc.

### 6.2 Live

1. `useLiveTranscript(runId)` opens `WS /api/ws?run=<runId>` (same URL
   the existing hook uses — a single WS per run, multiplexed).
2. On `open`, the server sends — in order:
   - `{ type: "transcriptSnapshot", events: [...] }` — all events on
     disk so far for this run, in eventId order. This replaces the
     existing `snapshot` for transcript consumers; the legacy `snapshot`
     still flows for the `frame`/`progressLog` consumers but the
     transcript hook ignores it.
   - `{ type: "event", event: <jsonl object> }` for every new event as
     it's written.
3. The hook maintains a ref to the last eventId seen. `event` messages
   with `eventId <= lastSeen` are skipped (idempotent against double
   delivery).
4. Each event is `applyEvent`'d onto the current model; state replaces
   after each apply so React re-renders.
5. On `complete` / `gone`, the WS may close; the last model we built
   stays rendered. If the user refreshes, the view switches to post-hoc
   loading via the regular route.

### 6.3 Server changes for live

**`src/evidence/logger.ts`** — add a second observer list that fires
the full structured event, not just `(action, params)`:

```ts
type EventObserver = (event: Record<string, unknown>) => void;

// in EvidenceLogger:
addEventObserver(fn: EventObserver): () => void;
private eventObservers: Set<EventObserver>;
// writeEvent pushes through notifyEventObservers(entry) after append
```

The existing `addObserver(fn)` and its `notifyObservers` path stay
untouched — they still fire `(action, params)` to keep the legacy
progress stream working for `LiveRun`.

**`src/api/routes/run.ts`** — subscribe to the new observer and
broadcast:

```ts
const unsubscribeEventObserver = logger.addEventObserver((event) => {
  broadcaster?.send(runId, { type: "event", event });
});
```

**`src/api/ws-handlers.ts`** — on open, in addition to the existing
legacy snapshot, read `run.jsonl` from disk for this run and emit a
`transcriptSnapshot`:

```ts
const runDir = join(resultsRoot, runId);
const jsonlPath = join(runDir, "run.jsonl");
if (existsSync(jsonlPath)) {
  const lines = readFileSync(jsonlPath, "utf8").split("\n").filter(Boolean);
  const events = lines.map((l) => JSON.parse(l));
  ws.send(JSON.stringify({ type: "transcriptSnapshot", events }));
}
```

Small race to be aware of: new events can be written to disk between
our snapshot read and the moment the WS broadcaster starts fanning
them out. Mitigation: the broadcaster is `addClient`'d first (already
the case), and the snapshot read happens after. Any event that lands
between `addClient` and the snapshot read will be emitted twice (once
in snapshot, once as `event`). The client dedupes by `eventId`.

**Bounds.** `transcriptSnapshot` payload is at most a full run — ~100kB
of JSON for the Boswell-era fixture we have. Single message is fine.
If runs grow past a few MB we'll chunk, but out of scope here.

---

## 7. UI behavior details

### 7.1 Post-hoc vs live differences

- Header: post-hoc shows verdict + duration; live shows connection
  state + elapsed time.
- Post-hoc scrolls freely. Live auto-scrolls to the current turn
  only when already at-bottom (don't hijack scroll if the user has
  scrolled up to read).
- Live: current turn gets a teal wash (`--current-turn-bg`) and
  a pulsing caret in its TurnMarker. Post-hoc: no highlight.
- Live: a tool card with `call` but no `result` yet shows a "running"
  pill in its head (spinning dot + duration counter).

### 7.2 Tool card

Anatomy (from mocks):

- **Head:** `[tool-name] toolu_xxxx · NNN ms` (mono). Click collapses
  args + result.
- **Args:** preformatted JSON, soft-wrapped.
- **Text result:** preformatted; if >1200 chars, truncate with a
  "Show more" expand. If `textTruncated: true`, show "Spilled to
  artifact — open artifact" linking the artifact chip.
- **Image result:** `<Screenshot>` inline below text result.
- **Artifact chip:** below result text, opens drawer.
- **Error variant:** if `error: true`, red-rule left border + red pill
  "error" on the head. (Mock VI — `transcript-fail.html`.)

### 7.3 Artifact drawer

- Slide-in from right, 560px wide, overlays transcript (dimmed).
- Fetches artifact text via existing file endpoint.
- Line-numbered rendering (just a `<pre>` with a counter gutter).
- Header: filename, bytes, "Open raw" (opens `GET
  /api/results/:runId/file/:path` in new tab), "Copy", "Close" (esc).
- One-at-a-time: opening a new chip replaces the current content.

### 7.4 Empty / error states

- 404 for `run.jsonl`: show "No transcript available for this run" in
  the transcript area. (Happens for legacy runs that predate Boswell's
  work — the two existing fixtures in this repo are one such case.)
- Malformed JSONL line: skip + `console.warn`, keep rendering the rest.
- WS disconnects: show a small "Disconnected — refresh to reload"
  banner but keep the last rendered model.
- No `run_start` yet (very early live): render a "Starting…" spinner.

---

## 8. Styling

### 8.1 Typography & palette

Imported from `mocks/style.css`:

- `--font-display: "Fraunces", Georgia, serif;`
- `--font-body: "DM Sans", -apple-system, system-ui, sans-serif;`
- `--font-mono: "JetBrains Mono", "SF Mono", Consolas, monospace;`
- Palette: warm cream/stone — `--surface #f7f7f5`, `--panel #f0efe9`,
  `--panel-recessed #efede6`, `--edge #ddd9d2`, `--ink #0f1821`,
  `--ink-light #3a4654`, `--slate #6a7788`, `--teal-dark #0f6161`.
- Shadow scale: `--shadow-sm: 0 1px 3px rgba(30,25,20,0.07), 0 0 0 1px rgba(30,25,20,0.06);`

Loaded via Google Fonts `<link>` added to `ui/index.html`. Scoped CSS
goes in `ui/src/styles/transcript.css`, imported by `TranscriptView.tsx`.

### 8.2 Coexistence with existing Tailwind

Gauntlet uses Tailwind v4. The transcript CSS is a plain stylesheet
that coexists — its classes are prefixed `.tr-` (e.g. `.tr-turn`,
`.tr-tool`, `.tr-marginalia`) to avoid collision. No Tailwind-config
changes.

### 8.3 Responsiveness

Desktop-first. Minimum target width 1100px. Below that the transcript
column pins to 720px with the drawer overlaying rather than splitting.
Mobile is out of scope.

---

## 9. Testing

Tests live alongside the modules, Vitest.

- `ui/src/lib/transcript.test.ts`:
  - Empty-event-stream → empty model.
  - The full login-matt-001 fixture reduces without warnings; model
    has 25 turns with the expected tool names per turn.
  - Idempotent apply: applying the same event twice produces the same
    model (eventId dedupe at the reducer layer is defense-in-depth;
    the hook also dedupes).
  - Out-of-order events: interleaving an earlier-turn event after a
    later-turn event still attaches it to the correct turn.
  - Missing `tool_call` for a `tool_result` drops the result and
    warns.
  - `image: null` + `artifact: null` values parse without crashing.
- `ui/src/components/transcript/__tests__/` — one smoke test per
  component that renders it with a fixture and asserts headline text
  is present. No snapshot tests (too brittle for iteration).
- No e2e. Visual matches checked against mocks by eye.

A **fixture** (`ui/src/lib/__fixtures__/login-matt-001.jsonl`) is
copied from the real run directory at plan-execution time so tests
don't depend on an absolute path. Size: ~60kB.

---

## 10. Rollout

1. Ship server change + hook + reducer behind a build.
2. Add link pill ("View transcript →") to existing screens, unstyled-
   gentle — it's opt-in.
3. Gather feedback; iterate on the transcript components in place.
4. Once the transcript view is the preferred reading surface, we can
   start replacing the existing screens. That's out of scope here.

No feature flag, no server version check — the new route simply
renders "No transcript available" for runs whose `run.jsonl` is empty
or legacy-shaped.

---

## 11. Risks & open questions

- **Legacy run.jsonl.** The two runs already on disk in the main repo
  predate Boswell's work; they use the old `{timestamp, action, params}`
  per-line shape. Our reducer will `console.warn` per line and produce
  an empty model. Confirmed acceptable — the view shows "No transcript
  available".
- **WS payload size.** `transcriptSnapshot` is a single JSON message.
  For the fixture we have (~100kB), this is fine. A runaway run could
  blow past practical limits. Out-of-scope mitigation noted; not an
  MVP blocker.
- **Extended thinking off.** The fixture has `thinking: []` on every
  turn. The component branch that renders marginalia is untested
  against real thinking content. We render from the mock fixture
  which includes thinking text; real thinking text from a Sonnet-with-
  extended-thinking run is structurally identical, so acceptable.
- **Tailwind v4 + plain CSS.** If the scoped stylesheet conflicts with
  Tailwind resets, use `@layer` to order. Noted, not expected to bite.

---

## 12. Done criteria (MVP)

- [ ] `/runs/:runId/transcript` renders the login-matt-001 run end-to-end
      with all 25 turns visible, no console errors, screenshots inline,
      artifact chip opens the drawer with `artifacts/001.md` text.
- [ ] `/runs/live/:runId/transcript` streams a fresh run of
      login-matt-001 from turn 0, current turn highlights, pending
      tool cards show the running state, transitions to final state on
      `run_end` without a remount.
- [ ] Existing `RunDetail` and `LiveRun` pages still render exactly
      as they did, with a new "View transcript" link added.
- [ ] Reducer unit tests pass (`ui/src/lib/transcript.test.ts`).
- [ ] Server-side `addEventObserver` wired and broadcasting; existing
      `LiveRun` progress log is unaffected.
- [ ] `docs/format.md` appendix describes the new WS message types
      (`transcriptSnapshot`, `event`).
