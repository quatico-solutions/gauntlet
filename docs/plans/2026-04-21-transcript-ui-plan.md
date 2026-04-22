---
title: Transcript UI — Implementation Plan
date: 2026-04-21
status: draft
author: Penelope (Bob bda03470 / Opus 4.7)
spec: docs/plans/2026-04-21-transcript-ui-spec.md
mocks: worktree branch `worktree-penelope-chat-ux-mocks`, files under `mocks/`
---

# Transcript UI — Implementation Plan

> **For agentic workers:** Phases run as gates. Phase 1 WPs can be
> parallelized; Phase 2 blocks on Phase 1; Phase 3 polishes and ships.
> Cross-references to the spec (`docs/plans/2026-04-21-transcript-ui-spec.md`)
> are marked `Spec §N`. Do not duplicate spec content here; read the
> spec for the *what*, this plan is the *how*. If a WP feels
> under-specified, read its spec reference.
>
> **Fixture location.** The canonical test run is
> `/Users/mw/Code/prime/brainstorm/.gauntlet/results/login-matt-001_20260422T033847Z_0iqx/`.
> Copy `run.jsonl` (~60kB) and `artifacts/001.md` (~10kB) into
> `ui/src/lib/__fixtures__/` as part of WP1.1. The real dir stays as
> the live-run target for Phase 2 verification.

---

## Phase dependency summary

```
Phase 1 (parallel-safe mechanical)
    ├── WP1.1  Fixture + reducer + types (ui/src/lib/transcript.ts)
    ├── WP1.2  Transcript CSS + font loading
    ├── WP1.3  Server addEventObserver in logger.ts
    └── WP1.4  Server WS extension (transcriptSnapshot + event)
         │
         ▼
Phase 2 (component build, mostly parallel)
    ├── WP2.1  Hooks — useTranscript, useLiveTranscript
    ├── WP2.2  Leaf components (SystemPromptPanel, UserMessagePanel,
    │         ThinkingBlock, Screenshot, ArtifactChip, EventLine)
    ├── WP2.3  ToolPairCard  (depends on 2.2 for Screenshot/ArtifactChip)
    ├── WP2.4  TurnBlock     (depends on 2.3)
    ├── WP2.5  RunEndPanel
    ├── WP2.6  ArtifactDrawer
    ├── WP2.7  Transcript + TranscriptView containers
    │         (depends on 2.1 + 2.4 + 2.5 + 2.6)
    └── WP2.8  App.tsx route wiring + links on existing screens
         │
         ▼
Phase 3 (verification, docs, ship)
    ├── WP3.1  Post-hoc end-to-end smoke against real fixture
    ├── WP3.2  Live end-to-end smoke against a fresh run
    ├── WP3.3  Update docs/format.md with WS message types
    └── WP3.4  Commit, push, PR
```

---

## Phase 1 — Foundation (parallel)

Phase 1 lays the wiring without any user-visible change. Every WP here
is verifiable independently by tests or by inspecting a single HTTP
call / log line. Parallel-safe: WPs 1.1 through 1.4 touch disjoint
files.

### WP1.1 — Fixture + reducer + types

**Goal:** A standalone `ui/src/lib/transcript.ts` module that takes
a `TranscriptEvent[]` and returns a `TranscriptModel`. Spec §4 is the
authoritative contract.

**Files touched:**

- `ui/src/lib/transcript.ts` — new, ~180 lines
- `ui/src/lib/__fixtures__/login-matt-001.jsonl` — copy from
  `/Users/mw/Code/prime/brainstorm/.gauntlet/results/login-matt-001_20260422T033847Z_0iqx/run.jsonl`
- `ui/src/lib/__fixtures__/login-matt-001.artifact.md` — copy from the
  same dir's `artifacts/001.md`
- `ui/src/lib/transcript.test.ts` — new, Vitest
- `ui/vitest.config.ts` — new if not present (check first)
- `ui/package.json` — add `vitest` devDep + `"test": "vitest"` script
  if not there

**Specific work:**

1. Export the event union types verbatim from Spec §4.1. Use a
   discriminated union on `type`.
2. Export `TranscriptModel`, `TurnModel`, `ToolPair` from Spec §4.2.
3. Implement `emptyTranscript(): TranscriptModel` — returns a model
   with no runStart, an empty `turns: new Map()`, etc.
4. Implement `applyEvent(model, event): TranscriptModel`:
   - Non-mutating. Shallow-clone `turns` via `new Map(model.turns)`
     when touching a turn.
   - For each event type, route to the right field. `tool_call` and
     `tool_result` look up the turn by `event.turn`, create if
     missing, then push/pair into `tools`. Match results to calls by
     `toolUseId`.
   - Maintain `ordered: [...model.ordered, event]`.
   - Idempotence: if `event.eventId <= max(existing eventIds)`, skip
     (helper: track `maxEventId` on the model as a private field — or
     recompute on demand, pick one and be consistent).
5. Implement `reduceTranscript(events) = events.reduce(applyEvent, empty)`.
6. Implement `parseJsonl(text: string): TranscriptEvent[]`:
   - Split on `\n`.
   - Filter empty.
   - Map with try/catch per line; on failure, `console.warn` with the
     line number and continue.
7. Write tests per Spec §9 bullet list. The fixture test asserts:
   - 104 events reduced.
   - Exactly 25 turns in `turns` map.
   - `runEnd.status === "pass"`.
   - `turns.get(1)!.tools.length === 2` (the double-`read` turn).
   - `turns.get(7)!.tools[0].result!.artifact === "artifacts/001.md"`
     (extract tool artifact).
   - `systemPrompt.content` starts with "You are a thorough QA tester".

**Done when:** `npm run test -- transcript` passes with zero
console output from the reducer.

**Verifiable by:** running the tests.

### WP1.2 — Transcript CSS + font loading

**Goal:** Carry the mock's typography + warm palette tokens into the
app without disturbing existing Tailwind theme.

**Files touched:**

- `ui/index.html` — add Google Fonts `<link>` preconnect + stylesheet
  for Fraunces, DM Sans, JetBrains Mono (four weights/styles each max).
- `ui/src/styles/transcript.css` — new
- `ui/src/styles/README.md` — a short note: "scoped to transcript
  components; prefix classes `.tr-`" (one paragraph, no more).

**Specific work:**

1. Copy font `<link>` block from
   `.claude/worktrees/penelope-chat-ux-mocks/mocks/transcript-rundetail.html`
   head. Drop weights we don't use in the transcript to keep payload
   small — stick to Fraunces 400/500 + italic 400/500, DM Sans 400/500/600,
   JetBrains Mono 400.
2. Author `ui/src/styles/transcript.css`:
   - `:root` block with tokens from Spec §8.1.
   - `.tr-transcript`, `.tr-system-prompt`, `.tr-user-message`,
     `.tr-turn`, `.tr-turn-marker`, `.tr-thinking`, `.tr-assistant-text`,
     `.tr-tool`, `.tr-tool-head`, `.tr-tool-args`, `.tr-tool-result`,
     `.tr-artifact-chip`, `.tr-event-line`, `.tr-run-end`, `.tr-drawer`.
     Every class corresponds to one component.
   - Error variants: `.tr-tool.tr-error` adds the red rule + red pill
     (Spec §7.2 error variant).
   - Current-turn highlight: `.tr-turn.tr-current { background: <teal-wash>; }`.
3. The stylesheet is imported once, in `TranscriptView.tsx` (WP2.7),
   so it's tree-shaken out of routes that don't use it. Don't import
   it from `main.tsx`.

**Done when:** CSS file is valid (no browser console errors when
imported), fonts load on pages that import it (verified by inspecting
`document.fonts` at runtime during WP2.7).

### WP1.3 — Server `addEventObserver` in `logger.ts`

**Goal:** A second observer path in `EvidenceLogger` that fires the
full structured event, so live consumers can get the raw jsonl row
without parsing progress strings. Spec §6.3.

**Files touched:**

- `src/evidence/logger.ts`
- `src/evidence/logger.test.ts` — add cases for the new observer

**Specific work:**

1. Add `type EventObserver = (event: Record<string, unknown>) => void;`
   near the existing `ActionObserver` type.
2. Add a private `eventObservers: Set<EventObserver> = new Set();`.
3. Add `addEventObserver(fn)`, mirror of `addObserver` — returns an
   unsubscribe function. Isolated `try/catch` per observer, same as
   `notifyObservers`.
4. In `writeEvent`, after `appendFileSync`, call `notifyEventObservers(entry)`
   passing the **full entry** (the object just written, including
   `eventId`, `parentEventId`, `ts`, `type`).
5. The existing `notifyObservers(action, params)` path stays
   untouched. Do NOT merge the two observer channels — the legacy
   `progress` stream's shape must not change (Spec §6.3, "existing
   path stays untouched").

**Tests to add:**

- Observer fires for every `logXxx` call.
- Observer receives the exact object (eventId, ts, type, body) that
  was written to disk.
- Throwing observer doesn't prevent other observers from firing.
- Unsubscribe removes the observer.

**Done when:** `npm test -- src/evidence/logger` passes with new
cases; no changes to existing test cases needed.

### WP1.4 — Server WS extension

**Goal:** Broadcast new `transcriptSnapshot` on WS open and new
`event` per logger event. Spec §6.3.

**Files touched:**

- `src/api/ws-handlers.ts` — on-open snapshot
- `src/api/routes/run.ts` — subscribe to `addEventObserver`
- `src/api/ws-handlers.test.ts` (or whichever existing test file
  covers the handler) — add a case

**Specific work:**

1. In `handleWsOpen`, after `broadcaster.addClient(runId, ws)` and
   alongside the existing `snapshot`/`gone` branch:
   ```ts
   const runDir = join(resultsRoot, runId);
   const jsonlPath = join(runDir, "run.jsonl");
   if (existsSync(jsonlPath)) {
     const raw = readFileSync(jsonlPath, "utf8");
     const events = raw.split("\n")
       .filter(Boolean)
       .map((l) => { try { return JSON.parse(l); } catch { return null; } })
       .filter(Boolean);
     ws.send(JSON.stringify({ type: "transcriptSnapshot", events }));
   }
   ```
   - `resultsRoot` is passed in through the handler's signature. Check
     the current signature and thread it through (the handler already
     receives `registry`, similar pattern).
   - Send `transcriptSnapshot` even when the run is complete — post-
     hoc clients hitting WS will get it too (defensive; post-hoc uses
     HTTP in practice).
2. In `src/api/routes/run.ts`, next to the existing
   `logger.addObserver` call, add:
   ```ts
   const unsubscribeEventObserver = logger.addEventObserver((event) => {
     broadcaster?.send(runId, { type: "event", event });
   });
   ```
   and include it in the cleanup block at the end of `executeRun`.
3. No change to `RunBroadcaster` — `send` already takes an arbitrary
   record.

**Done when:** `curl -i ws://.../api/ws?run=<runId>` for a run on
disk returns a snapshot, and a fresh run emits `event` messages
alongside `frame` / `progress`. (Manual check via
`wscat -c`; no formal test required beyond the handler unit test.)

---

## Phase 2 — Components

Phase 2 builds the UI. All WPs except 2.7 and 2.8 are leaf components
and can be built in parallel. 2.7 needs 2.1, 2.4, 2.5, 2.6. 2.8
needs 2.7.

### WP2.1 — Hooks

**Goal:** Two hooks that hand a component a `TranscriptModel`, one
from HTTP and one from WS.

**Files touched:**

- `ui/src/hooks/useTranscript.ts` — new, ~50 lines
- `ui/src/hooks/useLiveTranscript.ts` — new, ~90 lines
- `ui/src/hooks/useTranscript.test.ts` — new (smoke, mock fetch)
- `ui/src/hooks/useLiveTranscript.test.ts` — new (smoke, mock WS)

**`useTranscript(runId)`:**

```ts
export function useTranscript(runId: string | null): {
  model: TranscriptModel | null;
  loading: boolean;
  error: string | null;
};
```

- Calls `api.results.fileText(runId, "run.jsonl")` (add this helper to
  `ui/src/lib/api.ts` if it doesn't exist — see below).
- Parses with `parseJsonl`, reduces with `reduceTranscript`.
- 404 → `error: "no-transcript"` (special sentinel, component renders
  empty state).

**`useLiveTranscript(runId)`:**

```ts
export function useLiveTranscript(runId: string | null): {
  model: TranscriptModel | null;
  connected: boolean;
  error: string | null;
};
```

- Opens `WS /api/ws?run=<runId>` (same URL as existing `useRunStream`).
  If a multiplexed connection becomes problematic, keep separate — but
  default to one.
- Applies `transcriptSnapshot.events` on receive (reduce in bulk).
- Applies each `event.event` via `applyEvent` on receive.
- Ignores `frame`, `progress`, `snapshot` (legacy), `complete`, `gone`.
- Dedupes by `eventId`.
- State shape: single `model` state, updated via `setModel(m =>
  applyEvent(m, evt))` so React sees new references each step.

**`ui/src/lib/api.ts` addition:**

```ts
results: {
  // existing get, fileUrl, ...
  fileText: (runId: string, relativePath: string) =>
    fetch(`/api/results/${encodeURIComponent(runId)}/file/${relativePath}`)
      .then((r) => r.ok ? r.text() : Promise.reject(new Error(`${r.status}`))),
}
```

**Done when:** both hooks pass their smoke tests; manual check against
a real runId in dev produces a populated `model`.

### WP2.2 — Leaf components

**Goal:** Six small components that render one thing each. Every one
~30–50 lines. No state, pure props.

**Files touched (each new, in `ui/src/components/transcript/`):**

- `SystemPromptPanel.tsx` — collapsed panel; click to expand. Shows
  first line of content as preview.
- `UserMessagePanel.tsx` — italic epigraph, one paragraph.
- `ThinkingBlock.tsx` — italic marginalia with a left rule. Renders
  `text` prop; hides if text is empty.
- `Screenshot.tsx` — `<img>` with alt text + click-to-enlarge (opens
  in new tab via `fileUrl`).
- `ArtifactChip.tsx` — button with a paperclip icon + filename. Fires
  `onOpen(path)` on click.
- `EventLine.tsx` — single line: timestamp (mono) + `event.name` +
  stringified data. Amber tint if `name` suggests warn (starts with
  `tool_result_text_oversize`, contains `error`).

**Done when:** each renders from a hand-built props fixture without
errors. Smoke test per file in `__tests__/`.

### WP2.3 — ToolPairCard

**Goal:** Render one `ToolPair` (call + optional result) as a single
card. Matches Mock IV (`transcript-rundetail.html`) tool sections.

**Files touched:**

- `ui/src/components/transcript/ToolPairCard.tsx` — new, ~90 lines
- `ui/src/components/transcript/__tests__/ToolPairCard.test.tsx` — new

**Specific work:**

1. Head: tool name + `toolUseId` (truncated to first 8 chars, title
   attribute has full) + duration (or "running…" if no result).
2. Args: `<pre class="tr-tool-args">{JSON.stringify(args, null, 2)}</pre>`.
3. Result text: `<pre class="tr-tool-result">{text}</pre>`.
   - If `text.length > 1200`, truncate with "Show more" (local
     `useState` expand).
   - If `textTruncated` is `true`, replace the preview with a banner
     linking the artifact.
4. If `result.image`, render `<Screenshot src={fileUrl(runId, image)} />`.
5. If `result.artifact`, render `<ArtifactChip path={artifact}
   onOpen={onOpenArtifact} />`. The `onOpenArtifact` callback is prop-
   drilled from `TranscriptView` (see WP2.7).
6. If `result.error`, apply `.tr-error` class to root.

**Done when:** smoke test renders with one of the real tool pairs
from the fixture (pick one navigate + one extract) and asserts key
content is present.

### WP2.4 — TurnBlock

**Goal:** Render a whole `TurnModel`.

**Files touched:**

- `ui/src/components/transcript/TurnBlock.tsx` — new, ~60 lines
- `ui/src/components/transcript/__tests__/TurnBlock.test.tsx` — new

**Specific work:**

1. Props: `{ turn: TurnModel; isCurrent: boolean; runId: string;
   onOpenArtifact: (path: string) => void }`.
2. TurnMarker: "Turn N" in Fraunces italic, timing (computed from
   llmResponse.ts minus llmRequest.ts if both present, else "").
3. Usage row: `inputTokens → outputTokens` in mono, small.
4. Thinking: `thinking.map(t => <ThinkingBlock text={t.text} />)` — if
   any have non-empty text.
5. Assistant text: render `<p class="tr-assistant-text">{text}</p>` if
   `text.trim()` is non-empty.
6. Tools: `tools.map(pair => <ToolPairCard pair runId onOpen.../>)`.
7. `isCurrent` adds `.tr-current` class for the live teal wash.

**Done when:** rendering turn 1 (two reads) shows both tool cards
in order. Turn 7 (extract with artifact) shows the chip.

### WP2.5 — RunEndPanel

**Goal:** Verdict panel — status + summary + reasoning + observations.

**Files touched:**

- `ui/src/components/transcript/RunEndPanel.tsx` — new, ~60 lines
- `ui/src/components/transcript/__tests__/RunEndPanel.test.tsx` — new

**Specific work:**

1. Props: `{ runEnd: RunEndEvent; observations: Observation[] }` —
   observations aren't in the jsonl event stream; they live on
   `result.json`. So `TranscriptView` must fetch `result.json`
   separately and pass them down. (Alternative: skip observations in
   MVP and show only status/summary/reasoning. Decision: include them,
   fetch via existing `api.results.get(runId)` in post-hoc; in live,
   they're absent until run ends and the result is written — fetch
   lazily on seeing `run_end`.)
2. Status badge: pass/fail/investigate with color.
3. Observations: split into "limitations" (kind=bug) + "suggestions"
   (kind=ux/suggestion) + "notes" (everything else), per mock VI.
4. Usage summary: same numbers as existing `RunDetail` bottom.

**Done when:** rendering with the real fixture verdict produces
"pass" + all four observations grouped correctly.

### WP2.6 — ArtifactDrawer

**Goal:** Right-side slide-over that shows artifact text.

**Files touched:**

- `ui/src/components/transcript/ArtifactDrawer.tsx` — new, ~80 lines
- `ui/src/components/transcript/__tests__/ArtifactDrawer.test.tsx` —
  new (mock fetch)

**Specific work:**

1. Props: `{ runId: string; path: string | null; onClose: () => void }`.
   Open iff `path !== null`.
2. On `path` change, fetch `api.results.fileText(runId, path)`. Show
   loading state while fetching.
3. Header: filename (`path.split("/").pop()`), size (bytes after
   fetch), buttons: Copy (navigator.clipboard.writeText), Open raw
   (opens `fileUrl` in new tab with target="_blank"), Close.
4. Body: line-numbered `<pre>`. Line numbers in a left gutter via CSS
   grid (gutter column auto-sized to digit count).
5. Keyboard: ESC closes.
6. Backdrop dims the transcript; clicking it closes.

**Done when:** opening `artifacts/001.md` renders the markdown as
plain text with line numbers; ESC closes.

### WP2.7 — Transcript + TranscriptView

**Goal:** The two container components that tie everything together.

**Files touched:**

- `ui/src/components/transcript/Transcript.tsx` — new, ~80 lines
- `ui/src/components/transcript/TranscriptView.tsx` — new, ~120 lines
- `ui/src/components/transcript/index.ts` — barrel export
- `ui/src/components/transcript/__tests__/TranscriptView.test.tsx` —
  new (smoke)

**Specific work for `Transcript`:**

1. Props: `{ model: TranscriptModel; runId: string;
   currentTurn: number | null; onOpenArtifact: (path: string) => void;
   observations: Observation[] }`.
2. Render:
   - SystemPromptPanel
   - UserMessagePanel
   - Interleave turns (sorted by turn number) with anomalies that fall
     between them (by `ts`). Simple impl: walk `model.ordered`, on
     `run_start`/`system_prompt`/`user_message`/`run_end` render
     those once; on first event of a turn render `<TurnBlock>` for
     that turn; on `event` render `<EventLine>`. Skip `llm_request`
     (no visible component). Only render each `TurnBlock` once —
     track with a `Set<number>`.
   - `RunEndPanel` at bottom if `runEnd`.
3. No internal state. Pure function of props.

**Specific work for `TranscriptView`:**

1. Route param `runId`. Prop `mode: "posthoc" | "live"`.
2. Post-hoc: `const { model, loading, error } = useTranscript(runId);`
3. Live: `const { model, connected } = useLiveTranscript(runId);`
4. Either way, also fetch `result.json` via `api.results.get(runId)`
   for observations. In live mode: defer until `model.runEnd` exists,
   then fetch. In post-hoc mode: fetch alongside the jsonl.
5. Current-turn detection (live only): largest `turn` in `model.turns`
   whose `llmResponse` is present but whose last tool has no `result`
   — that's "running". If last tool has a result and no `run_end` yet,
   current is the next turn (which hasn't emitted an llm_request
   event yet) — just highlight the latest turn in that case.
6. Artifact drawer state (`useState<string | null>(null)`). Pass
   `setArtifactPath` as `onOpenArtifact` to `Transcript`.
7. Header: title from card id (parse via existing `parseRunId`), when,
   status badge if `runEnd`, live indicator if `mode === "live"`.
8. Import `ui/src/styles/transcript.css` at the top of this file.
9. Empty / error states per Spec §7.4.

**Done when:** navigating to `/runs/login-matt-001_.../transcript`
in dev against Brainstorm's fixture renders the full 25-turn run
with the verdict and all screenshots. Drawer opens on chip click.

### WP2.8 — App.tsx route wiring + links on existing screens

**Goal:** Make the new views reachable from the app without regressing
existing pages.

**Files touched:**

- `ui/src/App.tsx` — add two routes + a route component
- `ui/src/components/RunDetail.tsx` — add link
- `ui/src/components/LiveRun.tsx` — add link

**Specific work:**

1. In `App.tsx`, import `TranscriptView`:
   ```tsx
   <Route path="/runs/:id/transcript" element={<PosthocTranscriptPage />} />
   <Route path="/runs/live/:id/transcript" element={<LiveTranscriptPage />} />
   ```
   Where each page reads the param and passes to `TranscriptView`.
2. Update the selected-run regexes in `App.tsx` so the new paths don't
   get misclassified:
   - `runIdMatch` should not match `/transcript` suffix — update the
     regex to exclude it.
   - `liveIdMatch` same.
3. In `RunDetail.tsx`, add a link pill near the `StatusBadge`:
   ```tsx
   <Link to={`/runs/${result.runId}/transcript`} className="text-xs text-teal hover:underline">
     View transcript →
   </Link>
   ```
4. In `LiveRun.tsx`, add the same link pointing at
   `/runs/live/${runId}/transcript` — placed in the header row next to
   the connected/disconnected state.

**Done when:** `npm run dev`, open a completed run, click "View
transcript", see the new view. Click browser back, see old view.

---

## Phase 3 — Verification & ship

### WP3.1 — Post-hoc end-to-end smoke

**Manual, by whoever is ready to merge.**

1. `npm run dev` in `ui/`. Server running separately from repo root.
2. Visit `/runs/login-matt-001_20260422T033847Z_0iqx/transcript`
   (the Brainstorm fixture; symlink or configure `AppConfig.dataDir`
   pointing at that repo's `.gauntlet/` for the session).
3. Verify against Spec §12 checklist:
   - System prompt expandable, content starts "You are a thorough QA tester".
   - 25 turn markers visible, no gaps in numbering.
   - Turn 1 has two `read` tool cards.
   - Turn 7 has `extract` with an artifact chip; clicking opens the
     drawer with the 9,756-byte markdown.
   - Screenshots 001–009 render inline in their turns.
   - Verdict panel shows "pass" + the four observations.
   - No console errors.
4. Also load `/runs/<legacy-run-id>/transcript` for one of the
   pre-Boswell runs in this repo — verify it shows "No transcript
   available" without crashing.

### WP3.2 — Live end-to-end smoke

1. Start a fresh run via `New Run` in the UI against Brainstorm.
2. Immediately navigate to `/runs/live/<runId>/transcript`.
3. Verify:
   - `transcriptSnapshot` arrives on connect (check DevTools WS frames).
   - `event` messages arrive as the run progresses.
   - Current turn has the teal wash.
   - A pending `tool_call` shows "running…" before its result arrives.
   - Verdict panel appears on `run_end` without a remount.
4. Legacy `LiveRun` on `/runs/live/<runId>` must still work exactly
   as before (frame + progress tail). Verify in parallel.

### WP3.3 — Update docs/format.md

Append a new section to `docs/format.md`:

```markdown
## WebSocket messages

Clients open a WebSocket at `/api/ws?run=<runId>`. Server emits these
message types:

- `snapshot` — legacy. Last browser frame + progress log strings.
  Consumed by the LiveRun screen.
- `transcriptSnapshot` — on connect, if a `run.jsonl` exists on disk
  for this run, the server sends `{ type, events }` with all events
  to date. Consumed by the transcript view.
- `event` — every event written to `run.jsonl` during a run is
  broadcast verbatim as `{ type: "event", event }`. Consumed by
  the transcript view.
- `frame` — base64 JPEG screencast frame. Consumed by LiveRun.
- `progress` — stringified tool-call/event messages (legacy).
  Consumed by LiveRun.
- `complete` — run finished; full `VetResult` included.
- `error` — fatal run error.
- `gone` — the server has no active run for this id; the client
  should fall back to post-hoc endpoints.

Clients dedupe `event`s by `eventId` (both snapshot and stream may
carry the same event during the racy startup window).
```

### WP3.4 — Commit, push, PR

1. Single branch, multiple logical commits:
   - `feat(logger): add addEventObserver for raw event broadcast`
   - `feat(ws): broadcast transcriptSnapshot + event messages`
   - `feat(ui): transcript reducer + parser`
   - `feat(ui): transcript components`
   - `feat(ui): live + post-hoc transcript hooks`
   - `feat(ui): wire transcript routes and links`
   - `docs: document WS messages + transcript view`
2. PR title: `feat: transcript UI for expanded run.jsonl`
3. PR body: link to the spec, note companion to Boswell's work, list
   screenshots or video of post-hoc + live views.

---

## Cross-cutting notes

### Style adherence

The `mocks/style.css` tokens are the source of truth for colors and
typography. Don't retune warm palette values when porting — they were
chosen deliberately against the Brainstorm design language (Spec §8).
If Tailwind utility classes are tempting ("just use `bg-stone-50`"),
resist — the tokens aren't in the Tailwind theme and adding them
would expand scope. Scoped `.tr-*` CSS only.

### Don't regress LiveRun

The existing `LiveRun` screen reads from `useRunStream` which consumes
`frame`/`progress`/`snapshot`/`complete`/`error`/`gone`. None of those
shapes change. WP1.3 adds a **second** observer channel; it does not
modify the first. If anything about `LiveRun`'s behavior is different
after WP1.4 lands, it's a regression — stop and debug.

### Fixture freshness

The Brainstorm fixture (`login-matt-001_20260422T033847Z_0iqx`) is
the first real run using Boswell's schema. If we produce a newer
fixture that covers thinking/extended-thinking or error cases, swap
the test fixture — but only one at a time, and update the test
assertions accordingly.

### Dispatching guppies

Phase 1 WPs are tight enough to dispatch to guppies in parallel.
Phase 2 WPs 2.2 can go in parallel; 2.3–2.7 are more coupled and
may be one guppy each in sequence. 2.8 needs human-in-the-loop
because it touches routing.

When dispatching, give each guppy:
- Link to the spec + this plan.
- The specific WP number and "do not exceed its scope".
- A one-sentence goal so they understand the why.
- The fixture location if they need to verify.

---

## Amendment protocol

If during implementation a WP reveals a spec ambiguity (e.g. a real
tool_result shape doesn't match what the spec assumes), amend the
spec first, commit the amendment, then proceed. Do not "patch around"
in code — the spec is the contract.
