---
title: "Anthropic — Prompting best practices for Claude 4.x"
source_url: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-4-best-practices
fetched: 2026-05-12
reader: Lirael@5062343a
---

# Anthropic — Prompting best practices for Claude 4.x

## A. Classification

Practical, official prompt-engineering reference. The single canonical
source from Anthropic covering Claude Opus 4.7, Opus 4.6, Sonnet 4.6,
and Haiku 4.5. Treats prompting as engineering — patterns are presented
with model-specific deltas, sample snippets, and explicit migration
guidance.

## B. Unity

Late-generation Claude models follow instructions more literally,
trigger tools more aggressively, and reason more upfront than their
predecessors; effective prompts now under-specify rather than
over-prompt, use positive framing and explained reasons rather than
"DO NOT" walls, and rely on the `effort` parameter — not aggressive
language — to control depth.

## C. Outline of major parts

1. **Model-specific tuning** (Opus 4.7 first, then 4.6 / Sonnet 4.6 /
   Haiku 4.5 deltas). Verbosity calibration, effort settings, tool-use
   triggering, "literal instruction following", subagent control,
   design defaults, code review harnesses, computer use.
2. **General principles.** Clarity and directness; add context (the
   *why*); examples; XML tags; roles; long-context prompting.
3. **Output and formatting.** Communication style; format control;
   LaTeX defaults; migrating away from prefilled responses.
4. **Tool use.** Tool usage; conservative vs. proactive action;
   parallel tool calling.
5. **Thinking and reasoning.** Overthinking; adaptive thinking; CoT
   patterns.
6. **Agentic systems.** Long-horizon reasoning; context awareness;
   multi-window workflows; balancing autonomy and safety; research;
   subagent orchestration; reducing file creation; over-eagerness;
   anti-test-cheating; minimizing hallucinations.
7. **Capability-specific.** Vision, frontend design.
8. **Migration considerations.** Specific guidance for moving from
   earlier generations to 4.6.

## D. Author's central problems

1. How do you tune a system prompt for the 4.x generation, given that
   the same instructions that helped earlier models can now backfire?
2. How do you control depth of reasoning without ad-hoc tonal
   escalation in the prompt?
3. How do you keep agentic loops focused (no overengineering, no
   overinvestigation, no test-pleasing) while keeping them autonomous?
4. How do you migrate from explicit "thinking budget" controls to the
   adaptive-thinking model?

## E. Key terms

- **Adaptive thinking.** New parameter shape (`thinking: {type:
  "adaptive"}`); the model decides when and how much to think,
  calibrated by `effort` and query complexity. Replaces
  `budget_tokens`.
- **Effort parameter.** `low | medium | high | xhigh | max`. Strict
  on Opus 4.7 (at `low`/`medium` "the model scopes its work to what
  was asked rather than going above and beyond"). The intended lever
  for depth control — *not* prompt language.
- **Literal instruction following.** Opus 4.7's tendency to interpret
  prompts more strictly than 4.6, "not silently generalize an
  instruction from one item to another." If you want broad
  application, state scope explicitly.
- **Overeagerness / overengineering.** 4.5/4.6 will add files,
  abstractions, defensive coding beyond what was requested; named
  failure mode with a canonical countermeasure prompt.
- **Anti-laziness prompting.** Verbiage like "be thorough" or "use
  tools aggressively" — *needed for older models, harmful on 4.6*.
  This is the most consequential migration warning in the doc for
  any team carrying prompts forward.
- **Pink-elephant / negative-instruction failure.** Implicit: the doc
  consistently teaches "tell Claude what to do instead of what not
  to do." Not labelled with this term but it is the principle.

## F. Main propositions and arguments

### F1. Positive framing dominates negative framing.

> "Tell Claude what to do instead of what not to do. Instead of: 'Do
> not use markdown in your response'. Try: 'Your response should be
> composed of smoothly flowing prose paragraphs.'"

The doc repeats this in the formatting section, the verbosity
section, and implicitly in every sample prompt. The closest the doc
comes to canonical guidance is:

> "Positive examples showing how Claude can communicate with the
> appropriate level of concision tend to be more effective than
> negative examples or instructions that tell the model what not to
> do."

### F2. Explain the *why*; generalization follows.

The Text-to-Speech example is the load-bearing demonstration:
"NEVER use ellipses" (worse) vs. "Your response will be read aloud by
a text-to-speech engine, so never use ellipses since the text-to-
speech engine will not know how to pronounce them" (better). The
prose summary:

> "Providing context or motivation behind your instructions, such as
> explaining to Claude why such behavior is important, can help
> Claude better understand your goals and deliver more targeted
> responses. Claude is smart enough to generalize from the
> explanation."

### F3. Dial back aggressive language — 4.5/4.6 over-trigger.

> "Claude Opus 4.5 and Claude Opus 4.6 are also more responsive to
> the system prompt than previous models. If your prompts were
> designed to reduce undertriggering on tools or skills, these models
> may now overtrigger. The fix is to dial back any aggressive
> language. Where you might have said 'CRITICAL: You MUST use this
> tool when...', you can use more normal prompting like 'Use this
> tool when...'."

Confirmed independently in the migration section:

> "Tune anti-laziness prompting: If your prompts previously
> encouraged the model to be more thorough or use tools more
> aggressively, dial back that guidance. Claude 4.6 models are
> significantly more proactive and may overtrigger on instructions
> that were needed for previous models."

### F4. Conservative action — the closest official pattern to "be a tester, don't be a developer."

The `<do_not_act_before_instructions>` sample prompt is the most
directly transferable artifact for Gauntlet:

> "Do not jump into implementation or change files unless clearly
> instructed to make changes. When the user's intent is ambiguous,
> default to providing information, doing research, and providing
> recommendations rather than taking action. Only proceed with
> edits, modifications, or implementations when the user explicitly
> requests them."

### F5. Overengineering has a canonical countermeasure prompt.

> "Avoid over-engineering. Only make changes that are directly
> requested or clearly necessary. Keep solutions simple and focused:
> - Scope: Don't add features, refactor code, or make 'improvements'
>   beyond what was asked. A bug fix doesn't need surrounding code
>   cleaned up...
> - Defensive coding: Don't add error handling, fallbacks, or
>   validation for scenarios that can't happen. Trust internal code
>   and framework guarantees..."

Notably, this is *itself* written in negative-instruction style —
Anthropic's own bound on F1. The frame still leads with a positive
imperative ("Keep solutions simple and focused") followed by
specifics.

### F6. Effort is the right lever; prompts are not.

> "If you observe shallow reasoning on complex problems, raise effort
> to `high` or `xhigh` rather than prompting around it."

And conversely:

> "In some cases, Claude Opus 4.6 may think extensively, which can
> inflate thinking tokens and slow down responses. If this behavior
> is undesirable, you can add explicit instructions to constrain its
> reasoning, or you can lower the `effort` setting to reduce overall
> thinking and token usage."

### F7. Tools that undertriggered on older models will trigger appropriately now.

> "Replace blanket defaults with more targeted instructions. Instead
> of 'Default to using [tool],' add guidance like 'Use [tool] when
> it would enhance your understanding of the problem.'"
> "Remove over-prompting. Tools that undertriggered in previous
> models are likely to trigger appropriately now. Instructions like
> 'If in doubt, use [tool]' will cause overtriggering."

### F8. Subagent and tool restraint.

For Sonnet 4.6 specifically:

> "Claude Opus 4.6 has a strong predilection for subagents and may
> spawn them in situations where a simpler, direct approach would
> suffice."
> "Use subagents when tasks can run in parallel, require isolated
> context, or involve independent workstreams that don't need to
> share state. For simple tasks, sequential operations, single-file
> edits, or tasks where you need to maintain context across steps,
> work directly rather than delegating."

### F9. Sonnet 4.6 migration: set effort explicitly.

> "Claude Sonnet 4.6 defaults to an effort level of `high`, in
> contrast to Claude Sonnet 4.5 which had no effort parameter.
> Consider adjusting the effort parameter as you migrate from Claude
> Sonnet 4.5 to Claude Sonnet 4.6. If not explicitly set, you may
> experience higher latency with the default effort level."

Recommended Sonnet 4.6 settings:
- Medium for most applications
- Low for high-volume or latency-sensitive workloads
- At `low` effort with thinking disabled, "you can expect similar or
  better performance relative to Claude Sonnet 4.5 with no extended
  thinking."

For *computer use* specifically (Gauntlet's web adapter): "Claude
Sonnet 4.6 achieved best-in-class accuracy on computer use
evaluations using adaptive mode."

### F10. Long-horizon coherence and state-tracking.

The doc explicitly recommends *external state tracking* (JSON state
files, progress notes, git) over in-context reminders. For Gauntlet,
the analogue is: bias toward letting the harness/state do work the
prompt can't reliably do mid-loop. This is the same principle the
reflection-checkpoints-spec in this repo applies — the spec aligns
with the doc's intent.

## G. Critique

**Where the doc is uninformed.** It says little about how to handle
agents that should be *unable* to escape a narrow role (Gauntlet's
tester pattern). The prompt patterns assume an agent *with* developer
authority that needs occasional restraint. They do not address the
inverse: an agent that is structurally not a developer and must not
become one even when frustrated. The two cases need different
levers.

**Where it is incomplete.** No empirical claims about *which*
negative instructions matter and which can be safely converted to
positive. The pink-elephant principle is stated, but the doc does
not test whether the prohibitions in its *own* overengineering
sample prompt (multiple "Don't" lines) are a violation of its
broader guidance, or a deliberate exception for hard constraints.
Plausibly the latter — paired with positive framing they may be
tolerable — but the doc doesn't say so.

**Where the prompting advice may overgeneralize.** "Dial back
aggressive language" is asserted as a general migration heuristic.
But Matt's auto-memory has a contradicting empirical observation:
ALL-CAPS, terse imperatives can be load-bearing salience that
"cleaner" rewrites lose. The doc and the field experience can both
be right — the resolution is that *which* aggressive language is
load-bearing is empirical per-prompt. The doc's blanket
recommendation should be treated as a hypothesis to test, not a
ratchet.

**Where it is illogical.** None observed. The internal consistency
is high; the only frictions are with the empirical claims above and
with a real product's need for hard "no-go" zones.

## H. What of it?

For tomorrow's Gauntlet prompt session, this doc supplies the
authoritative framing for the most important decisions:

1. **Try positive replacements for the persona's "DO NOT" lines —
   then A/B test.** Don't rewrite blindly. Specifically test:
   - "DO NOT TRY TO DEBUG" → "Stay in the tester role. When
     something doesn't work, that's data to record, not a problem to
     fix."
   - "Directly using Eval and Fetch signal that you are FAILING as a
     Tester and MUST STOP" → "Use the regular interaction tools —
     click, type, navigate, screenshot, read. Eval/Fetch are
     out-of-scope tools."
   But: respect the user's auto-memory rule about not smoothing
   load-bearing edits. If the ALL-CAPS forms empirically beat the
   smooth forms on Gauntlet's eval set, keep them.

2. **Add the *why* to every directive.** A tester who is told *why*
   they aren't a developer will hold that line under pressure better
   than one who is told they *must not* be one.

3. **Set `effort` explicitly on Sonnet 4.6.** Likely `medium` (or
   `low` for fast feedback runs). The default is `high`, which costs
   latency and probably amplifies the rabbit-hole tendency.

4. **Audit the prompt for "be thorough" / "investigate fully" style
   verbs.** The Sonnet 4.6 generation overtriggers on these. The
   current persona uses "thoughtful and thorough" — that's the exact
   pattern the doc warns about.

5. **Make tool descriptions precise.** Sonnet 4.6 picks tools based
   on what they *say* they do, not surrounding context. Gauntlet's
   tool descriptions are a separate surface to harden.

6. **Consider lifting state out of the prompt where possible.** The
   reflection-checkpoints-spec already does this for stuck-handling.
   The principle extends: anything Gauntlet wants the agent to
   remember mid-loop is better encoded as a harness-side reminder
   than a prompt-side rule.

## Permanent notes extracted from this source

- `zettel/late-claude-overtriggers-on-aggressive-prompts.md`
- `zettel/positive-framing-beats-negative-instructions.md`
- `zettel/explain-why-not-just-what.md`
- `zettel/effort-parameter-is-the-real-depth-lever.md`
- `zettel/literal-instruction-following-in-late-claude.md`
- `zettel/overeagerness-is-a-named-failure-mode.md`
- `zettel/state-out-of-prompt-into-harness.md`
- `zettel/tool-descriptions-are-load-bearing-on-sonnet-46.md`
