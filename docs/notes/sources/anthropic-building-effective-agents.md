---
title: "Anthropic — Building effective agents"
source_url: https://www.anthropic.com/engineering/building-effective-agents
fetched: 2026-05-12
reader: Lirael@5062343a
---

# Anthropic — Building effective agents

## A. Classification

Practical engineering blog from Anthropic. Foundational document on
agent design principles. Predates the prompting-best-practices doc
but its design principles still hold.

## B. Unity

Effective agents are built with simple, composable patterns, with
tool interfaces designed for the model the way human interfaces are
designed for humans — the agent-computer interface (ACI) is the
primary correctness surface.

## F. Main propositions

1. **Simplicity.** Maintain it in design; complexity is a tax that
   the agent pays at every turn.
2. **Transparency.** Show the agent's planning steps explicitly —
   the same accountability surface that makes the agent debuggable
   for humans also constrains the agent itself.
3. **ACI investment.** "Carefully craft your agent-computer
   interface (ACI) through thorough tool documentation and
   testing." The interface is as important as the model.
4. **Poka-yoke (mistake-proofing).** Structure arguments so that
   wrong use is hard. The SWE-bench coding-agent example: requiring
   absolute paths prevented a class of failure that prompt patches
   couldn't reliably prevent.
5. **Tool docs as behavioral spec.** Include "example usage, edge
   cases, input format requirements, and clear boundaries from
   other tools." Tool descriptions are doing prompt-engineering
   work.

## G. Critique

**Where it is incomplete.** Doesn't deeply address the "agent that
should not have developer authority" inverse case. Most ACI advice
assumes you're building tools the agent will use; the Gauntlet
question is partly which tools to *not* expose, which the doc
addresses only by implication.

## H. What of it?

For Gauntlet, this is the warrant behind the
[[three-surfaces-prompt-tool-harness]] framing — the tool surface
is co-equal with the prompt surface in determining agent behavior,
and the poka-yoke principle (make wrong moves structurally hard) is
strongly applicable to the Eval / Fetch / custom-JS class of
failures.

## Permanent notes extracted

- `zettel/poka-yoke-tool-design.md`
- Reinforces [[three-surfaces-prompt-tool-harness]]
- Reinforces [[bloated-tool-sets-cause-ambiguity]]
