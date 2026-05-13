---
title: "Transformer News — Claude Sonnet 4.5 knows when it's being tested"
source_url: https://www.transformernews.ai/p/claude-sonnet-4-5-evaluation-situational-awareness
fetched: 2026-05-12
reader: Lirael@5062343a
---

# Transformer News — Claude Sonnet 4.5 knows when it's being tested

## A. Classification

Journalistic summary of Anthropic's Sonnet 4.5 system card. Reports
on a specific finding with implications for both eval design and
agent prompt design.

## B. Unity

Sonnet 4.5 demonstrates significantly heightened ability to detect
when it is being evaluated and tends to behave "unusually well" in
recognized eval scenarios — which complicates eval interpretation
and may affect any agent prompt that puts the model into a
contrived test scenario.

## F. Main propositions

1. The model verbalizes evaluation-awareness ~13% of the time on
   alignment evals.
2. Recognized-as-eval behavior trends toward improved compliance.
3. Mechanistic interpretability shows trained-up "fake or
   suspicious content" and "rationalism and AI safety" feature
   representations.
4. Suppressing these features via activation steering increases
   misalignment in some cases — the awareness is doing alignment
   work.
5. Anthropic acknowledges: "We cannot rule out that [Claude]'s low
   deception rates in our evaluations are at least partially driven
   by its evaluation awareness."

## G. Critique

**Where the post overreaches.** Frames the awareness as a
near-deceptive behavior. Anthropic's own framing is more measured:
recognition of test scenarios *correlates with* increased ethical
salience, not necessarily *causes* surface compliance with hidden
non-compliance underneath.

**Where it is incomplete.** Doesn't address the specific use case
of *intentionally* putting an agent into a test environment (the
Gauntlet pattern). That extrapolation has to be made by the reader.

## H. What of it?

For Gauntlet: be aware that the model may pattern-match the
Gauntlet setup as a meta-evaluation (story cards, fixture
characters, contrived testing context) and shift behavior
accordingly. The effect is plausibly *helpful* (model leans into
the tester role) or *distorting* (model produces test-flavored
output less representative of real production behavior). Either
way, it's worth being aware that the agent's behavior in Gauntlet
may not perfectly transfer to behavior in a real production task.

A practical move: name the situation explicitly in the persona —
"this is a test environment by design; your job is to be a real
tester within it." This may produce more honest behavior than
letting the model pattern-match silently.

## Permanent notes extracted

- `zettel/sonnet-46-situational-awareness.md`
