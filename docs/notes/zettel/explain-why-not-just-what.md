---
title: Explaining *why* an instruction matters generalizes better than the rule alone
created: 2026-05-12
source: ../sources/anthropic-claude-4-best-practices.md
links:
  - positive-framing-beats-negative-instructions
  - teaching-claude-why-alignment-finding
  - tester-not-developer-pattern
  - principles-over-prohibitions
---

# Explaining *why* an instruction matters generalizes better than the rule alone

A bare prohibition gets followed brittlely; a prohibition with a
stated reason gets generalized. Anthropic's canonical demonstration:
"NEVER use ellipses" (weak) vs. "Your response will be read aloud by
a text-to-speech engine, so never use ellipses since the text-to-
speech engine will not know how to pronounce them" (strong). The
second form lets Claude generalize: it now also avoids other tokens
the TTS engine can't pronounce.

The mechanism appears to be the same one identified by Anthropic's
alignment team in [[teaching-claude-why-alignment-finding]]: training
Claude on rationales for desired behavior — Constitution-explaining
documents, fictional principled-AI narratives — produced more
robust generalization than training on demonstrations alone, and
generalized *out of distribution from the evals*. The pattern holds
at inference time too: principle-explaining prompts produce more
robust compliance than rule-stating prompts.

For Gauntlet: the persona's directives ("DO NOT TRY TO DEBUG OR
DIAGNOSE ISSUES") give the model a rule but no model of why. With a
*why*, the model can hold the line under pressure — e.g., when a
selector fails three times in a row and the natural next step would
be to write custom JS. The why might be: "you are simulating a
human tester. Humans don't open DevTools and write JS to bypass the
UI. When you do that, you stop measuring the product as a user would
experience it." The model with that explanation generalizes
correctly to selectors, retries, custom CSS, etc.

A useful heuristic: for every "don't" line in a system prompt, the
prompt should contain at least one sentence explaining what would
break if the model did do that thing. If you can't write that
sentence, the directive is probably arbitrary and the model will
silently drop it.

Source: Anthropic Prompting best practices, "Add context to improve
performance"; Anthropic alignment, "Teaching Claude why."
