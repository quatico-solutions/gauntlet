---
title: "Sonnet 4.6 selects tools by what their descriptions say — descriptions are load-bearing"
source: "../sources/resolve-ai-sonnet-46-impressions.md"
created: 2026-05-12
links: [bloated-tool-sets-cause-ambiguity, sonnet-46-is-more-proactive-than-45, stable-prefix-is-the-caching-strategy, tester-not-developer-pattern]
---

# Sonnet 4.6 selects tools by what their descriptions say — descriptions are load-bearing

The Resolve.ai production observation: "The 4.6 models select tools
based on what they *say* they do, not just surrounding context."
This is a shift from earlier generations, where surrounding prompt
context could compensate for vague tool docstrings.

The practical implication: tool descriptions are now part of the
prompt-engineering surface, not a documentation afterthought. A
generic-looking `eval(code)` tool will be reached for whenever the
agent's model of the situation suggests "I need to run code,"
*regardless of how loudly the system prompt says "DO NOT use eval."*
The description is what tells the model when the tool is for; the
prompt fights an uphill battle against a tool whose description
implies broad applicability.

This combines with [[bloated-tool-sets-cause-ambiguity]] — Anthropic's
finding that overlapping tools force ambiguity that produces wrong
choices. The two-part remediation for Gauntlet:

1. **Make tool descriptions name their scope and their out-of-scope
   neighbours.** Not just "Evaluate JavaScript in the page context"
   but "Evaluate JavaScript in the page context. Use only when the
   page genuinely cannot be exercised through user-interaction tools
   (click, type, navigate, screenshot). For example, querying a
   computed CSS variable for assertion. Do not use to submit forms,
   simulate clicks, or bypass UI flows."

2. **Trim or rename tools whose name itself invites the wrong use.**
   A tool called `eval` named for the underlying capability invites
   "eval anything." A tool called `read_computed_style` named for
   its intended use does not.

For the Gauntlet web adapter specifically, the existing persona
calls out "Eval and Fetch" by name. That works *if* the model
recognizes those tools by name; the model is more likely to
recognize them by description, so the description needs to do the
same work.

Source: Resolve.ai, "Testing Claude Sonnet 4.6 Adaptive Thinking on
Production AI Agents."
