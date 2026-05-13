---
title: Load-bearing salience vs. over-trigger — two real findings in tension
created: 2026-05-12
source: ../sources/anthropic-claude-4-best-practices.md
links:
  - late-claude-overtriggers-on-aggressive-prompts
  - positive-framing-beats-negative-instructions
  - test-don-t-rewrite
---

# Load-bearing salience vs. over-trigger — two real findings in tension

Two field observations both appear true, and they pull in opposite
directions.

**Finding A (Anthropic, official).** Claude 4.5/4.6 "are also more
responsive to the system prompt than previous models. If your prompts
were designed to reduce undertriggering on tools or skills, these
models may now overtrigger. The fix is to dial back any aggressive
language." Recommendation: replace "CRITICAL: You MUST use this tool
when..." with plain "Use this tool when..."

**Finding B (field, this codebase).** ALL-CAPS, terse imperatives,
awkward numbering can be load-bearing salience that "cleaner"
rewrites lose. Smoothing language that empirically works often loses
the force the user actually achieved. (See the auto-memory entry
`feedback_dont_smooth_prompt_edits_that_work.md`.)

These are not contradictory once you separate them:
- Finding A is about *unnecessary* aggression on a model that
  already complies — language calibrated to a weaker baseline.
- Finding B is about *necessary* aggression — salience markers that
  remain load-bearing on the new model too.

The fix is *empirical*: A/B test on the actual eval set. Replace
aggressive language with a positive-framed plain-imperative variant,
run the eval suite, compare outcomes. Keep whichever wins on the
target metric. Do not assume either generalisation is true for any
specific prompt; both are true *on average* and the variance is per
prompt.

A useful rule of thumb: aggressive language is more likely to be
load-bearing when it (1) targets a *specific* failure mode the
agent demonstrably falls into without it, and (2) gives the agent
*permission* to stop (e.g., "MUST STOP" when overreaching). It is
less likely to be load-bearing when it (1) is generic exhortation
("be thorough", "be careful") or (2) is one of many CAPS lines that
have collectively become wallpaper.

## How to apply

When auditing the Gauntlet persona tomorrow:
- For each ALL-CAPS / "MUST" / "DO NOT" line, identify the specific
  failure mode it prevents.
- If you can name a concrete failure mode, write a positive variant
  side-by-side.
- Run both variants on the same eval set if one exists.
- Keep the winner. If the smooth variant ties or wins, take it; if
  the aggressive variant wins, the salience was load-bearing —
  honor that.

Source: Anthropic best practices on dial-back; Matt's auto-memory on
load-bearing prompt salience.
