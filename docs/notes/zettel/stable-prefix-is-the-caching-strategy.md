---
title: "Append-only conversation IS the caching strategy — prefix stability is an agent-loop design principle"
source: "../sources/openai-prompt-caching-201-cookbook.md"
created: 2026-05-13
schema_version: 1
links: [prompt-cache-key-is-routing-not-lookup, reasoning-items-roundtrip-on-tool-turns, three-surfaces-prompt-tool-harness, tool-descriptions-load-bearing-on-46]
---

# Append-only conversation IS the caching strategy — prefix stability is an agent-loop design principle

Prompt caching on most providers (OpenAI, Anthropic) works by
exact-prefix match: if a request begins with the same N tokens as a
recently processed request, the KV-cache state for that prefix is
reused. Any change to the prefix invalidates the cache. The
implication for agent-loop architecture is bigger than "configure
caching": the loop has to be *built* such that the prefix is stable
across turns.

OpenAI's Codex team articulates this explicitly: their agent loop
keeps system instructions, tool definitions, sandbox config, and
environment context identical and consistently ordered between
requests. When mid-conversation runtime config changes (new working
directory, new approval mode), they *append a new message* rather
than rewriting the prefix. The architectural commitment to
append-only is what makes the cache hits possible.

Concrete invalidators to design around:
- Tool definitions are typically injected before instructions; any
  reorder, rename, or schema tweak busts the cache for the rest of
  the run.
- Timestamps in the system prompt are a frequent silent bust; move
  them to `metadata` if you need them retrievable.
- Mid-run prompt edits, even cosmetic ones, prevent later turns from
  hitting cache.

The corollary: per-turn flexibility (different tools available on
different turns, dynamic system prompts) costs caching directly. If
you need per-turn tool gating, use opt-in restrictions like OpenAI's
`allowed_tools` that live outside the cached prefix, instead of
mutating `tools[]`.

This is a [[three-surfaces-prompt-tool-harness|harness-level]]
property — the system prompt assembly, the tool registration order,
and the conversation-replay logic together determine whether caching
hits. It cannot be set via a single configuration knob.

The principle generalizes across providers. Anthropic's
`cache_control` breakpoints work the same way, just with explicit
markers; OpenAI's automatic-with-`prompt_cache_key` works the same
way without them. The architectural discipline is identical.

Source: OpenAI cookbook, `examples/Prompt_Caching_201.ipynb`,
sections 4.2 ("Stabilize the Prefix") and 4.3 ("Keep Tools and
Schemas Identical"), with the "Learnings from Codex" callout.
