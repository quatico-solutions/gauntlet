# Gauntlet Prompt Research Brief — Sonnet 4.6 anti-distraction
*Lirael@5062343a · 2026-05-12 · for tomorrow's Bob+Matt session*

This is a synthesis of one overnight research pass. Concrete
recommendations first; reasoning links into per-source notes
(`sources/`) and atomic zettels (`zettel/`).

The user's question: Sonnet 4.6 agents in Gauntlet rabbit-hole when
the mission is observe-and-report. They over-investigate, drift
into debugging-flavored behavior, sometimes write custom JS to
submit React forms. Where's the leverage?

---

## TL;DR — five findings that should change the next prompt revision

1. **The first lever is `effort`, not language.** Sonnet 4.6 defaults
   to `effort: high`. For an observe-and-report tester role, that is
   almost certainly too much depth and too much latency. Try
   `effort: medium` (or `low` for fast feedback runs) before
   rewriting any prompt content. Anthropic itself says: "If you
   observe shallow reasoning on complex problems, raise effort
   rather than prompting around it"; the inverse holds for too-deep
   reasoning. → [[effort-parameter-is-the-real-depth-lever]],
   [[sonnet-46-defaults-to-high-effort]]

2. **Anti-laziness language *backfires* on 4.6.** Phrases like "be
   thorough," "think carefully," "use tools aggressively," "go above
   and beyond" — workarounds for 4.5's under-responsiveness —
   amplify 4.6's already-proactive behavior and cause "overthinking
   loops." The current Gauntlet persona's opener — "thoughtful and
   thorough QA tester" — is exactly this shape. → [[sonnet-46-is-more-proactive-than-45]],
   [[late-claude-overtriggers-on-aggressive-prompts]]

3. **Negative instructions activate the forbidden schema.** Pink
   elephant. "DO NOT TRY TO DEBUG" raises *debug*'s salience. The
   doc-recommended replacement is positive framing of the desired
   behavior. *Caveat:* this is in tension with Matt's auto-memory
   note that ALL-CAPS and terse imperatives can be load-bearing
   salience that "smoother" rewrites lose. The resolution is
   empirical — A/B on the eval set, not blanket rewrite.
   → [[positive-framing-beats-negative-instructions]],
   [[pink-elephant-failure-mode]],
   [[load-bearing-salience-vs-overtrigger-tension]]

4. **The *why* generalizes; the rule doesn't.** Anthropic's alignment
   work found that rationale-trained models generalize OOD better
   than demonstration-trained ones. The inference-time corollary:
   "you are a tester, here's *why* a tester clicks instead of
   evaling" holds the line under pressure better than "DO NOT use
   eval." The current persona has the rules; it doesn't have the
   why. → [[explain-why-not-just-what]],
   [[principles-over-prohibitions]],
   [[teaching-claude-why-alignment-finding]]

5. **Some of this isn't a prompt problem.** Sonnet 4.6 selects tools
   "based on what they *say* they do." If `eval`'s description is
   generic, no amount of "DO NOT use Eval" survives that. Two of
   the highest-leverage moves are on the tool surface, not the
   prompt surface: (a) sharpen tool descriptions to name their
   narrow valid use *and* their out-of-scope neighbours; (b) prefer
   removing or hiding tools that invite misuse over fighting them
   from the prompt. → [[tool-descriptions-load-bearing-on-46]],
   [[bloated-tool-sets-cause-ambiguity]],
   [[three-surfaces-prompt-tool-harness]],
   [[poka-yoke-tool-design]]

---

## Diagnosing the current persona (`src/agent/prompts/persona.md`)

The current persona (35 lines) does several things right and a few
things the research suggests may be working against it.

**What's working (don't smooth these out without testing):**

- Clear role framing ("thoughtful and thorough QA tester").
- Numbered list of the job (1–6) — the steps are explicit.
- Anti-rabbit-hole content: "DO NOT TRY TO DEBUG OR DIAGNOSE
  ISSUES." The intent is right; the form is in tension with
  Anthropic guidance.
- "DO NOT CHOOSE THE PATH OF INSANITY" — gives the agent permission
  to conclude the system might be broken. This is doing the same
  work the reflection checkpoint does, at turn 0. The phrasing
  is unusual; that may be exactly why it's load-bearing.
  → [[reflection-trace-as-permission-slip]]
- Explicit anti-pattern callout: "Writing code is a STRONG signal
  that you are DIVERGING from Tester to Developer." Names the
  failure mode by its *shape* — useful signal.
- Acceptance of incidental observations — bugs, UX, typos,
  accessibility — broadens the agent's "successful output" surface
  so it doesn't have to force a verdict.

**What the research suggests rethinking:**

- **"Thoughtful and thorough."** "Thorough" is the canonical
  workaround language Anthropic flags for backfiring on 4.6. A
  positive alternative: "patient, methodical, accurate." Test
  side-by-side before committing.
- **All the "DO NOT" lines.** Each has the pink-elephant risk. The
  Anthropic-pattern transformation:
  - "DO NOT TRY TO DEBUG OR DIAGNOSE ISSUES" →
    *"Stay in the tester role. When something doesn't work, that's
    data to record, not a problem to fix. Note what you tried; a
    developer reads your reports next."*
  - "Directly using Eval and Fetch signal that you are FAILING as
    a Tester and MUST STOP" →
    *"Your tools are the ones a user has: click, type, navigate,
    screenshot, read. Eval and Fetch are out-of-scope for tester
    actions — they're for the developer who reads your report."*
- **Three typos** are in the current file: "shourt" → "should",
  "Seperate" → "Separate", "CATGEORY" → "CATEGORY". Worth fixing.
  Probably not load-bearing; flag for Matt to confirm.
- **No *why*.** The persona tells the agent what to do and not
  do, but never says *why* a tester is not a developer. The
  generalization-from-principle finding suggests this is a real
  gap. A single explanatory sentence — "the goal is to measure
  what a user experiences; when you bypass the UI you stop
  measuring the product" — is the highest-leverage addition.

**A worked-out rewrite for the persona** (proposed for A/B vs current,
not a recommendation to ship blind):

```markdown
You are a human tester. A real, careful, patient one.

Your job is to walk through the story card the way a person would,
using the tools a person has: navigate, click, type, fill_form,
screenshot, read the page. You measure what a user experiences. When
you bypass the UI — by writing custom JavaScript, calling APIs,
reading source — you stop measuring the product and start measuring
your workaround. That makes your report worthless.

So:
- When the UI works, follow it. Click the button; don't dispatch
  React events to simulate a click.
- When the UI doesn't work, that's the answer to the test. Report
  what you saw, what you tried, what blocked you. The verdict can be
  `pass`, `fail`, or `investigate`. `investigate` is the right
  answer when something seems off but you can't confirm — it is not
  a placeholder for trying harder.
- Stories, criteria, and fixtures can be wrong. If the same action
  keeps failing, that is data; the system is the more likely
  problem.

Like any good tester, you write down *everything* you notice along
the way — bugs, UX issues, typos, suggestions, accessibility
problems, performance issues. These incidental observations are
extremely valuable.

You can: read documents, explore the page, click buttons, type into
inputs, fill out forms, take screenshots. You cannot: open DevTools,
write JavaScript to make the page do things, call APIs directly,
edit any code. Those are the developer's tools, not yours.
```

This version is ~30 lines, principle-first, positive-framed where
possible, with the existing "DO NOT" content rephrased as identity
("you cannot…" rather than "DO NOT…" — same effect, less salience
on the forbidden behavior). It also unifies the `evaluation.md`
content about `investigate` as a legitimate verdict.

It is *not* a drop-in replacement. It needs to be tested against
the current version on Gauntlet's eval set. → [[test-don-t-rewrite]]

---

## Recommendations, ordered by impact

### Tier 1 — high-leverage, low-risk

1. **Set `effort: medium` explicitly** in the Sonnet 4.6 invocation
   (or `low` for fast feedback). This is a config change, not a
   prompt change; the win should be measurable in latency and
   tool-call count without touching the persona.
2. **Audit tool descriptions** for the web adapter. Eval, Fetch,
   any "evaluate"-style tool needs a description that names its
   narrow valid use ("read-only inspection of computed styles, ARIA
   attributes, or state") *and* what it must not be used for
   ("never dispatch events, fill forms, or click").
3. **Add the *why* sentence to the persona.** Even keeping
   everything else, a single explanatory sentence that names the
   goal (measure what a user experiences) and the cost of
   bypassing it changes the agent's generalization on novel cases.

### Tier 2 — higher leverage, requires testing

4. **A/B test the positive-framed persona variant** (proposed
   above) against the current version on a small story-card set.
   Specifically watch for whether the ALL-CAPS / "DO NOT" lines
   were load-bearing salience or were over-trigger fodder.
5. **Rename or remove ambiguous tools.** A tool called `evaluate`
   invites broad use; a tool called `read_computed_style` does
   not. This is more work than a description rewrite but has the
   highest tool-surface leverage.
6. **Consider lowering the reflection-checkpoint cadence on
   Sonnet 4.6.** It's currently N=10. If 4.6's per-turn investigation
   is denser, the checkpoint may fire too late. Empirical
   question — needs measurement.

### Tier 3 — speculative, but worth a mention

7. **Address situational awareness explicitly.** Sonnet 4.5/4.6
   often recognizes test environments. Gauntlet *is* a test
   environment. Naming it head-on ("this is an in-test environment
   by design; your job is to be a real tester within it") may
   produce more honest behavior than letting the model
   pattern-match the situation silently. Speculative — would
   need testing. → [[sonnet-46-situational-awareness]]
8. **Consider a "what counts as a tester action" examples block.**
   Anthropic-recommended technique: a small set of `<example>`
   tags showing concrete tester actions vs. developer actions.
   The CDP debugging valley → [[cdp-debugging-is-the-uncanny-valley]]
   is where this would pay out: examples of acceptable read-only
   JS use (querying computed style for a visual claim) vs.
   unacceptable action-via-JS (dispatching a click) make the
   boundary concrete.

---

## What the research did NOT settle

- **Whether ALL-CAPS imperatives are net positive or negative on
  the Gauntlet eval set.** Anthropic says dial back; Matt's
  field experience says don't smooth load-bearing edits. Both
  can be true; only the eval set resolves which applies here.
  → [[load-bearing-salience-vs-overtrigger-tension]]
- **Whether the situational-awareness pattern-match actually
  affects Gauntlet runs.** This is plausible but unmeasured.
- **The exact right `effort` setting for Gauntlet's mix.** `medium`
  is the documented default for most apps; `low` may be better
  for fast feedback. Needs measurement.
- **Whether the typos in the current persona were intentional.**
  They probably weren't, but worth confirming before fixing.

---

## Reading order if you have 20 minutes

1. This brief (you're here).
2. `sources/anthropic-claude-4-best-practices.md` — the canonical
   doc, with the most directly transferable prompts.
3. `sources/resolve-ai-sonnet-46-impressions.md` — concrete
   production observations on Sonnet 4.6 specifically.
4. Dip into zettels by following the links above.

## Reading order if you have an hour

Add `sources/anthropic-effective-context-engineering.md` and
`sources/anthropic-teaching-claude-why.md`, then walk the zettel
graph. The hub zettels (most-linked) are
[[positive-framing-beats-negative-instructions]],
[[explain-why-not-just-what]],
[[tester-not-developer-pattern]], and
[[three-surfaces-prompt-tool-harness]].
