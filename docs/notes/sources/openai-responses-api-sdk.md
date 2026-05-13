---
title: "OpenAI — Responses API (SDK type contract, openai@6.27.0)"
source_url: node_modules/openai/resources/responses/responses.d.ts (lines 681–6160)
fetched: 2026-05-13
reader: Penric@b821786d
---

# OpenAI — Responses API (SDK type contract)

## A. Classification

Practical / technical reference (API contract). Not a guide; the
authoritative type definitions for `client.responses.create()`. Read
because guides at `platform.openai.com` are Cloudflare-gated and the
SDK types are the closer-to-truth artifact anyway: prose drifts, the
shipped TypeScript types are what code compiles against.

## B. Unity

The Responses API replaces the old `messages[]`-shaped chat completion
with an *item-stream* request/response (`input: ResponseInput[]` →
`output: ResponseOutputItem[]`), and adds three things that don't
exist in Chat Completions: (1) reasoning items as first-class output,
(2) explicit `prompt_cache_key`/`prompt_cache_retention` (also
backported to Completions, see below), and (3) optional server-side
state via `previous_response_id`.

## C. Outline of major parts

The `responses.d.ts` file (6254 lines) factors into roughly:

- **Lines 681–902 — `Response`**: the response object shape.
- **Lines 5877–6160 — `ResponseCreateParams{Base,NonStreaming,Streaming}`**:
  the request shape.
- **Item taxonomy (~80 interfaces)**: each output-item kind has its
  own interface (`ResponseFunctionToolCall`, `ResponseReasoningItem`,
  `ResponseOutputMessage`, `ResponseFileSearchToolCall`, …). The
  unions `ResponseInputItem`, `ResponseOutputItem`, and `ResponseItem`
  enumerate which item types appear where.
- **Tool taxonomy**: `Tool = FunctionTool | FileSearchTool | ComputerTool
  | WebSearchTool | Mcp | … | CustomTool`. Function tools (the kind we
  use) have a *flat* shape: `{type:'function', name, description,
  parameters, strict}` — different from Completions' nested
  `{type:'function', function:{name,description,parameters}}`.
- **Streaming events**: ~50 event interfaces (`ResponseTextDeltaEvent`,
  `ResponseReasoningSummaryTextDeltaEvent`, etc.). Out of scope for
  this read; we are not streaming.
- **Shared.Reasoning** (separate file, `shared.d.ts:143`): the
  reasoning-config object with `effort` (`'none'|'minimal'|'low'|
  'medium'|'high'|'xhigh'`) and `summary` (`'auto'|'concise'|
  'detailed'`).

## D. Author's central problems

OpenAI is solving for three things the Chat Completions API can't
cleanly solve:

1. **Reasoning models need a place to put reasoning items in the
   response stream**, and a way to feed those items back on the next
   turn so the model preserves chain-of-thought (per-turn discard
   loses ~3% on SWE-bench in their tests).
2. **Stateful conversations** without forcing the client to resend
   the full history (`previous_response_id`).
3. **Compliance with stateless / Zero-Data-Retention policies** —
   `include: ['reasoning.encrypted_content']` returns reasoning as an
   opaque encrypted blob the client passes back, never persisted on
   OpenAI servers.

A non-stated motivation: **explicit cache routing.** `prompt_cache_key`
gives the user control over which inference engine handles a request,
which materially improves cache hit rates (one customer cited 60% →
87% in the cookbook).

## E. Key terms

- **Response item** — any element in `Response.output[]`. Distinct
  shapes for messages, tool calls, reasoning, file-search results,
  etc. Replaces Completions' single `choice.message`.
- **`output_text`** — convenience accessor on `Response`; concatenates
  text content from `output[]` for the common "I just want the
  message" case.
- **`instructions`** — top-level system-prompt parameter on the
  request. Replaces having to send a `{role:'system'}` first message.
  Per the doc, when used with `previous_response_id`, prior
  `instructions` are NOT carried over — swapping them out is intended
  to be cheap.
- **`prompt_cache_key`** — string used by OpenAI for routing
  stickiness. Not a cache key in the get/set sense; it influences
  *which inference machine* a request lands on, and machines cache
  prefixes they've seen. The actual cache lookup is still by exact
  prefix match.
- **`prompt_cache_retention`** — `'in-memory' | '24h'`. Default is the
  short-lived in-memory cache; `'24h'` opts into extended caching.
- **`include`** — array of opt-in extra fields the response should
  carry. Notably `'reasoning.encrypted_content'` to receive opaque
  reasoning items for stateless multi-turn use.
- **`store`** — boolean. When `false`, the response is not retained
  server-side; required for stateless mode with encrypted reasoning.
- **`previous_response_id`** — opt into server-side conversation
  state. Cannot be combined with `conversation`.
- **`ResponseReasoningItem`** — output-item type `'reasoning'`,
  carrying `summary[]` (model-authored summaries of its thought
  process) and optionally `encrypted_content` (opaque round-trippable
  reasoning state). The `content[]` field exists in the type but
  per the cookbook the raw chain-of-thought is *not exposed*; only
  summaries are user-visible.
- **`Shared.Reasoning.effort`** — same set of levels as Anthropic's
  `output_config.effort`-ish surface (`none|minimal|low|medium|high|
  xhigh`), per-model defaults vary; gpt-5.1 defaults to `none`.
- **`Shared.Reasoning.summary`** — `'auto'|'concise'|'detailed'`,
  controls how verbose the summary in `ResponseReasoningItem.summary`
  is. For visibility, we want `'detailed'` (or `'auto'` and accept
  what we get).

## F. Main propositions and arguments

1. **Reasoning content is not in Chat Completions.** Confirmed by
   reading `ChatCompletionMessage` (lines 792–825): it has `content`,
   `refusal`, `role`, `annotations`, `audio`, `tool_calls` — nothing
   reasoning-shaped. Only `usage.completion_tokens_details.
   reasoning_tokens` carries a *count*. So the Gauntlet observation
   "reasoning is empty in the output" for GPT runs is a structural
   limit of the API, not a code bug. Surfacing reasoning *requires*
   migrating to Responses.

2. **Caching is symmetric across both APIs.** Both Chat Completions
   (line 1340/1347) and Responses (line 5982/5989) expose
   `prompt_cache_key` and `prompt_cache_retention`. The migration
   does NOT unlock caching that was previously inaccessible — we
   could fix our caching today on Completions. The migration is
   justified by reasoning visibility, not by caching. Caching is
   along for the ride.

3. **Per-turn reasoning persistence is a Responses-only capability.**
   In tool-using multi-turn loops, passing prior reasoning items back
   on subsequent turns improves model performance (cookbook: ~3% on
   SWE-bench). On Completions there's nothing to pass back — the
   reasoning was never exposed. On Responses, you either set
   `previous_response_id` (stateful) or pass the items back yourself
   in `input[]` (stateless, with `include:['reasoning.encrypted_
   content']`). For tool-heavy loops like Gauntlet, this is the
   biggest *quality* lever in the migration.

4. **The Responses tool-call/result format is structurally different
   from Completions.** Tool calls land as top-level `function_call`
   items in `output[]` with `call_id` (not `id`); tool results go
   back as `function_call_output` items in `input[]` with `call_id`
   matching. Compare Completions' `message.tool_calls[]` and
   `{role:'tool', tool_call_id, content}` reply shape. Migration
   touches `convertTool`, `openaiToolResultMessages`, and the
   message-assembly path in our agent loop — not just `convertResponse`.

5. **Stateful (`previous_response_id`) and stateless (encrypted
   reasoning) are equally supported migration targets.** The choice
   is independent of the migration itself. Stateless matches our
   existing Anthropic pattern (we send full history each turn) and
   keeps the audit trail on our side; stateful reduces request size
   and is simpler to wire but couples us to OpenAI's retention.
   Stateless is the conservative migration target.

## G. Critique

- **Uninformed:** the type file says nothing about quotas, rate
  limits, or per-model availability of `prompt_cache_retention='24h'`
  — those almost certainly exist and are documented elsewhere. Don't
  assume `'24h'` works on every model.
- **Misinformed:** none observed in the type file itself. The
  cookbook's "boosted cache utilization 40%→80% by switching from
  Completions to Responses" claim is in their setup, not measured for
  our shape; until we measure on Gauntlet's actual runs, treat as a
  plausibility argument, not a guarantee.
- **Illogical:** none.
- **Incomplete:** the type file doesn't document what happens if you
  send a `ResponseReasoningItem` from a *different* response into
  `input[]` — i.e. cross-conversation reasoning splicing. The
  cookbook implies "always pass back what you got"; behavior on
  arbitrary insertion is undefined here. Not relevant to our use case.

## H. What of it?

For the Gauntlet OpenAI provider:

1. **Migrate to Responses.** The single load-bearing reason is
   reasoning visibility — the user (Matt) explicitly asked for it,
   and Chat Completions structurally cannot provide it. Caching
   improvements come along for free.

2. **Go stateless.** Send the full conversation as `input[]` each
   turn. Set `store: false`. Use `include: ['reasoning.encrypted_
   content']`. Pass reasoning items back on the next turn just like
   we already pass back assistant messages and tool calls. This
   matches our Anthropic provider's pattern and avoids server-side
   coupling.

3. **Set `prompt_cache_key` to the run ID.** Improves routing
   stickiness within a run, which is exactly the workload that
   benefits (long, stable system+tools prefix; many turns; same key
   across all turns of one run).

4. **Set `reasoning.summary: 'detailed'`** so the surfaced reasoning
   item carries useful text (otherwise we get either nothing or a
   minimal summary). Be honest with Matt: the user-visible artifact
   is the model's *summary* of its thinking, not the raw chain of
   thought (raw is never exposed by OpenAI for safety reasons). This
   is structurally less than what Anthropic gives us — which is also
   why we should not over-promise "Claude-like reasoning visibility."

5. **Keep effort at `medium`** to match what we did for Anthropic
   (PRI-1589). Same default-floor argument.

6. **Add a `reasoning` field to `AgentResponse`** so both providers
   can surface reasoning content provider-neutrally. The current
   shape has no place to put it.

7. **Wire up `usage.input_tokens_details.cached_tokens`** through to
   `TokenUsage.cacheReadInputTokens` so we can actually see whether
   our caching is working. The current adapter drops this metric on
   the OpenAI side; the type comment in `provider.ts:39` says "OpenAI's
   SDK does not surface this metric" — that comment is wrong now (and
   maybe was always wrong; it's accessible on Completions too).

## Permanent notes extracted from this source

- [[chat-completions-cannot-expose-reasoning]] — structural API limit
  that determines whether the migration is necessary.
- [[responses-api-item-stream-shape]] — the `input[]`/`output[]` item
  taxonomy is the most distinctive feature; everything else falls out
  of it.
- [[stateless-vs-stateful-responses-migration]] — encrypted reasoning
  vs `previous_response_id`; the trade-off and why stateless is the
  conservative target for an existing stateless agent loop.
- [[reasoning-summary-not-raw-thoughts]] — what "exposing reasoning"
  actually buys you on OpenAI; honest framing for the user.
