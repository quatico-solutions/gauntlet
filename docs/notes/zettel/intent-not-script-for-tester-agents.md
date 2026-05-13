---
title: Tester agents take intent, not scripts — describe what to verify, not how
created: 2026-05-12
source: ../sources/alexop-claude-qa-tester.md
links:
  - tester-not-developer-pattern
  - specificity-reduces-tool-calls
---

# Tester agents take intent, not scripts — describe what to verify, not how

The point of an LLM in a testing loop is that you don't write
"click #submit-button". You write the intended outcome with
conditions, and the agent routes to it. As one practitioner puts
it: "You don't write test scripts that break when you change a
button's text. Quinn understands intent and adapts."

This is the same principle Gauntlet's tutorial already names: "The
trap to avoid. Gauntlet stories describe outcomes with conditions.
Not click sequences. Not selectors. The whole point of an LLM in
the loop is that you don't write `click #submit-button` — the agent
figures out the path."

The intent framing has two desirable properties for keeping the
agent from rabbit-holing:

1. **Intent gives the agent an obvious stop condition.** The story
   is satisfied when its outcome is observed. Without an explicit
   outcome, the agent has no termination criterion and will keep
   exploring.

2. **Intent lets the agent treat obstacles as data.** A scripted
   test that fails to find a selector enters an "I have to find
   this selector" loop. An intent-driven test that fails to find
   the path enters a "the path I'd expect doesn't exist; that's
   a fact about the product" state — which is the answer to the
   test.

For Gauntlet's persona work tomorrow, this principle backs up the
existing `evaluation.md` shape (pass / fail / investigate with
observations). The persona should remind the agent that it has
*three* verdicts — pass, fail, investigate — and that "I couldn't
find the obvious path" is a perfectly good `investigate` outcome,
not a personal failure to route around.

A related observation from the practitioner: limiting Claude to
browser-only tools (no filesystem, no source-code reading) prevents
"cheating" by reading the implementation and aligns the test with
authentic user-shaped behavior. Gauntlet already does this; the
persona could reinforce it with positive framing — *because* you
only have the user's tools, your test is a real measurement.

Source: alexop.dev, "Building an AI QA Engineer with Claude Code
and Playwright MCP"; this repo's `docs/tutorial.md` ("The trap to
avoid").
