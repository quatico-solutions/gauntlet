---
title: Give the agent explicit permission to stop — premature termination is rarer than runaway
created: 2026-05-12
source: ../sources/multi-agent-failure-modes.md
links:
  - reflection-trace-as-permission-slip
  - tester-not-developer-pattern
  - intent-not-script-for-tester-agents
---

# Give the agent explicit permission to stop — premature termination is rarer than runaway

LLM-agent termination is poorly handled at the prompt level. The
multi-agent failure literature finds that absent explicit
permission and criteria, agents either retry indefinitely (the more
common case for capable models on hard tasks) or terminate
prematurely (~6.2% of failures in one survey). The cost-asymmetric
of the two is real: a runaway can burn tens of dollars before
termination, while a premature stop typically costs one re-run.

For a tester agent, the desired behavior is closer to "stop when
the question is answered." That includes:

1. **Stop when the outcome is observed.** Pass: condition holds.
   Fail: condition demonstrably doesn't hold.
2. **Stop when the path is gone.** "I expected the obvious path
   to be there. It isn't. I can't get to the next step. That is
   the answer." This is the `investigate` verdict in
   `evaluation.md`.
3. **Stop when the harness intervenes.** Reflection checkpoints
   (this repo) and max-turn caps (most agent harnesses) fire when
   the model can't.

The system prompt's job for (1) and (2) is to *grant explicit
permission* that the stop is legitimate. Without that permission,
the model defaults to "I should try one more variation, the
problem must be me." With it, the model knows that reporting
a stuck-state is a successful outcome.

Suggested prompt fragment that does this work positively:

> When you can't complete the story, that's not a failure of your
> work — it's the answer to the test. Report what you observed,
> what you tried, and what blocked you. The verdict can be `pass`,
> `fail`, or `investigate`. `investigate` is the right answer when
> something seems off but you can't confirm; it is not a
> placeholder for trying harder.

This is positive framing of the existing `evaluation.md` content,
restated in the persona where the agent's behavior is shaped. It
gives the same permission the reflection checkpoint gives, but at
turn 0 instead of turn 10.

Source: Multi-agent failure mode analysis (arxiv 2503.13657);
synthesis with this repo's `evaluation.md` and
`reflection-checkpoints-spec.md`.
