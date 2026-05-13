---
title: Positive framing beats negative instructions for LLM agents
created: 2026-05-12
source: ../sources/anthropic-claude-4-best-practices.md
links:
  - explain-why-not-just-what
  - late-claude-overtriggers-on-aggressive-prompts
  - pink-elephant-failure-mode
  - tester-not-developer-pattern
---

# Positive framing beats negative instructions for LLM agents

Telling Claude "do X" reliably outperforms telling Claude "don't do
Y." Anthropic's official guidance — "Tell Claude what to do instead
of what not to do" — is repeated across the formatting, verbosity,
and migration sections of the best-practices doc. The cleanest
canonical line: *"Positive examples showing how Claude can
communicate with the appropriate level of concision tend to be more
effective than negative examples or instructions that tell the model
what not to do."*

The mechanism is the [[pink-elephant-failure-mode]]: attention to a
forbidden concept keeps it active in context. A "DO NOT debug" line
inserts the *debug* schema into the conversation; a "stay in the
tester role and report what you observe" line inserts the *observe*
schema. The downstream completions sample from whichever schema is
more available.

This does not mean negative instructions are forbidden — Anthropic's
own canonical overengineering prompt is a list of "Don't…" items.
Negative instructions are tolerable when (1) they are hard
constraints not preferences, (2) they are paired with a positive
imperative ("Keep solutions simple and focused: Don't add features…")
and (3) the bulk of the prompt sets up positive expectations the
negatives clarify.

The transformation table from the community Pink Elephant analysis
gives the form:

| Negative | Positive replacement |
|----------|----------------------|
| "Don't use mock data" | "Only use real-world data" |
| "Avoid creating new files" | "Apply all fixes to existing files" |
| "Do not debug" | "Observe and report — report what happens, don't fix it" |

## Misreading to watch for

| Excuse | Reality |
|--------|---------|
| "Negative instructions never work" | They work for hard limits and adversarial uses (refusal training). They underperform for behavioral steering of cooperative agents. |
| "I'll just replace 'DO NOT X' with 'don't X'" | The form change without a positive imperative is shallow. The replacement should name the *positive* behavior to occupy the same attention slot. |

Source: Anthropic Prompting best practices for Claude 4.x, "Control
the format of responses" and verbosity sections; "The Pink Elephant
Problem" (https://eval.16x.engineer/blog/the-pink-elephant-negative-instructions-llms-effectiveness-analysis).
