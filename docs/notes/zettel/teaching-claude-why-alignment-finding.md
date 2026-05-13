---
title: Training Claude on *rationales* generalizes better than training on demonstrations
created: 2026-05-12
source: ../sources/anthropic-teaching-claude-why.md
links:
  - explain-why-not-just-what
  - principles-over-prohibitions
---

# Training Claude on *rationales* generalizes better than training on demonstrations

Anthropic's alignment-science finding: "teaching the principles
underlying aligned behavior can be more effective than training on
demonstrations of aligned behavior alone."

The mechanism: Claude trained on documents *explaining* the
Constitution and fictional narratives about *principled AI behavior*
showed improved alignment on evaluations that were "extremely OOD
from all of our alignment evals." Demonstrations teach the
distribution; rationales teach the principle that generates the
distribution. The principle generalizes; the distribution doesn't.

This is a training-time result, but its corollary at *inference time*
is the same: a system prompt that explains *why* a behavior is
desired produces more robust adherence than a system prompt that
*demonstrates* the desired behavior or *prohibits* its opposite.
This is the load-bearing claim underneath
[[explain-why-not-just-what]] — that one is the practical pattern;
this is the empirical evidence it draws on.

For a system prompt that needs to hold a role boundary under
pressure (e.g., Gauntlet's tester-not-developer), the principle is:
say *why* the role exists, what would break if the agent stepped
outside it, *what the role is for*. The model with that explanation
will hold the line on edge cases the prompt didn't anticipate. The
model with only the rule will fail those edge cases silently.

The asymmetry between rules and reasons is sharpest when the agent
encounters a situation the prompt didn't predict. A rule-only prompt
fails OOD because the agent has no way to reason about whether the
rule applies. A reason-equipped prompt succeeds OOD because the
agent can apply the principle to the new case.

Source: "Teaching Claude why," Anthropic Alignment Science Blog,
2026 (https://alignment.anthropic.com/2026/teaching-claude-why/).
