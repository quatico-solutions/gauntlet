---
title: Bloated or overlapping tool sets force the agent into ambiguous decisions
created: 2026-05-12
source: ../sources/anthropic-effective-context-engineering.md
links:
  - tool-descriptions-load-bearing-on-46
  - tester-not-developer-pattern
---

# Bloated or overlapping tool sets force the agent into ambiguous decisions

From Anthropic's context-engineering guidance: "One of the most
common failure modes we see is bloated tool sets that cover too
much functionality or lead to ambiguous decision points about which
tool to use."

The diagnostic question, stated directly: "If a human engineer
can't definitively say which tool should be used in a given
situation, an AI agent can't be expected to do better."

The implication for Gauntlet (and any agent-design): tool *curation*
is part of prompt engineering. The system prompt cannot reliably
patch over a tool set where it isn't clear, from descriptions
alone, which tool fits a given moment. The agent is doing a
classification problem; if the classes overlap, it picks wrong.

Specific patterns to watch for:

1. **Two tools that do similar things.** If `click_element` and
   `evaluate_javascript_to_click` both exist and both work, the
   agent will sometimes choose the wrong one. The fix is either
   to remove one or to make their descriptions sharply
   distinguishing.

2. **A general tool that *can* do specific things.** An `eval` or
   `execute_code` tool always overlaps with every more-specific
   tool. The general tool ends up being a "catch-all" that swallows
   what should have been more specific interactions.

3. **A tool whose name implies broader scope than its description
   restricts.** The name `evaluate` invites general-purpose use;
   restricting it via description has to fight against the model's
   prior for what `evaluate` means in JS contexts.

For Gauntlet's web adapter, the persona's "Eval and Fetch" callout
is doing exactly the right work in spirit — but it is fighting from
the *prompt* side, when the structural fix is on the tool-set side:
either remove these tools, narrow their descriptions, or rename
them to imply their narrow valid use.

Source: Anthropic, "Effective context engineering for AI agents."
