---
title: "alexop.dev — Building an AI QA Engineer with Claude Code and Playwright MCP"
source_url: https://alexop.dev/posts/building_ai_qa_engineer_claude_code_playwright/
fetched: 2026-05-12
reader: Lirael@5062343a
---

# alexop.dev — Building an AI QA Engineer with Claude Code and Playwright MCP

## A. Classification

Practical, single-practitioner blog post. Concrete production
findings on Claude-as-QA-tester.

## B. Unity

A Claude agent with browser-only tools, a persona ("Quinn"), and an
intent-driven story (not a script) produces useful exploratory QA;
the tool restriction prevents source-code cheating, the persona
deepens exploration, and intent-framing survives UI changes.

## F. Main propositions

1. **Tool restriction prevents cheating.** "Limiting Claude to
   browser-only tools prevents it from 'cheating' by reading your
   source code." Forces authentic black-box testing.

2. **Persona drives depth.** "The personality makes Claude test
   more thoroughly. Quinn doesn't just check if buttons work —
   Quinn tries to break things." Persona-as-prompt is a working
   pattern at the production scale.

3. **Intent beats script.** "You don't write test scripts that
   break when you change a button's text. Quinn understands intent
   and adapts."

4. **The scope is exploratory, not regression.** The author is
   explicit: this approach complements deterministic E2E tests, it
   does not replace them.

## G. Critique

**Where it is incomplete.** Doesn't address rabbit-holing or
distraction — the agent is positioned as a tool for one-shot
exploration runs, not long-loop missions. The findings transfer to
Gauntlet but the failure mode the user is asking about isn't the
central problem here.

**Where it is illogical.** None observed. Sample-size-one
practitioner report; the findings are consistent with broader
research.

## H. What of it?

Confirms three things directly relevant to Gauntlet:

1. Tool restriction is a real and effective design lever, not just
   prompt content. Gauntlet already does this; the persona could
   reinforce it positively.
2. The persona itself works to deepen and direct the agent's
   exploration — it isn't decorative.
3. Intent-not-script aligns with Gauntlet's tutorial framing of
   "outcomes with conditions, not click sequences."

## Permanent notes extracted

- `zettel/intent-not-script-for-tester-agents.md`
- Reinforces [[tester-not-developer-pattern]]
