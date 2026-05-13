---
title: "OpenAI — Prompt Caching 201 (cookbook)"
source_url: https://github.com/openai/openai-cookbook/blob/main/examples/Prompt_Caching_201.ipynb
fetched: 2026-05-13
reader: Penric@b821786d
---

# OpenAI — Prompt Caching 201

## A. Classification

Practical guide. OpenAI engineering's tactical playbook for raising
cache hit rates, not a reference. Author addresses application
developers building on top of either Chat Completions or Responses.

## B. Unity

Prompt caching is automatic prefix-matching at ≥1024 tokens; you
maximize the benefit by stabilizing the prefix and giving OpenAI a
sticky routing key (`prompt_cache_key`).

## C. Outline of major parts

1. **Basics** — what triggers caching (≥1024 tokens, 128-token
   increments, exact prefix match), what's eligible (messages,
   images, audio, tool defs, schemas), the in-memory vs 24-hour split.
2. **Why it matters** — KV-cache mechanics inside the transformer;
   cost discounts (gpt-5.2 90%, gpt-4o 50%); latency wins (up to ~80%
   TTFT reduction at long contexts).
3. **Measurement** — `usage.prompt_tokens_details.cached_tokens` (or
   `usage.input_tokens_details.cached_tokens` on Responses).
4. **Tactical playbook** — five plays:
   - Send ≥1024 tokens (sometimes lengthening saves money).
   - Stabilize the prefix (durable content first, volatile content
     last).
   - Keep tools/schemas identical (any change busts the cache).
   - Use `prompt_cache_key` for routing stickiness.
   - Use `allowed_tools` to restrict tools per-call without changing
     the cached `tools[]` array.

## D. Author's central problems

- How do users go from "caching is happening sometimes" to "we're
  hitting cache 80%+ of the time"?
- What invalidates the cache silently?
- How do we keep tool flexibility without busting prefix stability?

## E. Key terms

- **Prefix match** — caching is keyed by *exact* token-prefix
  identity, in 128-token granularity, after a 1024-token minimum.
- **Routing stickiness** — caches are per-machine; without help,
  requests with the same prefix may land on different machines and
  miss. `prompt_cache_key` biases routing toward the same machine.
- **Cached tokens** — the count of input tokens served from cache on
  a given request. The success metric.
- **`allowed_tools`** — per-call restriction on which tools the model
  may invoke; lives outside the cached prefix, so per-call gating
  doesn't bust the cache. Reach for this instead of mutating
  `tools[]` when you want to narrow the move set on a turn.

## F. Main propositions and arguments

1. **Cache hits compound to real money.** gpt-5.2 cached input is
   $0.175/M vs $1.75/M uncached — 90% discount. For an agent loop
   that resends a 10k-token system prefix on every turn, that's the
   difference between paying for the prefix once vs paying for it
   N times.

2. **Stabilize-the-prefix is the highest-leverage play.** Tool
   definitions are injected before developer instructions, so any
   tool change invalidates the cache. Move volatile content (user
   input, dynamic values, timestamps) to the END of the prompt.
   Cookbook calls out timestamps explicitly as a common cache-busting
   bug — move them to `metadata` instead.

3. **Codex builds its agent loop append-only for exactly this
   reason.** System instructions, tool definitions, sandbox config,
   environment context are kept identical and consistently ordered.
   When runtime config changes (new working directory, new approval
   mode), Codex *appends* a new message rather than rewriting the
   prefix. The agent-loop shape itself is part of the caching
   strategy.

4. **`prompt_cache_key` is routing, not a key.** It doesn't tell
   OpenAI "look up cache entry X." It increases the probability that
   a request lands on the same inference engine that handled prior
   requests with the same key — those engines have warm caches for
   that prefix. One cited customer went from 60% to 87% hit rate by
   adding it.

5. **The 1024-token floor sometimes inverts intuition.** A 900-token
   prompt never caches; a 1100-token prompt with a 50% hit rate
   saves 33% on input cost. Slightly longer prompts can be *cheaper*
   if they cross the threshold and stabilize.

## G. Critique

- **Uninformed:** the cookbook doesn't address what happens to
  caching when reasoning items are passed back on subsequent turns
  (that's covered in the reasoning-items cookbook — they should
  cross-link more).
- **Misinformed:** none observed. The 60→87% story is anecdotal but
  presented as such.
- **Illogical:** none.
- **Incomplete:** the cookbook doesn't quantify how often
  `prompt_cache_retention='24h'` actually pays back — it's gated on
  whether your traffic pattern has 24-hour-relevant reuse. For
  Gauntlet runs that are minutes-to-hours long, the in-memory
  default is probably enough.

## H. What of it?

For Gauntlet's OpenAI provider:

1. **Set `prompt_cache_key = runId`** on every request within a run.
   Routing stickiness within a run is the workload this is designed
   for: same prefix for ~14–30 turns, all in the same run.

2. **Audit the prefix order.** System prompt → tool definitions →
   conversation history (oldest first). Anthropic's adapter does this
   already (cache_control breakpoints prove it); the OpenAI adapter
   needs the same discipline.

3. **Don't change tools mid-run.** If we ever want per-turn tool
   gating, use `allowed_tools` rather than mutating `tools[]`.
   Currently we don't gate, so this is a future-discipline note.

4. **Wire `cached_tokens` to `TokenUsage.cacheReadInputTokens`.**
   Without it we can't tell whether caching is helping. This is the
   minimum measurement needed before claiming a cache win.

5. **Don't bother with `prompt_cache_retention='24h'` initially.**
   Gauntlet runs are too short for 24-hour reuse to matter. Revisit
   if we ever pre-warm a fixture with a long-lived cache.

6. **Move any timestamps in the system prompt to `metadata`.** None
   observed in the current persona/system-prompt assembly, but worth
   guarding against on review.

## Permanent notes extracted from this source

- [[stable-prefix-is-the-caching-strategy]] — the architectural claim:
  agent loops should be append-only because that's what caching needs.
- [[prompt-cache-key-is-routing-not-lookup]] — common mental-model
  error worth correcting; the parameter name suggests "key" but
  behaves like "session affinity."
- [[caching-floor-can-make-longer-prompts-cheaper]] — the 1024-token
  threshold inverts intuition in a useful way.
