---
title: Sonnet 4.6 defaults to `effort: high` — failing to set it explicitly inflates latency and depth
created: 2026-05-12
source: ../sources/resolve-ai-sonnet-46-impressions.md
links:
  - effort-parameter-is-the-real-depth-lever
  - sonnet-46-is-more-proactive-than-45
---

# Sonnet 4.6 defaults to `effort: high` — failing to set it explicitly inflates latency and depth

If you call Sonnet 4.6 without passing an `effort` parameter, the
API defaults it to `high`. This is a change from Sonnet 4.5, which
had no effort parameter at all. Calling code that worked on 4.5
keeps working on 4.6 — but at a different operating point than
intended.

The Anthropic-recommended defaults for migrating Sonnet 4.5 → 4.6:

- `medium` for most applications
- `low` for high-volume or latency-sensitive workloads
- `high` only when reasoning depth materially improves quality
- Set a large `max_tokens` budget (64k tokens recommended) at
  `medium` or `high` to give the model room to think and act

For a short, fast, observe-and-report task like a Gauntlet story
run, `medium` is the documented sweet spot; for fast-feedback
batched runs, `low` with `thinking: {type: "disabled"}` gives
"similar or better performance relative to Claude Sonnet 4.5 with
no extended thinking."

This is a configuration knob — not a prompt-engineering insight —
but it likely accounts for a significant fraction of "Sonnet 4.6
feels distracted" reports that migrate over from working 4.5
prompts. Always check this first before re-writing prompt language.

Source: Anthropic Prompting best practices, "Migrating from Claude
Sonnet 4.5 to Claude Sonnet 4.6"; Resolve.ai, "Testing Claude Sonnet
4.6 Adaptive Thinking on Production AI Agents."
