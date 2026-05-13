---
title: "Pass reasoning items back across tool-use turns — quality and cache-hit reasons converge"
source: "../sources/openai-reasoning-items-cookbook.md"
created: 2026-05-13
schema_version: 1
links: [encrypted-reasoning-is-stateless-roundtrip, responses-api-item-stream-shape, stable-prefix-is-the-caching-strategy]
---

# Pass reasoning items back across tool-use turns — quality and cache-hit reasons converge

OpenAI reasoning models (o3, o4-mini, gpt-5.x) are trained to
produce their best output without prior turns' reasoning visible —
so for pure conversational multi-turn, you can drop reasoning items
between turns. But for *tool-using* multi-turn loops, the discard
matters, for two converging reasons:

1. **Quality.** When the model decides "I need to call a tool" and
   that call goes through a round-trip to your code, the model
   resumes after the tool result. Without the prior reasoning items,
   the model is mid-thought without context. OpenAI reports
   ~3% improvement on SWE-bench when reasoning items are passed
   through tool-use turns. Benchmark-shaped, so treat as a
   plausibility-of-magnitude argument, not a guarantee.

2. **Cache utilization.** The prefix of the next request needs to
   match the prefix of the prior one for caching to hit. Reasoning
   items are part of what the model emitted; if you don't replay
   them, the conversation history visible to the model has gaps and
   the cached prefix structurally diverges. OpenAI reports a
   40% → 80% cache utilization jump from doing this correctly.

The two effects compound: passing reasoning items back makes the
model both smarter (3%) and cheaper (cache discounts on the larger
share of cached input).

Tactical pattern: collect every `ResponseReasoningItem` from a
response's `output[]` and include them, in the same relative
position they appeared, in the next request's `input[]`. Per the
cookbook, the API discards reasoning items that aren't relevant for
the current turn, so over-inclusion is harmless — round-trip
everything you got.

This is a property of *tool-using agent loops*, not chat. A
no-tool conversational app doesn't need to do this and won't
benefit. The pattern's value is highest exactly where prompt-cache
benefit is highest: many turns, stable system+tools prefix, frequent
tool calls. Gauntlet runs are this shape exactly.

Related: [[encrypted-reasoning-is-stateless-roundtrip]] — the
mechanism that makes round-tripping work without server-side state;
[[stable-prefix-is-the-caching-strategy]] — the architectural reason
the cache-utilization win exists.

Source: OpenAI cookbook, `examples/responses_api/reasoning_items.
ipynb`, "Function Calling with Reasoning Models" and "Caching"
sections.
