---
title: "prompt_cache_key is routing affinity, not a cache key — same prefix on different machines still misses"
source: "../sources/openai-prompt-caching-201-cookbook.md"
created: 2026-05-13
schema_version: 1
links: [stable-prefix-is-the-caching-strategy, state-out-of-prompt-into-harness]
---

# prompt_cache_key is routing affinity, not a cache key — same prefix on different machines still misses

OpenAI's `prompt_cache_key` parameter is named like a cache lookup
key, but doesn't behave like one. It does not tell OpenAI "look up
cache entry X." Instead, it influences *routing* — the choice of
which inference engine handles a request.

The mechanics, per the cookbook: requests are routed to inference
engines based on a hash of the first ~256 tokens of the prompt. The
`prompt_cache_key` is combined with that hash to bias routing
stickiness — requests sharing a key are more likely to land on the
same engine. That engine's local KV cache is then warm for the
prefix.

The cache itself is still keyed by exact-prefix-match (≥1024
tokens, in 128-token increments). `prompt_cache_key` doesn't change
*what* gets cached or *how* lookup happens; it changes *which
machine* you land on, which is a precondition for the cache being
warm at all.

Why this matters: in a system that thinks of the parameter as a key,
you can convince yourself caching is broken because "we set
`prompt_cache_key='X'` and we're not getting cache hits" — when the
real issue is that the prefix isn't actually stable
([[stable-prefix-is-the-caching-strategy]]), or that you're below the
1024-token floor, or that the value of the key is varying. The
routing-affinity model makes those failure modes visible: the key is
a *hint to the load balancer*, and a hint can fail to help if the
underlying conditions for caching aren't met.

A reported customer bump: 60% → 87% hit rate by adding
`prompt_cache_key`. The win is large precisely because without it,
load balancing scatters requests across machines that each have to
re-warm their cache from scratch.

Mental-model fix: think "session affinity" or "routing stickiness,"
not "cache key." If you've worked with sticky sessions in HTTP load
balancers, the model is the same.

Related: [[stable-prefix-is-the-caching-strategy]] — necessary
precondition; [[state-out-of-prompt-into-harness]] — the routing key
is harness-level state (run-id, conversation-id) rather than
prompt-level content.

Source: OpenAI cookbook, `examples/Prompt_Caching_201.ipynb`,
section 4.4 ("Use `prompt_cache_key` to Improve Routing Stickiness").
