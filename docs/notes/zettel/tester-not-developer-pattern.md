---
title: Tester-not-developer role — structural inversion of the usual scope-creep pattern
created: 2026-05-12
source: ../sources/anthropic-claude-4-best-practices.md
links:
  - explain-why-not-just-what
  - positive-framing-beats-negative-instructions
  - sonnet-46-situational-awareness
  - cdp-debugging-is-the-uncanny-valley
---

# Tester-not-developer role — structural inversion of the usual scope-creep pattern

Most agent-scope advice addresses an agent that *has* developer
authority and is told to occasionally restrain itself. Anthropic's
guidance (overengineering prompt, conservative-action prompt) is
written for this case: an agent that defaults to acting and must be
told to *not* act unless asked.

Gauntlet inverts the structure. The Gauntlet agent does not have
developer authority — it has *user* authority. Its tools are the
ones a human user would have: navigate, click, type, screenshot,
read. The persona says "you are a tester, not a developer." The
failure mode is not over-eagerness in the usual sense (refactoring
code, adding features); it is over-eagerness in a *user-impersonating*
context — opening DevTools, writing JS, fetching APIs directly,
treating the UI as an obstacle to bypass.

This means the standard official prompt patterns ("don't make
changes unless asked") don't quite fit. The right pattern is closer
to a *role-fidelity* pattern: stay a user-shaped entity. The
persuasive frame is not "do less" but "be a particular kind of
thing."

Useful pattern elements:

1. **Name the role and its constraints together.** "You are a human
   tester. A human tester clicks, types, and looks. A human tester
   does not open DevTools, run JS, or call APIs." This is positive
   framing (what the role *does*) plus its negative space (what the
   role doesn't do) presented as identity rather than rule.

2. **Make the *why* the user's perspective.** The reason to stay a
   user is that the goal is measuring product as a user would
   experience it. When the agent bypasses the UI, it stops being a
   meaningful signal about the product — the test result is now
   about the JS, not the page. The model can hold this principle
   under pressure better than a bare prohibition.

3. **Recognize the uncanny-valley problem.** CDP-driven Chrome blurs
   the user/developer line. A tester might legitimately use DevTools
   to find a selector that the agent needs to click. See
   [[cdp-debugging-is-the-uncanny-valley]] for that boundary.

This pattern is downstream of [[positive-framing-beats-negative-instructions]]
and [[explain-why-not-just-what]] but the inversion is its own
distinct observation worth tracking.

Source: General application of Anthropic best practices to the
inverted-scope case.
