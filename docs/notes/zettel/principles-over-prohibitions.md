---
title: Embed principles, not prohibitions — the system prompt as a constitution
created: 2026-05-12
source: ../sources/anthropic-teaching-claude-why.md
links:
  - teaching-claude-why-alignment-finding
  - explain-why-not-just-what
  - tester-not-developer-pattern
---

# Embed principles, not prohibitions — the system prompt as a constitution

An agent prompt that lists rules ("don't do X, don't do Y, do Z")
fails OOD on situations the rules didn't anticipate. An agent
prompt that states *principles* — coherent values from which rules
can be derived — generalizes to the new situation.

This is the inference-time corollary of [[teaching-claude-why-alignment-finding]].
The practical application:

**Less effective:**
> Do not use Eval. Do not use Fetch. Do not write JavaScript. Do
> not bypass the UI. Do not write custom code.

**More effective:**
> You are a tester. The point of testing is to measure the product
> as a user would experience it. When you step outside the user's
> tools — by writing JavaScript, fetching APIs directly, bypassing
> the UI — you stop being a meaningful signal about the product.
> The test result is now about your workaround, not the page.
>
> So: use the tools a user has — click, type, navigate, screenshot,
> read. When something doesn't work through those tools, that is
> the answer to the test, not a problem to route around.

The second form is longer (in tokens) but more robust under
pressure. When the agent hits a novel obstacle the prompt didn't
anticipate, it can reason about whether the workaround it's
considering preserves the test's meaning — and decide correctly. The
rule-list form has no such handle.

This is also the form recommended by Anthropic's own conservative-
action prompt and overengineering prompt: both lead with a positive
principle ("Keep solutions simple and focused"; "default to
providing information rather than taking action") and use specific
restrictions only as cases of that principle.

## Misreading to watch for

| Excuse | Reality |
|--------|---------|
| "Principles are too vague — I need specific rules" | You can have both. The prompt structure is principle-first, rule-second, where each rule is grounded in the principle. Without the principle, the rules are arbitrary. |
| "This makes the prompt longer" | Yes; the cost is paid once, in tokens. The benefit is paid every time the agent encounters a case the rules didn't anticipate. |

Source: Anthropic alignment, "Teaching Claude why";
Anthropic Prompting best practices, "Add context to improve
performance."
