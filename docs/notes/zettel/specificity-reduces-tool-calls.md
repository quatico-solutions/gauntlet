---
title: Specific mission framing reduces tool-call sprawl
created: 2026-05-12
source: (synthesis — Anthropic + Cursor)
links:
  - right-altitude-for-instructions
  - sonnet-46-is-more-proactive-than-45
---

# Specific mission framing reduces tool-call sprawl

Vague requests cause Claude to "cast a wider net" — more tool calls,
more file reads, more searches. The same task framed specifically
triggers fewer tools. Anthropic's example: "Find the March 2026
budget spreadsheet in my Drive and summarize the Q1 totals" produces
fewer tool calls than "Look through my Drive and tell me about my
finances."

Cursor's adjacent observation: "The agent's success rate improves
significantly with specific instructions." The contrast: "add tests
for auth.ts" vs. "Write a test case for auth.ts covering the logout
edge case, using the patterns in `__tests__/` and avoiding mocks."

For Gauntlet, the story card is the per-run mission. Vague stories
("test the dashboard") will produce wandering investigations on
Sonnet 4.6; specific stories ("Log in as Alice and confirm the
dashboard greets her by name, with the welcome panel visible
above the fold") produce constrained ones.

This is *not* an argument for click-by-click scripts — the whole
point of an LLM tester is that you write outcomes-with-conditions
and let the agent route. But it is an argument that *vagueness in
the story* compounds with *Sonnet 4.6's proactivity* to produce the
"too many tool calls" pattern.

A useful diagnostic before blaming the persona prompt: re-read the
story card. If it would be ambiguous to a human tester ("test what?
verify what?"), Sonnet 4.6 will fill the ambiguity with extra
investigation. The persona fights uphill against a story that left
the mission space too open.

For tomorrow's prompt session: the story-card examples in the
tutorial are a relevant input. If stories are tight, the persona
needs less restraint language. If stories are loose, the persona
has to do more work — or the stories need tightening.

Source: Anthropic Prompting best practices, Tool use section ("Be
specific in your prompts"); Cursor, "Best practices for coding with
agents."
