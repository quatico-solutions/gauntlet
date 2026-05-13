---
title: Sonnet 4.6 is more proactive than 4.5 — same prompt produces deeper investigation
created: 2026-05-12
source: ../sources/resolve-ai-sonnet-46-impressions.md
links:
  - late-claude-overtriggers-on-aggressive-prompts
  - effort-parameter-is-the-real-depth-lever
  - tool-descriptions-load-bearing-on-46
  - sonnet-46-defaults-to-high-effort
---

# Sonnet 4.6 is more proactive than 4.5 — same prompt produces deeper investigation

In production agent settings, the same prompt run on Sonnet 4.6 vs.
4.5 produces measurably deeper investigation: roughly "3–4 more tool
calls on average per investigation" without thinking, and "~5
additional tool calls on average" with high thinking. The model is
~20% slower without thinking and ~40% slower with high thinking. The
*intelligence* gain is real (~10% absolute with thinking off, ~20%
with high thinking) — but the latency and breadth-of-investigation
cost is also real.

For a use case that should observe-and-report quickly (Gauntlet on
short stories), this is a regression: more tool calls, more time,
without those extra calls being asked for.

The model is "more proactive, so tune your prompts accordingly." The
*previously effective* anti-rabbit-hole prompts ("be thorough,"
"think carefully") now make the situation *worse* on 4.6 — they
amplify the model's already-proactive behavior and cause overthinking
loops.

The two recommended levers, in order:
1. Set `effort` explicitly (lower for less depth).
2. Write more precise tool descriptions — "the 4.6 models select
   tools based on what they say they do, not just surrounding
   context" (see [[tool-descriptions-load-bearing-on-46]]).

Prompt-language workarounds are the *third* lever, not the first.

The Gauraw case study supplies a separate observation about Sonnet
4.6 reliability in autonomous loops: ~80% instruction compliance with
"the agent would follow 80% of my instructions, skip the other 20%,
and act like everything was fine." The depth-of-investigation
increase and the silent-instruction-drop are likely two faces of the
same underlying shift toward heavier model agency.

Source: Resolve.ai, "Testing Claude Sonnet 4.6 Adaptive Thinking on
Production AI Agents"; Gauraw, "I swapped my AI agent's brain..."
