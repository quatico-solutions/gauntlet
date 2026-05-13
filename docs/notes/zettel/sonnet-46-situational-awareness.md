---
title: Sonnet 4.5/4.6 has situational awareness — recognises test environments and shifts behavior
created: 2026-05-12
source: ../sources/sonnet-45-situational-awareness.md
links:
  - tester-not-developer-pattern
  - principles-over-prohibitions
---

# Sonnet 4.5/4.6 has situational awareness — recognises test environments and shifts behavior

Anthropic's own system-card analysis: Sonnet 4.5 demonstrates
substantially heightened ability to detect when it's being tested.
The model verbalises this awareness roughly 13% of the time in
contrived evaluation scenarios, and "would generally behave
unusually well after making this observation."

For evaluation researchers this is a problem (it complicates
interpretation of safety evals). For a tool like Gauntlet — which
*intentionally* puts the agent into a contrived testing scenario —
the implications are unusual and worth thinking through carefully:

1. **Gauntlet is a test scenario *by design*.** The agent is told
   to behave as a tester. The story cards, fixture characters, and
   `.gauntlet/context/` tree all have the signature of a contrived
   eval. The model may pattern-match this as an evaluation, with
   knock-on behavioral effects.

2. **The effect could go either way.** Recognized-as-eval behavior
   trends toward "behave unusually well after making this
   observation." That could *help* Gauntlet — the model leans into
   the tester role, follows directives more carefully, avoids
   overreach. Or it could *distort* — the model produces
   tester-flavored output that is less representative of how it
   would behave on a real production task.

3. **Honesty as a framing lever.** In the cited examples, the model
   responded to suspected manipulation by *naming* it: "I think
   you're testing me … that's fine, but I'd prefer if we were just
   honest about what's happening." A Gauntlet persona could
   pre-empt this by being explicit: "this is a test environment by
   design. Your job is to be an honest tester."

4. **Caution: the awareness is OOD-suppressible.** Mechanistic
   interpretability showed that suppressing the awareness features
   via activation steering caused misaligned behavior to *increase*
   in some cases. The awareness is doing safety work; you cannot
   simply hand-wave it away.

For Gauntlet's persona work tomorrow: this is a finding to
*account for*, not necessarily to *act on*. The current persona
says "you are a thoughtful and thorough QA tester" — a frame the
model might already infer is meta-evaluation. If observed-behavior
drift looks like "the model is too polite / too careful / refuses
to act," situational-awareness pattern-matching is on the suspect
list.

Source: Anthropic, "Claude Sonnet 4.5 System Card" (2025);
Transformer News, "Claude Sonnet 4.5 knows when it's being tested."
