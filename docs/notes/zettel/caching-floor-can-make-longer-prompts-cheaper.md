---
title: "A 1024-token caching floor can make a longer prompt cheaper than a shorter one that never caches"
source: "../sources/openai-prompt-caching-201-cookbook.md"
created: 2026-05-13
schema_version: 1
links: []
---

# A 1024-token caching floor can make a longer prompt cheaper than a shorter one that never caches

OpenAI's prompt cache only activates at ≥1024 input tokens. Below
that, no caching happens at all, regardless of how repetitive the
traffic is. This produces a counterintuitive cost regime near the
threshold:

- A 900-token prompt: 0% cached, full price every request.
- An 1100-token prompt at 50% cache rate: 33% cheaper per request
  (cached input is half-price or less; the 50% that hits cache pays
  the cached rate).
- An 1100-token prompt at 70% cache rate: 55% cheaper per request.

So padding a sub-floor prompt with stable boilerplate to cross the
threshold can reduce cost — even though you've nominally added
tokens. The mechanism is that the *uncached* per-token cost is much
higher than the *cached* per-token cost (90% discount on gpt-5.2,
75% on gpt-4.1, 50% on gpt-4o), so any meaningful cache rate on a
slightly-longer prompt beats no cache rate on a shorter one.

This inverts the usual "shorter prompts are cheaper" heuristic
inside a narrow band around the floor. Outside the band the heuristic
holds — but for systems whose prompts naturally land just under
1024 tokens, the right move can be to bulk them up with stable
content (clarifying instructions, durable examples, schema
restatements) until they cross.

The same logic applies to the analogous threshold on other providers
(Anthropic's `cache_control` has its own minimums). The portable
claim: when a caching system has a minimum-size floor, *prompts near
the floor are in a non-monotonic cost regime*, and the right
optimization is sometimes addition, not removal.

Source: OpenAI cookbook, `examples/Prompt_Caching_201.ipynb`,
section 4.1 ("Send a Prompt over 1024 tokens").
