---
title: "Anthropic — Effective context engineering for AI agents"
source_url: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
fetched: 2026-05-12
reader: Lirael@5062343a
---

# Anthropic — Effective context engineering for AI agents

## A. Classification

Practical engineering blog post from Anthropic. Frames system-prompt
design as an *engineering* discipline rather than an art, with
named failure modes and an explicit "right altitude" prescription.
General-purpose — not Sonnet-specific — but applies directly to any
agent built on Claude 4.x.

## B. Unity

Context engineering is the practice of choosing *what tokens enter
the agent's attention budget at each step*; the design surface
includes the system prompt, tool definitions, and external state,
and the failure modes are bloated tool sets, ambiguous tool
boundaries, and the wrong altitude of instruction.

## C. Outline of major parts

- The shift from prompt engineering to context engineering
- Curating high-signal tokens
- Tool-set design as the primary lever
- The "right altitude" for system prompts
- Long-horizon context management (compaction, structured
  note-taking, multi-agent)

## D. Author's central problems

How do you keep a long-running agent coherent and focused when its
attention budget is finite and its actions accumulate?

## E. Key terms

- **Context engineering.** Choosing the tokens that enter the
  attention budget at each step.
- **Right altitude.** The Goldilocks level of system-prompt
  abstraction.
- **Bloated tool sets.** Overlapping or excessive tools that force
  ambiguous decisions.
- **Compaction.** Summarizing nearing-the-limit context and
  reinitiating with the summary.
- **Structured note-taking.** External persistent memory that
  carries state across context refreshes.

## F. Main propositions and arguments

### F1. The smallest possible set of high-signal tokens.

> "find the smallest possible set of high-signal tokens that
> maximize the likelihood of some desired outcome."

The implication: extra tokens are not free. Every extra rule,
every extra tool, every extra example dilutes the signal of the
ones that mattered. This is the underlying argument against
overstuffed system prompts.

### F2. Bloated tool sets are a primary failure mode.

> "One of the most common failure modes we see is bloated tool
> sets that cover too much functionality or lead to ambiguous
> decision points about which tool to use."

> "If a human engineer can't definitively say which tool should be
> used in a given situation, an AI agent can't be expected to do
> better."

### F3. Two altitudes are wrong.

Brittle: "hardcoding complex, brittle logic in their prompts to
elicit exact agentic behavior. This approach creates fragility and
increases maintenance complexity over time."

Vague: "vague, high-level guidance that fails to give the LLM
concrete signals for desired outputs or falsely assumes shared
context."

Correct: "specific enough to guide behavior effectively, yet
flexible enough to provide the model with strong heuristics to
guide behavior."

### F4. Don't write laundry lists of edge cases.

Teams "often stuff a laundry list of edge cases into a prompt in
an attempt to articulate every possible rule the LLM should
follow." Instead, curate "diverse, canonical examples that
effectively portray the expected behavior." This is the
"distribution vs principle" framing under a different name.

### F5. Long-horizon work needs external state.

Compaction, structured note-taking, and multi-agent architecture
are the three main strategies for tasks that exceed the context
budget. Memory tools "pair naturally with context awareness." Git
is good for state tracking.

## G. Critique

**Where it is incomplete.** No discussion of Sonnet-vs-Opus or
model-generation deltas. The advice is general; the model-specific
tuning lives in the prompting-best-practices doc. For a Gauntlet
session that needs Sonnet-4.6-specific guidance, this is necessary
background but not sufficient.

**Where it is uninformed.** Says little about *how* to write a
tool description that does the work the doc says it should do.
The diagnostic ("a human engineer can't definitively say which
tool") is sharp; the constructive guidance is thinner.

**Where it is illogical.** None observed.

## H. What of it?

For tomorrow's Gauntlet prompt session, this source supplies the
*meta*-frame: don't think about prompt edits in isolation, think
about the full attention-budget surface. The tool definitions and
the external state (reflection checkpoints, story-card contents)
are part of the surface. If a problem fits the prompt surface,
fix it there; if it fits the tool surface, fix it there.

Specific action items:

1. **Audit the tool inventory for bloated-set indicators.** Do
   `click` and `evaluate_js_click` both exist? Could a human
   engineer say which to use when? If not, the persona prompt
   cannot reliably fix it.

2. **Check the right-altitude diagnostic on the persona.** Is it
   over-specified (lists of click sequences, edge-case enumeration)
   or under-specified (vague exhortations)? The current persona
   is short, which suggests the latter is the bigger risk — but
   the short-and-vague vs. short-and-principled distinction
   matters.

3. **Lean on external state where possible.** The reflection
   checkpoint mechanism already does this. Anything else that
   tries to live in the system prompt and shouldn't — move it.

## Permanent notes extracted from this source

- `zettel/bloated-tool-sets-cause-ambiguity.md`
- `zettel/right-altitude-for-instructions.md`
- `zettel/state-out-of-prompt-into-harness.md`
- `zettel/three-surfaces-prompt-tool-harness.md`
