---
title: Test prompt edits empirically — don't trust the rewrite without an eval
created: 2026-05-12
source: (synthesis — Lirael@5062343a)
links:
  - load-bearing-salience-vs-overtrigger-tension
  - late-claude-overtriggers-on-aggressive-prompts
---

# Test prompt edits empirically — don't trust the rewrite without an eval

Prompt-engineering recommendations — including the ones in these
notes — are *priors*, not laws. The same change ("dial back
aggressive language", "switch to positive framing", "add reasoning")
will help some prompts and hurt others. The only reliable test is
running both variants on the actual eval set.

For Gauntlet specifically, the existing persona has many
candidates-for-rewriting that could plausibly help or hurt:

- ALL-CAPS "DO NOT TRY TO DEBUG OR DIAGNOSE ISSUES" — the
  Anthropic prior says dial back aggression; field experience says
  ALL-CAPS can be load-bearing salience. Unknowable without testing.
- "Path of insanity" framing — gives permission to stop; rewriting
  to plain "don't keep trying the same thing" may lose the
  emotional force.
- "MUST STOP" after Eval/Fetch — aggressive imperative; may or may
  not be load-bearing.

The eval-set design:

1. Pick a small set of stories where the old persona fails (rabbit
   holes, debugging behavior, etc.).
2. Pick a small set where the old persona succeeds.
3. Run both with the candidate variant. Compare success rate,
   tool-call count, time.
4. Keep the winner. If it's a tie, prefer the variant that's easier
   to maintain.

The session tomorrow likely won't have time to do a full A/B run
per change, but it should at least be set up to do so post-session
on the high-confidence candidate changes.

Adjacent failure mode to watch for: making 5 changes in one revision
and not being able to tell which one helped or hurt. Sequential
single-change edits are slower but produce attributable signal.

Source: Synthesis of the Anthropic-vs-field tension named in
[[load-bearing-salience-vs-overtrigger-tension]], plus standard
prompt-eval discipline.
