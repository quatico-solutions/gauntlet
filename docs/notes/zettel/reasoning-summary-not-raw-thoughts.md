---
title: "OpenAI exposes reasoning summaries, not raw chain-of-thought — structurally thinner than Anthropic thinking blocks"
source: "../sources/openai-reasoning-items-cookbook.md"
created: 2026-05-13
schema_version: 1
links: [chat-completions-cannot-expose-reasoning, effort-parameter-is-the-real-depth-lever]
---

# OpenAI exposes reasoning summaries, not raw chain-of-thought — structurally thinner than Anthropic thinking blocks

When OpenAI documentation or marketing says "the Responses API
exposes reasoning," what is actually exposed is a model-authored
*summary* of the reasoning, not the raw chain-of-thought tokens.

In the SDK type, `ResponseReasoningItem` carries:
- `summary: Array<{text, type:'summary_text'}>` — what humans get to
  see. Verbosity controlled by `reasoning.summary: 'auto' | 'concise'
  | 'detailed'` on the request.
- `content: Array<{text, type:'reasoning_text'}>` — the type permits
  this, but per the cookbook the raw chain is *not exposed*; only
  summaries are user-visible.
- `encrypted_content: string` — opaque blob, only meaningful as
  something to pass back to OpenAI on the next turn.

This is structurally thinner than what Anthropic gives via
`thinking` blocks (under extended thinking), which are the raw
extended-thinking tokens themselves. An honest framing for users:

| Provider | What you get when you "show reasoning" |
|----------|----------------------------------------|
| Anthropic | Raw extended-thinking text |
| OpenAI | Model's *summary of* its reasoning |

Both are useful — OpenAI's summary is short and digestible, often
better for end-user UIs; Anthropic's raw blocks are richer for
debugging an agent's decision-making — but they're not the same
artifact. Building a feature that "surfaces model reasoning"
provider-neutrally means flattening to the lower bar (summary) or
documenting the asymmetry.

The reason for the asymmetry, per the OpenAI cookbook, is safety:
they don't want raw chain-of-thought returned because it can leak
unfiltered intermediate content. This is policy, not a technical
limit — but it's a stable policy.

For application design: don't promise users "see what the model is
thinking" as if it were one feature. It's two features with the same
name. If your UI labels it identically across providers, label
honestly: "summary" for OpenAI, "thinking" or "chain of thought"
for Anthropic.

Related: [[chat-completions-cannot-expose-reasoning]] — Chat
Completions exposes nothing at all; Responses exposes summaries.

Source: OpenAI Node SDK v6.27.0, `responses.d.ts:4367` (Reasoning
Item shape) and `shared.d.ts:143` (Reasoning config); cookbook,
`examples/responses_api/reasoning_items.ipynb`, "How Reasoning
Models work" section.
