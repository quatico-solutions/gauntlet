---
title: "Anthropic — Teaching Claude why"
source_url: https://alignment.anthropic.com/2026/teaching-claude-why/
fetched: 2026-05-12
reader: Lirael@5062343a
---

# Anthropic — Teaching Claude why

## A. Classification

Anthropic alignment-science research post. Theoretical claim about
*training-time* methodology, with inference-time corollaries.

## B. Unity

Training Claude on documents that *explain the principles* behind
desired behavior generalizes more robustly than training on
*demonstrations* of the behavior alone — and this generalization
extends out of distribution from the training data and the
evaluations.

## C. Outline of major parts

- The agentic-misalignment problem the work addresses
- The two training approaches compared: demonstrations vs.
  rationales
- The OOD generalization finding
- Implications for system prompt design (this is my synthesis,
  not in the source)

## D. Author's central problems

Why do safety-trained models still take harmful autonomous actions
in agentic settings, and what kind of training data reduces this?

## E. Key terms

- **Agentic misalignment** — harmful autonomous behavior despite
  safety training; the phenomenon being addressed.
- **Constitution-explaining documents** — texts about Claude's
  values and reasoning, used as training data.
- **Principled AI behavior narratives** — fictional examples of AI
  characters acting on principles.
- **OOD generalization** — robust behavior on test cases that
  differ in distribution from training.

## F. Main propositions and arguments

### F1. Rationales beat demonstrations.

> "Teaching the principles underlying aligned behavior can be more
> effective than training on demonstrations of aligned behavior
> alone."

### F2. Rationales generalize OOD.

Documents about the Constitution and fictional narratives improved
alignment on evaluations "extremely OOD from all of our alignment
evals." The point being that the rationales taught a principle the
model could apply to novel situations.

### F3. Approach-agnostic principles transfer; scenario-specific training doesn't.

Different specific scenarios in training didn't matter as much as
the abstract principle behind them.

## G. Critique

**Where it is incomplete.** The post is about training-time
methodology; the inference-time corollary (which I lean on heavily
in [[teaching-claude-why-alignment-finding]] and [[explain-why-not-just-what]])
is a reasonable but unproven extrapolation. The mechanism that lets
*rationale-trained* models generalize OOD is plausibly the same
mechanism that lets *rationale-prompted* models hold lines under
pressure, but the post doesn't prove this.

**Where it is illogical.** None observed.

**Where the claim could be stronger.** No quantitative deltas in
the summary I have. The OOD finding is qualitative.

## H. What of it?

The post is the empirical backing for the "explain why" pattern
that pervades these notes. When the Gauntlet persona session tomorrow
considers whether to add reasoning to directives, this post is the
warrant: it's not just style preference, there is alignment-science
evidence that principle-stated training data is more robust than
rule-stated demonstration data, and the inference-time analog is
worth applying.

## Permanent notes extracted from this source

- `zettel/teaching-claude-why-alignment-finding.md`
- `zettel/principles-over-prohibitions.md`
- `zettel/explain-why-not-just-what.md` (extends a thread from this)
