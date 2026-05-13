---
title: Late-generation Claude over-triggers on aggressive prompt language
created: 2026-05-12
source: ../sources/anthropic-claude-4-best-practices.md
links:
  - positive-framing-beats-negative-instructions
  - explain-why-not-just-what
  - load-bearing-salience-vs-overtrigger-tension
  - effort-parameter-is-the-real-depth-lever
---

# Late-generation Claude over-triggers on aggressive prompt language

Claude 4.5/4.6 are more responsive to the system prompt than older
models. Aggressive directives that were necessary to *unstick* prior
generations — "CRITICAL: You MUST use this tool when..." — now cause
the opposite problem on 4.6: overtriggering. The fix is to dial the
language back to plain imperatives ("Use this tool when...") and let
the model's improved baseline instruction-following do the work.

This generalizes beyond "MUST use" into all anti-laziness style
prompting: phrases like "be thorough," "investigate fully," "use
tools aggressively," "go above and beyond" were workarounds for an
under-active model. On 4.6 they amplify already-proactive behavior
and produce overthinking loops, over-investigation, and overengineered
solutions. The same instruction-form that *enabled* useful behavior
on 4.5 *disables* good restraint on 4.6.

The asymmetry matters specifically for prompts that were tuned on an
earlier model and are now being run on 4.6 — i.e., most production
prompts. They were calibrated against the old model's
under-responsiveness; on 4.6 they are now miscalibrated in the other
direction.

This generalizes to *anti*-debugging or *anti*-overreach prompts too,
not only anti-laziness ones. The mechanism is the same — strong
prompt language gets weighted heavily — so a heavy-handed "DO NOT
DEBUG" may push the model to refuse to investigate anything,
including the page navigation it legitimately needs to do.

## Misreading to watch for

| Excuse | Reality |
|--------|---------|
| "Then I should rewrite all my aggressive prompts" | No — the user's own field experience contradicts the blanket version: ALL-CAPS and terse imperatives can be load-bearing salience that polite rewrites lose. The right move is A/B test, not blanket rewrite. See [[load-bearing-salience-vs-overtrigger-tension]]. |
| "Aggressive language is always bad now" | The Anthropic doc's own *overengineering* sample prompt is a list of "Don't…" lines. They are tolerable for hard constraints, especially when paired with positive framing. Aggression is not the issue; the issue is *unjustified* aggression on a model that already complies. |

Source: Anthropic Prompting best practices for Claude 4.x, section
"Tool usage" and "Migration considerations / Tune anti-laziness
prompting" (https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-4-best-practices).
