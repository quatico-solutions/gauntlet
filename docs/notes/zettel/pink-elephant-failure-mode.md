---
title: Negative instructions activate the forbidden schema — the Pink Elephant failure mode
created: 2026-05-12
source: ../sources/pink-elephant-negative-instructions.md
links:
  - positive-framing-beats-negative-instructions
  - explain-why-not-just-what
---

# Negative instructions activate the forbidden schema — the Pink Elephant failure mode

The phenomenon: instructing an LLM "do not do X" raises X's salience
in context. The attention mechanism weights the named concept; the
generation samples from a distribution that has more probability
mass on tokens related to X than it would have without the
instruction. The model is more likely to think about X — and so
more likely to do it — than if X were never mentioned.

Drawn from Ironic Process Theory (the "white bear problem"): trying
to suppress a specific thought makes it more likely to surface. The
mechanism in LLMs is plausibly *not* the human cognitive one — it's
attention reweighting — but the surface behavior matches.

Reported empirical pattern (community-anecdotal, not controlled):
"LLMs seem to produce worse output the more 'DO NOTs' are included
in the prompt." Concrete case: Claude Code creating duplicate files
(`file-fixed.py`, `file-correct.py`) despite explicit rules against
duplicates — until the rule was reframed positively ("Make all
possible updates in current files whenever possible") and the
behavior disappeared.

The recommended transformation is to find the positive imperative
the negative is trying to express, and lead with it:

| Negative | Positive replacement |
|----------|----------------------|
| "Don't use mock data" | "Only use real-world data" |
| "Avoid creating new files" | "Apply all fixes to existing files" |
| "Do not debug or diagnose" | "Stay in the tester role: observe what the page does and report it" |

The replacement is not a thesaurus swap. The positive form names
the *behavior to occupy the same attention slot* the negative was
pointing at. The transformation fails when the rewrite says "be
nice" or "be careful" — generic positive imperatives that do not
specify a behavior. The replacement must be concrete.

## Misreading to watch for

| Excuse | Reality |
|--------|---------|
| "Then I should remove every 'don't' from the prompt" | No — hard constraints (legal, safety) sometimes need a "never." The principle is about *behavioral steering*, not refusal training. |
| "Adding 'don't' makes the model do the thing more" | Weaker than that. It raises the probability; it doesn't reliably flip the behavior. The empirical effect is a tilt, not a guarantee. |

Source: "The Pink Elephant Problem: Why 'Don't Do That' Fails with
LLMs" (https://eval.16x.engineer/blog/the-pink-elephant-negative-instructions-llms-effectiveness-analysis);
Anthropic Prompting best practices ("Tell Claude what to do instead
of what not to do").
