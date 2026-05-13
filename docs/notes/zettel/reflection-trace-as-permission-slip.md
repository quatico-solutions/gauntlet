---
title: Reflection checkpoints work because they give the agent permission to conclude target is broken
created: 2026-05-12
source: ../../reflection-checkpoints-spec.md
links:
  - state-out-of-prompt-into-harness
  - tester-not-developer-pattern
---

# Reflection checkpoints work because they give the agent permission to conclude target is broken

The reflection-checkpoint mechanism in this repo's
`docs/reflection-checkpoints-spec.md` has two parts. The *trace* is
the substrate — a literal flat list of recent mutating tool calls.
The *frame* around it is the load-bearing piece: "stories, criteria,
and fixtures can be wrong."

The framing is a *permission slip*. Without it, an agent that
notices "I have tried six variations of this click and none worked"
defaults to "I must have done it wrong" — and tries a seventh
variation. With the permission slip, the same observation maps to
"the target may be broken; that is a legitimate conclusion to draw
and report." The agent is allowed to stop being a debugger and
become a reporter again.

This is closely related to [[tester-not-developer-pattern]]: the
tester role *includes* the action "conclude this is broken." The
developer role does not — a developer who can't make a thing work
keeps trying. When the agent rabbit-holes, what's happening is a
role drift toward developer. The permission slip is the explicit
re-grant of tester authority.

The reason a static system-prompt directive does not do this work:
by turn 20 it's buried under tool-call traffic and stops driving
behavior. The reflection injection fires *at the moment of role
drift*, when the trace shows the variations stacking up — the model
reading its own log is more persuasive than any abstract directive.

Generalization for any agent that should occasionally conclude
"this can't be done" rather than persist indefinitely:

1. Don't only state the permission in the system prompt — inject
   it mid-loop, with a fresh substrate (the trace).
2. Make the substrate concrete and literal. Renders of *what the
   agent has actually done* are more persuasive than abstractions.
3. Frame the permission as a question the agent answers, not a
   directive it follows. "Have you been making progress? Could
   this be broken?" not "Stop after 8 retries."
4. Be willing to fire on cadence alone, not on a smart signal. The
   skill of "is the agent making progress?" is the agent's, not
   the harness's; the harness's job is to ask, periodically.

Source: docs/reflection-checkpoints-spec.md in this repo
(Granny@ff86836c, 2026-05-12).
