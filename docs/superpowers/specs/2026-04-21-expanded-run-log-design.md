# Expanded run.jsonl — design

**Status:** drafted, awaiting review.
**Author:** Boswell (Bob 4385f13d/Opus 4.7)
**Related:** `docs/format.md`, `src/evidence/logger.ts`, `src/agent/agent.ts`

## Problem

Today's `run.jsonl` records a thin slice of what actually happened during an
agent run: one row per tool invocation from the adapter layer, plus a handful
of anomaly rows from the agent loop. It does not capture the system prompt,
the initial user message, the model's text/thinking on each turn, the tool
*results* the model saw, per-turn usage/stop_reason, or any run framing.

Post-hoc, that means we can see what tools the agent called but not what it
was thinking, what it got back, or what ultimately led to its verdict. It
also means we can't replay or resume a run.

## Goals

1. **`run.jsonl` becomes a near-complete transcript** of the agent's
   interaction — analogous in shape to Claude Code's `claude.jsonl`.
2. **Self-contained for replay.** Everything needed to reconstruct the exact
   `messages[]` array passed to the provider is on disk.
3. **Human- and LLM-readable top-to-bottom.** Reading the log in order tells
   the story of the run.
4. **Foundation for resume** (this spec's Phase 2 — implementation deferred
   to a follow-up session, but schema choices here are made with resume in
   mind).

## Non-goals

- Backward compatibility with the current `{action, params}` shape. No
  external consumer. Clean break.
- Redaction / secrets scrubbing. Runs already live in the project's
  `.gauntlet/results/` directory; treating that as authoritative artifact is
  consistent with current behavior.
- Changes to the other log files (`console.jsonl`, `exception.jsonl`,
  `log.jsonl`, `network-ws.jsonl`). They stay as they are.

## Event schema

Every line in `run.jsonl` is a JSON object with a discriminator:

```jsonc
{
  "eventId": 1,              // monotonic counter, per-run, starts at 1
  "parentEventId": 0,        // previous event's id; 0 for the first event
  "ts": "2026-04-21T14:03:11.201Z",
  "type": "run_start",       // discriminator; see types below
  // ...type-specific fields
}
```

`eventId` is a simple per-run monotonic counter rather than a ULID. Counters
are shorter, sort naturally, and read well in a text file. Cross-run refs
(forking, Phase 2) use `<runId>#<eventId>`.

`parentEventId` is the **previous event in the file** (linear chain), not
the logical parent. This matches `claude.jsonl`'s parentUuid convention,
degrades gracefully on truncation, and is simpler to emit. When Phase 2
introduces forks as sibling files, a fork's first event's `parentEventId`
will reference the fork point in the parent file.

### Event types

All events share `eventId`, `parentEventId`, `ts`, `type`.

**`run_start`** — once, first event in the file.
```jsonc
{
  "type": "run_start",
  "runId": "login-001_20260421T140311Z_k3xm",
  "cardId": "login-001",
  "target": "http://localhost:3000",
  "provider": "anthropic",
  "model": "claude-opus-4-7",
  "adapter": "web",
  "maxTurns": 50,
  "toolTimeoutMs": 30000,
  "contextTreeBytes": 4812         // 0 or omitted if no context tree
}
```

**`system_prompt`** — once, full system prompt verbatim. Embeds story card +
context tree, so the spec the agent was tested against is self-contained in
the log.
```jsonc
{
  "type": "system_prompt",
  "content": "..."
}
```

**`user_message`** — initial user message (turn 0), and any resumed-session
follow-up (Phase 2).
```jsonc
{ "type": "user_message", "turn": 0, "content": "Begin testing. ..." }
```

**`llm_request`** — emitted just before each `client.chat` call. Gives a
timestamped marker so wall-clock provider latency is measurable from the log
alone.
```jsonc
{ "type": "llm_request", "turn": 1, "messageCount": 1 }
```

**`llm_response`** — one per turn. Carries the structured, provider-neutral
view for reading *plus* the raw assistant message for replay fidelity.
```jsonc
{
  "type": "llm_response",
  "turn": 1,
  "stopReason": "tool_use",
  "text": "I'll start by loading the login page.",
  "thinking": [{                      // array; empty if model didn't think
    "text": "The card asks me to...",
    "signature": "..."                // opaque provider signature, preserved
  }],
  "toolCalls": [{ "id": "toolu_01...", "name": "navigate", "arguments": {...} }],
  "usage": {
    "inputTokens": 4812,
    "outputTokens": 187,
    "cacheCreationInputTokens": 4012,
    "cacheReadInputTokens": 800
  },
  "rawAssistantMessage": { "role": "assistant", "content": [...] }  // verbatim
}
```

**`tool_call`** — one per tool invocation in a turn. Emitted by the agent
loop (not the adapter) so the turn number is authoritative.
```jsonc
{
  "type": "tool_call",
  "turn": 1,
  "toolUseId": "toolu_01...",
  "name": "navigate",
  "arguments": { "url": "/login" }
}
```

**`tool_result`** — one per tool result.
```jsonc
{
  "type": "tool_result",
  "turn": 1,
  "toolUseId": "toolu_01...",
  "name": "navigate",
  "durationMs": 412,
  "text": "Navigated to /login (200 OK).",  // inline if small & narrative
  "image": "screenshots/001.png",            // relative path, if any
  "artifact": null,                          // relative path to spilled blob
  "error": false
}
```
On error: `text` holds the error message, `error: true`. The tool's failure
mode is as much part of the transcript as its success.

**`event`** — adapter-level anomalies and agent-loop anomalies that don't
fit another type. Current rows that move here: `stopped_max_tokens`,
`empty_response`, `report_with_other_tools_dropped`, `set_viewport_failed`,
`observer_session_failed`, `chrome_profile_cleanup_failed`,
`install_passkey_ok`, `install_passkey_failed`.
```jsonc
{ "type": "event", "name": "stopped_max_tokens", "turn": 7, "hasText": true, "toolCallCount": 0 }
```

**`run_end`** — once, last event in the file.
```jsonc
{
  "type": "run_end",
  "status": "pass",
  "summary": "...",
  "reasoning": "...",
  "observationCount": 1,
  "durationMs": 14203,
  "usage": { "inputTokens": 12500, "outputTokens": 840, "turns": 7, ... }
}
```

## Artifacts

Tool results that are naturally documents — DOM snapshots, accessibility
trees, console buffer dumps, page text extracts, HARs, PDFs — are spilled to
`artifacts/NNN.<ext>` (a sibling of `screenshots/`). The `tool_result` event
carries the relative path, not the blob.

**Policy: by kind, not size.** The adapter's tool implementation decides:
if the tool is returning a document, it calls `logger.saveArtifact(data,
kind, ext)` and returns the relative path as part of the tool result. Short
narrative results (`"clicked #submit"`, extract snippets, CLI stdout) stay
inline so the log reads as narrative top-to-bottom.

**Size safety net.** Any inline `text` field exceeding 32 KB is auto-spilled
to `artifacts/` and the row gets `textTruncated: true` with the byte count.
Prevents one rogue tool from making the log unreadable. Emits an `event`
row so the regression is visible.

**Images.** The existing `saveScreenshot` flow stays as-is for screenshots
(`screenshots/NNN.png`). `saveArtifact` covers everything else.

### Artifact directory

```
<runDir>/
  run.jsonl
  screenshots/        existing
  artifacts/          NEW — NNN.html, NNN.json, NNN.txt, NNN.har, etc.
  ...
```

`result.json`'s `evidence` manifest gains an optional `artifacts: string[]`
field. The results HTTP endpoint's relative-path check (file must be in the
manifest) already handles this — we just need to populate it from
`logger.artifacts`.

## Scope split

**Phase 1 (this spec, next session):**
- `EvidenceLogger` gains typed emitters, the event-id chain, and
  `saveArtifact`.
- Agent loop emits the full event stream.
- Adapters drop `logAction(name, args)` for tool calls (agent owns those);
  keep their anomaly `logEvent` calls.
- Web adapter: DOM dumps / large extracts route through `saveArtifact`.
- `result.json` gains `evidence.artifacts`.
- `docs/format.md` updated. Tests updated.

**Phase 2 (separate spec + session):** resume. Schema above is designed to
support it; implementation is not part of this spec.

## Implementation sketch

`src/evidence/logger.ts` — expand `EvidenceLogger`:
- `private eventCounter = 0`, `private lastEventId = 0`
- `private write(type, body)` — common path, assigns id + parent, appends
- Typed methods: `logRunStart`, `logSystemPrompt`, `logUserMessage`,
  `logLlmRequest`, `logLlmResponse`, `logToolCall`, `logToolResult`,
  `logEvent`, `logRunEnd`
- `saveArtifact(data: Buffer | string, ext: string): string` — writes to
  `artifacts/NNN.<ext>`, returns relative path, tracks list
- `get artifacts(): string[]`
- Drop the old generic `logAction` (or keep as alias for adapter anomalies
  → resolved as `logEvent`)

`src/agent/agent.ts` — emit events at the right points:
- `logRunStart` before the loop
- `logSystemPrompt` once
- `logUserMessage` for the initial message
- Each turn: `logLlmRequest` → call → `logLlmResponse`
- For each tool call in the response: `logToolCall` → execute →
  `logToolResult` with timing, image path, artifact path, error flag
- Existing anomaly rows: `logEvent` with the same `name`
- `logRunEnd` inside the terminal `buildResult` helper

`src/adapters/{cli,tui,web}/adapter.ts`:
- Remove `logger.logAction(name, args)` at the top of `executeTool`
- Keep the anomaly calls; migrate them to `logger.logEvent`
- Web adapter: whatever currently stuffs big DOM/a11y output into the tool
  result text calls `logger.saveArtifact` instead and returns the path (and
  a short inline summary)

`src/types.ts` — `VetResult.evidence.artifacts?: string[]`.

`docs/format.md` — rewrite the "run.jsonl" section from "one JSON object per
tool call" to the event stream above. Note artifacts dir.

## Testing

- `test/evidence/logger.test.ts` — per-event-type emit tests; id/parent
  chain correctness; artifact write + path tracking.
- `test/agent/*` — new: verify `run_start` / `system_prompt` /
  `user_message` / `llm_response` / `tool_call` / `tool_result` / `run_end`
  sequence on a happy-path run; tool error produces `error: true`;
  max_tokens produces both `event` and `run_end`.
- Existing `test/adapters/*` — update fixtures that asserted `logAction`
  output to the new schema.

## Open questions

None blocking. Minor judgment calls made inline (counter-based eventId;
linear parent chain; by-kind artifact policy with 32KB safety net; drop old
log row shape). If any of those are wrong, they're cheap to revisit.
