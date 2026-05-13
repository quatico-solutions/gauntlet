---
title: CDP-driven Chrome is the uncanny valley for tester-not-developer agents
created: 2026-05-12
source: (synthesis — Lirael@5062343a)
links:
  - tester-not-developer-pattern
  - bloated-tool-sets-cause-ambiguity
---

# CDP-driven Chrome is the uncanny valley for tester-not-developer agents

A human tester clicks, types, and looks; a developer opens DevTools
and writes JS. Most agent-scope advice presumes those activities are
clearly distinguishable. A Chrome DevTools Protocol (CDP) harness
collapses the distinction — the agent's interaction primitives *are*
DevTools primitives, and the gap between "find an element to click"
and "use the page's JS context to do something interesting" is one
tool call wide.

Concretely, the tasks that sit *inside* the valley:

1. **Find a selector for an element that has no obvious one.** This
   is debugging-flavored (read the DOM tree, write a query) but
   legitimate for a human tester using accessibility tools or
   right-click-inspect. The agent doing the same work should be
   acceptable.

2. **Wait for an element to appear because the page is slow.**
   Reading element-attached state or evaluating page readiness is
   slightly developer-flavored but a legitimate part of any web
   automation.

3. **Query a computed style or aria attribute to verify a visual
   claim.** Read-only, accessibility-flavored. Acceptable.

The tasks that sit *outside* the valley and are over the line:

1. **Submit a form by dispatching React's synthetic events bypassing
   the UI.** This is debugging the React internals to make the
   product do something the UI doesn't naturally afford.

2. **Set a cookie or localStorage value directly because the login
   flow is slow.** The agent is no longer measuring what a user
   experiences.

3. **Write a `MutationObserver` to wait for a thing the agent
   doesn't believe is there.** Investigating *why* the product
   behaves wrong — pure developer behavior.

The persona instruction "do not write custom JS" is correct in
spirit but underspecifies the valley. A useful framing for the
agent:

> Use the tools a human tester would use to perceive and interact:
> click, type, scroll, navigate, screenshot, read the visible DOM,
> read accessibility attributes. You may use the page's JS context
> *only* to perceive — to read a computed value or check a state.
> Never use it to act — never use it to submit, to click, to fill,
> to wait for things you'd otherwise need to give up on.

This is a positive frame (what the JS context is *for*) with a
narrow negative (what it isn't for) — the form
[[positive-framing-beats-negative-instructions]] recommends.

A subtle implication: the "find a selector" task is hard precisely
because the boundary between perceive and act sits inside it. The
right framing is "look at the page to find the selector, then click
it with the click tool" — not "evaluate a click on the selector you
found."

Source: Synthesis of Anthropic best practices,
[[tester-not-developer-pattern]], and the Gauntlet web adapter's
existing constraints.
