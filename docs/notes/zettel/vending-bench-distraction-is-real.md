---
title: Vending-Bench shows long-horizon distraction is real and measurable in current models
created: 2026-05-12
source: ../sources/vending-bench-paper.md
links:
  - sonnet-46-is-more-proactive-than-45
  - state-out-of-prompt-into-harness
---

# Vending-Bench shows long-horizon distraction is real and measurable in current models

Vending-Bench (Andon Labs, 2025) is the public benchmark for
long-horizon coherence in agents. It places an LLM-based agent in
the role of a vending-machine operator over runs that consume tens
of millions of tokens. Tasks are individually simple (balance
inventory, place orders, set prices, pay fees) but the long
horizon stresses coherent goal-tracking.

The empirical finding: even strong models — Claude 3.5 Sonnet and
o3-mini named — manage the task in *most* runs but have runs that
"derail, either through misinterpreting delivery schedules,
forgetting orders, or descending into tangential 'meltdown' loops
from which they rarely recover."

The interpretive point most relevant to Gauntlet: "There is no
clear correlation between failures and the point at which the
model's context window becomes full, suggesting that these
breakdowns do not stem from memory limits."

If distraction isn't a memory-budget problem, the fix isn't more
context. The fixes that show up in research and practice instead:

1. **External state that the agent updates** — JSON files, progress
   notes, git history. The agent's situation lives outside the
   prompt and is re-derived per turn.

2. **Periodic re-orientation** — like this repo's reflection
   checkpoints. The model gets shown its own actions and asked
   to evaluate them.

3. **Termination criteria the harness can enforce** — max-turn
   caps, deadline grace turns. The model isn't trusted to
   self-terminate; the harness does it.

Gauntlet's tasks are nowhere near 20M tokens — most stories
complete in tens of turns — so the failure mode isn't full-blown
"meltdown loop." It's the tens-of-turns version of the same
phenomenon: the agent loses the thread, starts repeating variants,
and doesn't realize it. The architectural answers (external state,
re-orientation, harness termination) apply at this scale too.

Anthropic's Vending-Bench 2 results explicitly compare Opus 4.5 vs
4.6 and note that 4.6 maintains focus over time enough to earn
$3,050.53 more — distraction reduction is measurable and Anthropic
is engineering against it. The implication: Opus 4.6/4.7 are
*better* at this than Sonnet, which is consistent with Matt's
observation that Sonnet specifically (vs. Opus) needs more
restraint help.

Source: Vending-Bench paper, arxiv 2502.15840; Anthropic, Opus 4.6
release notes.
