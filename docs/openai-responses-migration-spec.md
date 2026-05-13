# OpenAI Responses API Migration — Spec

**Status:** revised after review; ready for plan-phase
**Author:** Penric@b821786d (Opus 4.7)
**Date:** 2026-05-13
**Ticket:** PRI-1594

## Problem

The Gauntlet OpenAI provider (`src/models/openai.ts`) talks to the
Chat Completions API. This has two consequences the project wants to
fix:

1. **Model reasoning is empty in run output.** Reasoning-class models
   (`gpt-5-thinking`, `gpt-5.4-mini`, the o-series) produce reasoning
   tokens when called, and the user is billed for them — the count
   appears in `usage.completion_tokens_details.reasoning_tokens`. The
   *content* of that reasoning is never returned by Chat Completions.
   Inspection of the SDK type confirms this is structural:
   `ChatCompletionMessage` (in `node_modules/openai/resources/chat/
   completions/completions.d.ts:792`) carries `content`, `refusal`,
   `role`, `annotations`, `audio`, `tool_calls` — no reasoning field.
   Run.jsonl for GPT runs shows empty reasoning as a result. This is
   not a bug in our adapter; the API surface does not provide it.

2. **Caching is opaque and unmeasured.** OpenAI applies automatic
   prefix caching at ≥1024 tokens, but we set no `prompt_cache_key`,
   so routing across inference engines is unsticky. We also drop the
   `cached_tokens` metric on the read path — `provider.ts:39`'s
   comment that "OpenAI's SDK does not surface this metric" is no
   longer accurate (and `chat.completions.create` also accepts
   `prompt_cache_key` now).

The user (Matt) has explicitly asked for both axes to improve. The
reasoning-visibility ask is the load-bearing one: he wants to see
*what the model is thinking* in our run logs, the way we already do
for Anthropic.

## Approach

Migrate `src/models/openai.ts` from `client.chat.completions.create`
to `client.responses.create`. Surface reasoning items in
`AgentResponse` via a new provider-neutral `reasoning` field. Set
`prompt_cache_key` to the run ID for routing stickiness. Wire the
`cached_tokens` metric through to `TokenUsage`.

Migrate **statelessly** — send the full conversation as `input[]` on
every turn, set `store: false`, opt into encrypted reasoning items
(`include: ["reasoning.encrypted_content"]`) and round-trip them
back into `input[]` on subsequent turns to preserve reasoning state
across tool-call turns.

The migration is structural — Chat Completions and Responses use
different request shapes, different response shapes, different
tool-call envelopes, and a different system-prompt slot. It is not
a parameter change. See the per-source notes in
`docs/notes/sources/openai-responses-api-sdk.md` and
`docs/notes/sources/openai-reasoning-items-cookbook.md` for the
detailed API contracts.

## Why this and not the alternatives

### Why not "add prompt_cache_key to Chat Completions and call it done"

`prompt_cache_key` is symmetric across both APIs — we could in
principle gain the cache improvements without migrating. We don't
choose this path because:

1. It does nothing for the reasoning-visibility ask, which is the
   primary motivation. Empty reasoning would remain empty.
2. On reasoning-class models specifically, OpenAI reports cache
   utilization climbs from 40% to 80% when reasoning items can be
   passed back across turns — and that path requires Responses. So
   even the caching argument partly depends on the migration.

### Why not stateful (`previous_response_id`)

Server-side state would let us send smaller requests (no need to
resend history). We don't choose this because:

1. It couples our audit trail to OpenAI's retention policy. Our
   run.jsonl currently has the full conversation; stateful mode
   would leave gaps that only the OpenAI server can resolve.
2. Our existing Anthropic adapter is stateless. Mixing data-flow
   shapes across providers makes the agent loop harder to reason
   about.
3. Stateless mode is ZDR-compatible by construction; stateful is
   not. Future flexibility favors stateless.

The stateless option is functionally equivalent for quality and
caching when combined with encrypted reasoning round-trip — see
`docs/notes/zettel/encrypted-reasoning-is-stateless-roundtrip.md`.

### Why not just expose reasoning *summaries* without round-tripping

We could capture `ResponseReasoningItem.summary[].text` for display
and not bother passing items back on subsequent turns. Cheaper
implementation. We don't choose this because the round-trip cost is
low (the encrypted blobs travel over the wire either way once we've
set `include: ["reasoning.encrypted_content"]`) and the upside —
preserved chain-of-thought across tool-call turns — is the quality
win OpenAI specifically tested. Round-trip everything we receive;
the API discards what isn't relevant.

## Design

### User-visible semantics

After the migration:

1. **Reasoning summaries appear in run.jsonl** for OpenAI-driven
   runs, on turns where the model produced any reasoning. They land
   in a new `reasoning` field on each assistant turn record, parallel
   to the existing `text` field. Verbosity controlled by
   `reasoning.summary` parameter (default `"auto"`; configurable).

2. **Important honesty:** OpenAI's "reasoning" is a *model-authored
   summary*, not raw chain-of-thought. This is structurally thinner
   than Anthropic's `thinking` blocks (when extended thinking is on).
   Both are useful but they are not the same artifact. UI surfaces
   that show reasoning should label faithfully — e.g. "summary" for
   OpenAI, "thinking" or "chain of thought" for Anthropic — rather
   than collapsing the distinction. (Out of scope for this spec
   beyond producing the right data; UI labeling is a separate task.)

3. **No user-facing change to tool-call shape, deadline handling,
   reflection injection, or any other agent-loop semantics.** This
   is provider-internal.

4. **Cache hit rate should improve.** Visible in
   `TokenUsage.cacheReadInputTokens` (newly populated for OpenAI). We
   should observe non-zero values from turn 2 onward on any run with
   a stable system prompt.

### Provider-neutral type changes

In `src/models/provider.ts`:

- `AgentResponse` gains an optional `reasoning?: string` field.
  Populated by OpenAI with `summary[].text` joined; populated by
  Anthropic with extended-thinking text (when present — Anthropic
  adapter currently drops these too, fixed under a separate ticket).

- `LLMClient.chat()` gains an optional fourth parameter
  `requestContext?: { runId?: string }`. The agent loop already
  knows the run ID; threading it into the model call is what lets
  the OpenAI adapter set `prompt_cache_key`. Optional and additive:
  Anthropic ignores it for now (Anthropic's caching is breakpoint-
  driven, not key-driven), and the type stays compatible with any
  future caller that doesn't have a run context.

- `TokenUsage.cacheReadInputTokens` comment updated to reflect that
  OpenAI now populates it. `cacheCreationInputTokens` stays
  Anthropic-only — OpenAI's `ResponseUsage` returns only a read
  counter (`input_tokens_details.cached_tokens`), no write counter.

### Token-accounting convention

Anthropic returns `input_tokens` *excluding* `cache_read_input_tokens`
(disjoint counters; see `anthropic.ts:177-189`). OpenAI Responses
returns `input_tokens` *including* `input_tokens_details.cached_tokens`
(nested counter). Naively mapping both producers' `input_tokens` into
`TokenUsage.inputTokens` would cause `agent.ts:240-243` to double-
count cached tokens on OpenAI runs.

**Convention: `TokenUsage.inputTokens` is the *uncached* input count.**
The OpenAI adapter subtracts `cached_tokens` from `input_tokens` when
populating `TokenUsage.inputTokens`. Anthropic's adapter already
matches this convention naturally. `cacheReadInputTokens` carries the
cached-read count separately on both providers.

### Logger surface change

`agent.ts:247-257` currently peeks into `rawAssistantMessage.content`
looking for Anthropic-shaped `{type: 'thinking', thinking, signature}`
blocks and populates `logger.logLlmResponse({thinking})`. The new
OpenAI response has no `.content` — its data lives in `.output[]` —
so the `Array.isArray(raw.content)` guard would silently skip
extraction. Acceptance criterion #1 (reasoning summaries visible in
run.jsonl) would silently fail.

Therefore:

- `LlmResponseFields` in `src/evidence/logger.ts:48` gains a
  `reasoning?: string` field.
- `agent.ts` reads `response.reasoning` and passes it through to
  `logger.logLlmResponse({reasoning})`. The provider-neutral
  `AgentResponse.reasoning` field is the source of truth; the
  agent loop no longer peeks into `rawAssistantMessage` for
  reasoning.
- The existing Anthropic block-iteration becomes redundant. It can
  stay until the separate Anthropic ticket lands (`anthropic.ts:148`
  drops thinking blocks today, so until that's fixed,
  `response.reasoning` would be undefined on Anthropic — keeping
  the legacy extraction path means no regression in the meantime).
  The Anthropic ticket removes the redundancy.

### OpenAI adapter shape

Function-by-function changes in `src/models/openai.ts`:

- **`chat()`** calls `client.responses.create`. Sends:
  - `model`
  - `instructions` (the system prompt) — moves out of `messages[]`
  - `input` — array of `ResponseInputItem`, including any
    `ResponseReasoningItem`s from the prior turn's response
  - `tools` — converted to flat Responses shape
  - `reasoning: { effort: "medium", summary: "auto" }` — `effort`
    matches PRI-1589's Anthropic floor; `summary` chosen as default
    (Section "Open questions")
  - `include: ["reasoning.encrypted_content"]` — so we receive
    round-trippable reasoning state
  - `store: false` — stateless
  - `prompt_cache_key: <runId>` — routing stickiness; pulled from
    the agent loop's existing run context

- **`convertTool()`** emits flat shape:
  `{type: "function", name, description, parameters}` (was nested
  under `function:`). `strict` is omitted; the SDK default (`false`)
  matches our current behavior of not passing it on Chat Completions.

- **`convertResponse()`** walks `response.output[]`. Per item type:
  - `'message'` → contributes to `text`. If the message contains a
    `refusal` content part, the refusal text is appended to `text`
    with a leading marker and `stopReason` is set to `'refusal'`.
  - `'function_call'` → contributes to `toolCalls` (note `call_id`,
    not `id`; arguments are JSON-string, parse as today). Presence
    of any function_call also sets `stopReason: 'tool_use'`.
  - `'reasoning'` → contributes to `reasoning` (join `summary[].text`).
  - other types → ignored for now (out of scope; see Failure mode
    #6 for refusal handling specifics).
  Returns the full `output[]` as `rawAssistantMessage` so the next
  turn can replay reasoning items.

- **`stopReason` mapping** (Responses has no `finish_reason`):
  - any `output[].type === 'function_call'` → `'tool_use'`
  - else any `output[].type === 'message'` content includes
    `refusal` → `'refusal'`
  - else `response.status === 'incomplete'` and
    `incomplete_details.reason === 'max_output_tokens'` → `'max_tokens'`
  - else `response.status === 'incomplete'` and
    `incomplete_details.reason === 'content_filter'` → `'stop_sequence'`
    (matches existing convention in `mapFinishReason`)
  - else → `'end_turn'`

- **`toolResultMessages()`** (renamed conceptually but exported the
  same way) emits `function_call_output` items with `call_id`
  matching. Image attachments ride along as a user-role item with
  `ResponseInputImage` content parts, shape
  `{type: 'input_image', image_url: 'data:<mediaType>;base64,<data>',
  detail: 'auto'}` — verified at `responses.d.ts:2736-2755`. Note
  that `image_url` is a *flat string* here, not nested under
  `image_url.url` like Chat Completions.

- Multi-turn assembly: the agent loop's existing replay of
  `rawAssistantMessage` from each prior turn already gives us this
  for free — as long as `convertResponse` puts the full `output[]`
  into `rawAssistantMessage`, the next turn's `input[]` assembly
  picks up reasoning items automatically.

### Configuration

Two knobs that should be configurable but have sensible defaults:

- `reasoning.effort` — default `"medium"`, matches the Anthropic
  floor we already set. Other levels available per
  `Shared.Reasoning.effort` (`'none'|'minimal'|'low'|'medium'|'high'
  |'xhigh'`).
- `reasoning.summary` — default `"auto"`. Other levels per the SDK:
  `"concise"` and `"detailed"`. Open question (below).

These don't need CLI flags initially — hard-coded defaults at the
adapter call-site are fine. We can promote them to flags if/when
testing shows the defaults are wrong.

### Failure modes

1. **A non-reasoning model is selected on OpenAI** (e.g. `gpt-4o`).
   The `reasoning` parameter is ignored by non-reasoning models per
   the SDK comment (`reasoning?: Shared.Reasoning | null`,
   "**gpt-5 and o-series models only**"). The response will not
   contain reasoning items; `AgentResponse.reasoning` will be
   undefined. This is correct behavior.

2. **`include: ["reasoning.encrypted_content"]` on a non-reasoning
   model.** Believed to be a no-op based on the type docs, but
   worth verifying in a sanity-check run during implementation. If
   it errors, gate the `include` field behind a model-family check.

3. **`prompt_cache_key` exceeds the routing benefit by being unique
   per turn.** Mitigated: the key is the run ID, stable across all
   turns of one run. Same key reused for every request within a run.

4. **A reasoning item without `encrypted_content`.** Possible per
   the type (`encrypted_content?: string | null`). The round-trip
   path must tolerate this — include the item if present, skip the
   `encrypted_content` field if not. The model handles partial
   reasoning items per cookbook.

5. **Model-specific effort constraints.** Per `shared.d.ts:151-157`,
   `gpt-5.1` defaults to `effort: 'none'` (the supported values are
   `none|low|medium|high`); `gpt-5-pro` defaults to and only supports
   `'high'`; `xhigh` is supported only after `gpt-5.1-codex-max`.
   The spec's `effort: "medium"` default is fine for the models we
   actually use (`gpt-5.4-mini` and earlier reasoning models) but
   would error if a future caller routes through `gpt-5-pro`. The
   configurable knob mitigates this — operators pick the right value
   per model. We do not implement automatic per-model gating in this
   migration; if/when we run on `gpt-5-pro`, the operator passes
   `effort: "high"`. Note also: on `gpt-5.1`, forcing `effort:
   "medium"` *opts in* to reasoning costs the model would otherwise
   skip. That's intentional — we want reasoning visibility — but
   worth flagging in changelogs / pricing-sensitive contexts.

6. **A response containing a refusal.** `ResponseOutputMessage`
   content can contain `ResponseOutputRefusal` parts (`refusal`
   text). `convertResponse` surfaces these via `text` (with a
   marker) and sets `stopReason: 'refusal'`, matching the existing
   `StopReason` union. Tool calls are not expected to coexist with
   a refusal, but if they do, the function-call path wins for the
   stop reason (the existing `'refusal'` value already exists in
   the union; agent-loop handling of it is preserved).

### Out of scope

- **Stateful chaining via `previous_response_id`** — possible
  follow-up if benchmarking shows the request size matters.
- **Anthropic-side thinking block capture** — `anthropic.ts:148`
  drops `thinking` blocks today. Separate ticket. This spec only
  defines the *neutral type change* (`AgentResponse.reasoning?:
  string`) that both providers will populate.
- **CLI flags for reasoning effort / summary** — defaults baked in
  for now.
- **Streaming responses** — we don't stream today and aren't
  starting now.
- **Image-shape conversion details for Responses** — flagged for
  implementation but not exhaustively specified here. The
  `openaiToolResultMessages` path handles screenshots and will need
  conversion from `{type:'image_url', image_url:{url:'data:...'}}`
  to `ResponseInputImage` shape. Verify the exact shape against the
  SDK during implementation; this is a known-but-unspecified detail.
- **Per-model gating of `reasoning` / `include`** — only if §Failure
  mode 2 turns out to require it.

## Acceptance criteria

1. A Gauntlet run with `--model gpt-5.4-mini` against the
   `tutorial-04-login-credentials` fixture completes and produces a
   `run.jsonl` where reasoning summaries are visible on assistant
   turns (not empty, when the model produced reasoning).

2. The same run shows non-zero `cacheReadInputTokens` from turn 2
   onward in the per-turn usage records.

3. Behavioral parity for the tutorial fixture: pass/fail/investigate
   verdicts and turn counts are within the noise band already
   observed for gpt-5.4-mini (current baseline: ~12–16 turns on
   tutorial-04, occasional 20+).

4. Existing OpenAI tests pass — `test/models/openai.test.ts` exists
   today (covers the Chat Completions path); tests must be updated
   to match the Responses surface.

5. No regression on Anthropic-side runs (`AgentResponse.reasoning`
   is opt-in and additive).

## Open questions for review

1. **`reasoning.summary` default — `"auto"` or `"detailed"`?**
   `"auto"` lets the model decide (terser, faster); `"detailed"`
   ensures substantive content but costs latency. Recommendation:
   start `"auto"` and revisit if summaries are too thin to be
   useful. Easy to change later.

2. **Round-trip *all* output items or only reasoning + function
   calls?** Cookbook says over-inclusion is harmless, so round-trip
   everything is the lower-friction default. Recommendation: pass
   back everything in `output[]` that isn't the visible message
   text (which we surface separately as `text`).

3. ~~Does anything in the existing agent loop hold a Chat-Completions
   assumption that this spec misses?~~ **Resolved during review:**
   `agent.ts:247-257` peeks into `rawAssistantMessage.content` for
   Anthropic thinking-block extraction. The `Array.isArray(raw.content)`
   guard makes this safely no-op for the new OpenAI shape, but it
   means reasoning summaries would never reach the logger. Addressed
   by the new "Logger surface change" subsection above
   (`AgentResponse.reasoning` → `LlmResponseFields.reasoning`).

## Notes / references

- Per-source notes: `docs/notes/sources/openai-responses-api-sdk.md`,
  `docs/notes/sources/openai-prompt-caching-201-cookbook.md`,
  `docs/notes/sources/openai-reasoning-items-cookbook.md`.
- Atomic zettels: see "Permanent notes extracted from this source"
  section in each per-source note; the central claims are
  `chat-completions-cannot-expose-reasoning`,
  `responses-api-item-stream-shape`,
  `stateless-vs-stateful-responses-migration`,
  `reasoning-summary-not-raw-thoughts`,
  `reasoning-items-roundtrip-on-tool-turns`,
  `encrypted-reasoning-is-stateless-roundtrip`.
- SDK reference: `node_modules/openai/resources/responses/responses.d.ts`
  at v6.27.0. Key landmarks: line 681 (`Response`), line 4367
  (`ResponseReasoningItem`), line 5877 (`ResponseCreateParamsBase`).
