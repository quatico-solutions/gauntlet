---
title: The `effort` parameter is the real depth lever; prompts are not
created: 2026-05-12
source: ../sources/anthropic-claude-4-best-practices.md
links:
  - late-claude-overtriggers-on-aggressive-prompts
  - sonnet-46-defaults-to-high-effort
---

# The `effort` parameter is the real depth lever; prompts are not

Sonnet 4.6 (and Opus 4.6/4.7) use adaptive thinking calibrated by an
`effort` parameter — `low | medium | high | xhigh | max`. Higher
effort elicits more reasoning. The Anthropic guidance is clear: when
you observe over-investigation or under-investigation, the *first*
lever is `effort`, not the prompt.

> "If you observe shallow reasoning on complex problems, raise effort
> to `high` or `xhigh` rather than prompting around it."
> "In some cases, Claude Opus 4.6 may think extensively… If this
> behavior is undesirable, you can add explicit instructions to
> constrain its reasoning, or you can lower the `effort` setting."

The order is intentional: lower the budget first; then, if still
needed, prompt to constrain reasoning.

For Sonnet 4.6 specifically, the default `effort` is `high`. If the
calling code does not set it explicitly, latency *and* tendency to
rabbit-hole are both inflated for no benefit. The Anthropic
recommendation:
- `medium` for most applications
- `low` for high-volume or latency-sensitive workloads
- `high` only when reasoning depth materially improves quality

In a "fast tester" use case like Gauntlet — observe-and-report,
short tasks, many parallel runs — `medium` or `low` is almost
certainly the right starting point, and a `medium` Sonnet 4.6 at
this effort is reported "similar or better than" Sonnet 4.5 with no
extended thinking.

This is a config knob, not a prompt-engineering insight per se, but
it is the *most direct* lever on distraction-vs-focus and is often
overlooked when the conversation is framed as "improve the prompt."

Source: Anthropic Prompting best practices, "Calibrating effort and
thinking depth", "Migrating from Claude Sonnet 4.5 to Claude Sonnet
4.6".
