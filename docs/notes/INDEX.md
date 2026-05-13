# Notes index — prompt research for Gauntlet tester agent

*Built by Lirael@5062343a, 2026-05-12.*

The synthesis brief for tomorrow's session lives at
`PROMPT-RESEARCH-BRIEF.md` — start there.

These notes are written so a fresh reader (another Bob, Matt, future
me) can read any single zettel cold and follow links into the rest
of the network.

---

## Per-source notes (`sources/`)

The bibliographic record. Each follows the A–H analytical-reading
shape per the `reading-a-book` skill.

- `anthropic-claude-4-best-practices.md` — the canonical Anthropic
  prompt engineering reference; **the single most load-bearing source**.
- `anthropic-effective-context-engineering.md` — the "right altitude"
  framing and bloated-tool-set failure mode.
- `anthropic-teaching-claude-why.md` — alignment-science evidence that
  rationales generalize better than rules.
- `anthropic-building-effective-agents.md` — ACI design, poka-yoke,
  tool docs as behavioral spec.
- `resolve-ai-sonnet-46-impressions.md` — production observations on
  Sonnet 4.6's increased proactivity and the workarounds that backfire.
- `pink-elephant-negative-instructions.md` — community-anecdotal
  evidence that "DO NOT" instructions activate the forbidden schema.
- `alexop-claude-qa-tester.md` — practitioner report on building a
  Claude QA tester with browser-only tools.
- `sonnet-45-situational-awareness.md` — Sonnet 4.5 recognizes
  evaluation contexts; relevant for an agent placed *in* one.

## Atomic zettels (`zettel/`)

One idea per file, in the author's own words, linked into the
network.

### Sonnet 4.x behavior

- `sonnet-46-is-more-proactive-than-45.md` — same prompt, deeper
  investigation, more tool calls, more latency.
- `sonnet-46-defaults-to-high-effort.md` — the config knob that's
  inflating latency before you've changed any prompt.
- `effort-parameter-is-the-real-depth-lever.md` — depth is set
  by `effort`, not by language.
- `late-claude-overtriggers-on-aggressive-prompts.md` —
  workaround language calibrated to 4.5 overtriggers on 4.6.
- `sonnet-46-situational-awareness.md` — recognises test
  scenarios; relevant when agent IS in one.
- `vending-bench-distraction-is-real.md` — long-horizon
  distraction is measurable and not a context-window problem.

### Prompt framing patterns

- `positive-framing-beats-negative-instructions.md` — tell Claude
  what to do, not what not to do.
- `pink-elephant-failure-mode.md` — the mechanism behind the
  above: forbidden concepts get attention.
- `explain-why-not-just-what.md` — rules with reasons generalize;
  bare rules don't.
- `principles-over-prohibitions.md` — system prompt as
  constitution.
- `teaching-claude-why-alignment-finding.md` — the empirical
  backing.
- `right-altitude-for-instructions.md` — too brittle vs. too vague.
- `specificity-reduces-tool-calls.md` — vagueness in the mission
  compounds with 4.6's proactivity.
- `load-bearing-salience-vs-overtrigger-tension.md` — when
  aggressive language helps and when it hurts; resolve empirically.
- `test-don-t-rewrite.md` — A/B before assuming a rewrite is
  better.

### Tester-specific patterns

- `tester-not-developer-pattern.md` — Gauntlet's inversion of
  the usual scope-creep problem.
- `cdp-debugging-is-the-uncanny-valley.md` — where the
  tester/developer boundary blurs on Chrome.
- `intent-not-script-for-tester-agents.md` — outcomes with
  conditions, not click sequences.
- `give-the-agent-permission-to-stop.md` — `investigate` as a
  legitimate verdict.
- `reflection-trace-as-permission-slip.md` — what makes the
  reflection checkpoint work.

### Surfaces beyond the prompt

- `three-surfaces-prompt-tool-harness.md` — prompt vs. tool vs.
  harness; choose the right lever for each problem.
- `tool-descriptions-load-bearing-on-46.md` — descriptions are
  part of prompt engineering on 4.6.
- `bloated-tool-sets-cause-ambiguity.md` — overlapping tools force
  wrong choices.
- `poka-yoke-tool-design.md` — make wrong tool use structurally
  harder.
- `state-out-of-prompt-into-harness.md` — long loops bury static
  reminders; the harness should fire them when needed.

---

## How the network connects

The two hub zettels (most connected) are:

- `positive-framing-beats-negative-instructions` — the practical
  pattern, drawing on `explain-why-not-just-what` and the empirical
  evidence in `teaching-claude-why-alignment-finding`.
- `three-surfaces-prompt-tool-harness` — the meta-frame that tells
  you which other zettel applies.

For Sonnet-4.6-specific tuning, follow:
`sonnet-46-defaults-to-high-effort` → `effort-parameter-is-the-real-depth-lever`
→ `late-claude-overtriggers-on-aggressive-prompts` →
`sonnet-46-is-more-proactive-than-45` →
`tool-descriptions-load-bearing-on-46`.

For the tester-not-developer thread:
`tester-not-developer-pattern` → `cdp-debugging-is-the-uncanny-valley`
→ `intent-not-script-for-tester-agents` →
`give-the-agent-permission-to-stop` →
`reflection-trace-as-permission-slip`.

For the framing-language thread:
`positive-framing-beats-negative-instructions` →
`pink-elephant-failure-mode` → `explain-why-not-just-what` →
`principles-over-prohibitions`.

For the "is this really a prompt problem?" thread:
`three-surfaces-prompt-tool-harness` →
`bloated-tool-sets-cause-ambiguity` → `tool-descriptions-load-bearing-on-46`
→ `poka-yoke-tool-design`.
