---
title: Right altitude — system prompts should be specific enough to steer, vague enough to adapt
created: 2026-05-12
source: ../sources/anthropic-effective-context-engineering.md
links:
  - principles-over-prohibitions
  - explain-why-not-just-what
  - state-out-of-prompt-into-harness
---

# Right altitude — system prompts should be specific enough to steer, vague enough to adapt

Anthropic frames system-prompt design as a "Goldilocks" problem
with two named failure modes:

1. **Too specific (brittle).** Engineers "hardcoding complex,
   brittle logic in their prompts to elicit exact agentic behavior.
   This approach creates fragility and increases maintenance
   complexity over time."

2. **Too vague.** Engineers provide "vague, high-level guidance
   that fails to give the LLM concrete signals for desired outputs
   or falsely assumes shared context."

The optimal level: "specific enough to guide behavior effectively,
yet flexible enough to provide the model with strong heuristics to
guide behavior."

The principle behind the principle: prompts that encode *every
edge case* don't generalize to the edge cases they missed, and prompts
that encode *no edge cases* don't give the model enough signal. The
goal is to find the level of abstraction at which the model can
*derive* edge-case behavior from the prompt — which is exactly
[[principles-over-prohibitions]]-style framing.

Concretely, for the Gauntlet persona, "right altitude" looks like:

- Too low: "When you see a `<button>` element, click it with the
  `click` tool, then take a screenshot, then read the result, then
  decide whether to report bug/uxlissue/typo/suggestion/accessibility..."
- Too high: "Test the application."
- Right altitude: "You are a user trying to accomplish the story.
  Use the tools a user has. Observe what happens. Report what you
  see. If something blocks you, that is the answer to the test —
  do not work around it."

Markers of overshooting low (too brittle):
- Lists of tool-call sequences
- Explicit enumeration of failure modes
- Long "if X then do Y" tables
- Instructions that the agent could derive from the role

Markers of overshooting high (too vague):
- The model invents wildly different runs for the same input
- The agent doesn't know what to report or how
- Asking for clarification on basics

Source: Anthropic, "Effective context engineering for AI agents."
