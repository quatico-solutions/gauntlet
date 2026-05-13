---
title: "Resolve.ai — Early impressions of Claude Sonnet 4.6 in production agents"
source_url: https://resolve.ai/blog/Our-early-impressions-of-Claude-Sonnet-4.6
fetched: 2026-05-12
reader: Lirael@5062343a
---

# Resolve.ai — Early impressions of Claude Sonnet 4.6 in production agents

## A. Classification

Practical, vendor blog post. Production-agent operators reporting
empirical observations from running Sonnet 4.6 in their AI agents
versus running Sonnet 4.5 on the same workload. Single primary
source on this specific behavior shift.

## B. Unity

Sonnet 4.6 is *more proactive* than 4.5 — same prompts produce more
tool calls, more reasoning, and deeper investigation; the workarounds
that suppressed under-investigation on 4.5 (like "be thorough") now
amplify the wrong direction.

## C. Outline of major parts

- Adaptive thinking and how it changed the depth-of-investigation
  curve
- Quantitative deltas (tool-call counts, latency, accuracy)
- Prompt-engineering migration advice
- Tool-description sensitivity on 4.6

## D. Author's central problems

How do production agent operators control the depth of a Sonnet 4.6
investigation cycle without losing the model's intelligence gains?

## E. Key terms

- **Adaptive thinking** — the new dynamic-thinking mode where the
  model self-regulates reasoning depth.
- **Effort parameter** — `low | medium | high | xhigh | max`; the
  intended lever for depth control.
- **"Already-proactive behavior"** — the Resolve.ai term for 4.6's
  baseline tendency to investigate more.

## F. Main propositions and arguments

### F1. Sonnet 4.6 is more thorough, slower, and more accurate.

Approximately "10% improvement over Opus 4.5 with thinking disabled,
and 20% with high thinking." But also: "20% slower without thinking
and 40% slower with high thinking enabled," and "3-4 more tool calls
on average per investigation" without thinking, "~5 additional tool
calls on average" with high thinking.

### F2. The previous workarounds backfire.

"Instructions like 'be thorough' or 'think carefully' which were
common workarounds for Sonnet 4.5 amplify the model's already-
proactive behavior on 4.6 and can cause overthinking loops."

### F3. The right lever is `effort`, not language.

"Set effort explicitly" — described as "a better lever for
controlling depth" than natural language instructions.

### F4. Tool descriptions are now load-bearing.

"Write precise tool descriptions" because "The 4.6 models select
tools based on what they say they do, not just surrounding context."
The implication for any tool-restriction pattern: a "DO NOT use
tool X" line in the prompt may be weaker than rewriting tool X's
description to make its narrow scope clear.

## G. Critique

**Where it is incomplete.** No discussion of how to handle the
tension between increased intelligence (real, useful) and increased
latency (real, costly) for short-task workloads where the
investigation depth isn't wanted. The advice to lower `effort`
implicitly accepts giving up some intelligence — fine for Gauntlet,
but not framed as the explicit trade-off it is.

**Where the framing is biased.** This is a single production team's
observation; the deltas are reported as if invariant, but they vary
substantially across workload shapes. Sonnet 4.6 in a workload that
*rewards* deeper investigation will look much better than the
workload Resolve.ai measures. The asymmetry-of-distraction story is
true *for short-horizon observe-and-report tasks*, which is also the
relevant shape for Gauntlet.

**Where it is illogical.** None observed. The internal logic is
clean: more proactive model → previous anti-laziness prompts now
overtrigger → use `effort` and tool descriptions instead.

## H. What of it?

This source is the single most directly applicable empirical input
for Gauntlet's prompt session tomorrow. The two action items
descend directly from it:

1. **Set `effort` explicitly on Sonnet 4.6 in Gauntlet's
   configuration.** Almost certainly `medium` (or `low` for fast
   feedback runs). The default `high` likely amplifies the
   rabbit-hole behavior Matt is seeing.

2. **Audit tool descriptions for the web adapter.** Eval, Fetch,
   and any other "JS-like" tool needs a description that names its
   narrow valid use *and* names what it must not be used for. The
   prompt-side "DO NOT use Eval" line is weaker than the tool-side
   "Use only when …; do not use to submit forms, simulate clicks,
   or bypass UI flows."

The doc is also the strongest evidence that the previous Gauntlet
persona — which characterizes the agent as "thoughtful and thorough"
— may be actively *contraindicated* on Sonnet 4.6.

## Permanent notes extracted from this source

- `zettel/sonnet-46-is-more-proactive-than-45.md`
- `zettel/tool-descriptions-load-bearing-on-46.md`
- `zettel/sonnet-46-defaults-to-high-effort.md`
