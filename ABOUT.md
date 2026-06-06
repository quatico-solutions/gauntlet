# gauntlet

> AI-powered QA testing framework that drives web/CLI/TUI targets from markdown story cards and returns pass/fail verdicts with evidence.

**Family:** eval-labs · **Type:** tool · **Lifecycle:** production · **Owner:** mhat

## What it does
Gauntlet uses LLMs (Claude or GPT) to test software like a human tester: web apps via Chrome DevTools Protocol, CLI tools via stdin/stdout, and TUI programs in a tmux session. You write markdown story cards with acceptance criteria, and an agentic loop works through them via one of three adapters, returning a structured verdict (pass/fail/investigate) with screenshots, observations, and an action log. It can also generate story variations (fanout).

## How it fits
- Depends on: — (no internal prime-radiant-inc code/service dependencies; see prose) — Calls the Anthropic and OpenAI APIs directly via their SDKs; drives Chrome/CDP and tmux. No prime-radiant-inc code or service dependency.
- Used by: —
- External: Anthropic SDK (Claude), OpenAI SDK; Chrome via CDP; tmux

## Runtime & data
- Runs: Bun/TypeScript CLI plus a Hono HTTP API + React UI; Docker image available
- Data in: Story cards (markdown with YAML frontmatter); target under test
- Data out: Structured results (JSON), screenshots, action logs

<!-- Maintained by the maintaining-project-map skill. Do not hand-edit; regenerated. -->
