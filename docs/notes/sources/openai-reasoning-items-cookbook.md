---
title: "OpenAI — Reasoning Items in the Responses API (cookbook)"
source_url: https://github.com/openai/openai-cookbook/blob/main/examples/responses_api/reasoning_items.ipynb
fetched: 2026-05-13
reader: Penric@b821786d
---

# OpenAI — Reasoning Items in the Responses API

## A. Classification

Practical guide. OpenAI engineering's playbook for getting more
intelligence and lower cost out of reasoning models (o3, o4-mini,
gpt-5.x) by using the Responses API's reasoning-item plumbing
correctly.

## B. Unity

Reasoning models produce internal chain-of-thought tokens; if you
discard them between turns, you lose ~3% on hard benchmarks and bust
your prompt cache. Pass them back via `previous_response_id` (stateful)
or `include:['reasoning.encrypted_content']` (stateless) to keep them.

## C. Outline of major parts

1. **How reasoning models work** — reasoning tokens are internal,
   only summaries are user-exposed.
2. **The Responses API exposes reasoning items in the output stream.**
3. **Why pass them back when the diagram says they're discarded?** —
   tool-use turns specifically benefit from passing reasoning items
   back; pure-conversation turns don't need it.
4. **Caching interaction** — full prefix cache hits require the
   reasoning items from the prior turn to be present. Switching
   Completions→Responses raised cache utilization 40%→80% in their
   tests.
5. **Encrypted reasoning items** — the stateless escape hatch for
   ZDR / compliance / "we don't want server-side state" cases.
6. **Reasoning summaries** — what's actually shown to humans, in
   contrast to the (never-exposed) raw chain of thought.

## D. Author's central problems

- How do clients get the cost / latency / quality benefits of caching
  on reasoning models, when reasoning tokens normally don't fit
  cleanly into stateless multi-turn?
- How do clients give end users a window into "what is the model
  thinking" without OpenAI exposing raw chain-of-thought?
- How do compliance-constrained orgs (ZDR) use reasoning models at all?

## E. Key terms

- **Reasoning item** — an output item with `type: 'reasoning'`,
  carrying an ID, optional `summary[]` (user-readable), optional
  `content[]` (the type allows it; the docs say the raw chain is not
  exposed), and optional `encrypted_content` (opaque blob).
- **Reasoning summary** — model-authored text describing its
  reasoning, controllable via `Shared.Reasoning.summary`
  (`'auto'|'concise'|'detailed'`). What you can show users.
- **Encrypted reasoning content** — the same chain-of-thought,
  encrypted server-side, returned as an opaque string. Round-trip it
  back into `input[]` to give the model "memory" of its prior
  thoughts without OpenAI retaining state.
- **`previous_response_id`** — the stateful alternative; OpenAI keeps
  the conversation server-side, you reference it by ID.
- **`store`** — boolean. ZDR orgs always have it forced to false;
  encrypted reasoning is the workaround for them.

## F. Main propositions and arguments

1. **Reasoning items are not normally needed across turns — except
   when there's a tool call mid-turn.** OpenAI's training discards
   reasoning between conversational turns; the model is trained to
   produce its best output without prior reasoning visible. But when
   a turn includes a function call (round-trip outside the API), the
   model benefits from seeing its own prior reasoning when it
   resumes. Quoted: "~3% improvement on SWE-bench" when reasoning
   items are passed through tool-use turns.

2. **Switching Chat Completions → Responses raised cache utilization
   from 40% to 80% in OpenAI's own tests.** The explanation: passing
   reasoning items back keeps the prefix complete, which lets later
   turns hit cache. On Completions there's nothing to pass back, so
   the prefix structurally diverges between turns of a reasoning-model
   conversation.

3. **Encrypted reasoning items make stateless multi-turn possible.**
   Add `'reasoning.encrypted_content'` to `include`; receive
   `encrypted_content` in each reasoning item; pass items back in
   `input[]` on the next turn. OpenAI decrypts in-memory, uses,
   discards. ZDR-compatible. This is the right shape for any agent
   loop that already sends full history each turn (matches existing
   Anthropic pattern).

4. **Reasoning summaries are the only user-visible reasoning surface.**
   The raw chain of thought is *never* exposed via the API for safety
   reasons. What you get is a model-authored summary, controllable in
   verbosity. Important honesty: surfacing OpenAI "reasoning" in our
   UI is *not* the same shape as Anthropic's `thinking` blocks (which
   are the raw extended-thinking tokens). It's a structurally
   thinner artifact.

5. **The reasoning-item format is harmless when over-included.** The
   API discards reasoning items that aren't relevant for the current
   turn. So "always pass back the reasoning items you got" is safe;
   you don't need to be selective.

## G. Critique

- **Uninformed:** the cookbook doesn't quantify the cost of *not*
  passing reasoning items in production, only on benchmarks. The
  benchmark improvement is small (~3%) and benchmark-shaped; for our
  Gauntlet runs, the effect could be larger or smaller. We should
  measure.
- **Misinformed:** none observed.
- **Illogical:** none.
- **Incomplete:** the cookbook doesn't address how the reasoning
  summary's content behaves when passed back — is the summary itself
  re-fed to the model, or only the encrypted blob? In our case we
  want the summary for *display*, and the encrypted_content for
  *next-turn quality*; they're separate concerns and we should treat
  them as such.

## H. What of it?

For Gauntlet's OpenAI provider:

1. **The user-visible "agent reasoning" we surface is the
   `summary[].text` field** of `ResponseReasoningItem`. Set
   `reasoning: { summary: 'detailed' }` on requests so the summary is
   substantive. Capture this in `AgentResponse.reasoning` (new
   field) and write it into `run.jsonl` so downstream tools (the
   `gauntlet ask` Q&A flow, dashboards, post-run review) can show it.

2. **Pass `encrypted_content` back across turns** for quality. Add
   `include: ['reasoning.encrypted_content']` to the request. When
   assembling `input[]` for the next turn, include all
   `ResponseReasoningItem`s from the prior response in the same
   relative position they appeared. The harmless-when-irrelevant
   property means we can be lazy and just round-trip everything.

3. **Be honest with Matt about what reasoning visibility means
   here.** OpenAI does not expose raw chain-of-thought. We're
   surfacing model-authored summaries. They will be useful for "what
   was the model thinking when it clicked X" but they are NOT the
   same artifact Anthropic's `thinking` blocks give us. Don't oversell.

4. **Keep `store: false`.** Stateless mode matches our existing
   Anthropic pattern. We send full history each turn; OpenAI doesn't
   retain conversation state. Audit trail stays in our `run.jsonl`.

5. **Cross-link this to the caching note** — the 40→80% cache
   utilization win and the 3% SWE-bench quality win point at the
   same mechanic (reasoning-item round-tripping) for two different
   reasons. They reinforce, not duplicate, the case for the
   migration.

## Permanent notes extracted from this source

- [[reasoning-items-roundtrip-on-tool-turns]] — the load-bearing
  pattern; specific to tool-use multi-turn loops, not general
  conversational chat.
- [[reasoning-summary-not-raw-thoughts]] — already extracted from
  the Responses-SDK note; this source supplies the *why* (safety
  policy, not technical limit).
- [[encrypted-reasoning-is-stateless-roundtrip]] — the mechanism
  that makes stateless multi-turn match the stateful experience.
