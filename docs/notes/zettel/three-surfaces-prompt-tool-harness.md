---
title: "Agent behavior has three surfaces — prompt, tool, harness; each is the right lever for different problems"
source: "(synthesis — Lirael@5062343a)"
created: 2026-05-12
links: [bloated-tool-sets-cause-ambiguity, effort-parameter-is-the-real-depth-lever, stable-prefix-is-the-caching-strategy, state-out-of-prompt-into-harness, tool-descriptions-load-bearing-on-46]
---

# Agent behavior has three surfaces — prompt, tool, harness; each is the right lever for different problems

When you want to change agent behavior, you have three places to
push: the system prompt, the tool definitions, and the harness
(everything outside the model call — pre/post-processing, mid-loop
injection, retry logic, config). They are not interchangeable, and
the right lever depends on the failure shape.

**Prompt** is the right lever for:
- The agent's *role* (who it is, what it's for)
- Principles the agent should reason from (the *why*)
- Standing rules that apply turn 0 → turn N at low cost
- Output format requirements

**Tool definitions** are the right lever for:
- Which actions exist and which don't
- What each action does and doesn't fit (descriptions are
  load-bearing — see [[tool-descriptions-load-bearing-on-46]])
- The agent's space of moves (a tool that doesn't exist can't be
  called; a tool whose description is narrow won't be called for
  out-of-scope use)

**Harness** is the right lever for:
- Mid-loop reminders that need fresh context (see
  [[reflection-trace-as-permission-slip]])
- State the prompt can't track reliably
- Hard limits (max-turns, max-cost, deadline grace)
- Config the model doesn't see (`effort`, `max_tokens`)
- Termination logic

The diagnostic: when you see undesired behavior, ask "which surface
is being defeated?" before reaching for the prompt.

- "Agent uses Eval when it shouldn't" → can be defeated by prompt
  ("don't use Eval") but more reliably defeated by tool surface
  (narrow Eval's description, rename it, or remove it).
- "Agent rabbit-holes after N retries" → unfixable from the prompt
  alone (the directive gets buried); the harness should inject a
  permission slip at cadence.
- "Agent investigates too deeply on every run" → prompt can help,
  but `effort: low/medium` on the harness side is the dominant
  lever.
- "Agent doesn't understand its role" → pure prompt question.

The Gauntlet codebase already exemplifies this thinking: the
reflection-checkpoint mechanism is a harness lever (mid-loop
injection); the persona is a prompt lever; the tool inventory
(click, type, etc.) is the third surface. The session tomorrow
should be careful not to push everything onto the prompt surface
when the right answer for a given failure is one of the others.

Source: Synthesis of Anthropic best practices, this repo's
reflection-checkpoints-spec, and field experience.
