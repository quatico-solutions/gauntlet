---
title: "Push state out of the prompt and into the harness; long loops bury static reminders"
source: "../../reflection-checkpoints-spec.md"
created: 2026-05-12
links: [effort-parameter-is-the-real-depth-lever, prompt-cache-key-is-routing-not-lookup, reflection-trace-as-permission-slip]
---

# Push state out of the prompt and into the harness; long loops bury static reminders

A directive in the system prompt at turn 0 is, by turn 20, buried
under megabytes of tool-call/tool-result traffic and stops driving
behavior. This codebase's own `reflection-checkpoints-spec.md`
documents the failure: a `stuck-handling.md` system-prompt block was
present from the start of every run and *still* did not prevent the
agent from burning 23 tool calls before hitting the deadline grace
path.

The principle: instructions that need to fire *in proportion to the
agent's state* should be injected by the harness, not stated once at
prompt construction. The static prompt is for orientation that holds
across all moments of the run; mid-loop behavior needs mid-loop
intervention.

Gauntlet's reflection-checkpoint mechanism is a pattern other
agentic systems can borrow:

- Fire periodically (every N=10 assistant turns)
- Inject a literal trace of recent mutating tool calls
- Frame around a load-bearing reminder ("stories/fixtures/systems can
  be wrong") that gives the agent *permission* to conclude the
  target is broken rather than itself
- The reminder text is identical every firing; the *trace* does the
  escalation

Anthropic's own context-engineering guidance points in the same
direction: long-running agents benefit from "structured note-taking
… persistent external storage so it can track progress across tasks
and sessions without keeping everything in active context," and from
state files (JSON, progress.txt, git) over in-prompt rules. The
spec implements this principle for the specific case of "is the
agent making progress?"

Generalization: any time you're tempted to add another paragraph to
the system prompt to address a mid-loop failure mode, ask whether a
harness-side periodic injection is the right shape instead. Static
prompt reminders rot; harness injections fire when they should.

Source: docs/reflection-checkpoints-spec.md in this repo;
Anthropic, "Effective context engineering for AI agents."
