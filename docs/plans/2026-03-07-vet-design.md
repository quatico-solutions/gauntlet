# Vet: Scenario Testing System

## Purpose

Vet executes story cards as test scenarios against real applications. An autonomous agent reads a story card, opens the app, tests it like a human would, and reports what happened -- including incidental findings like UX friction, typos, and suggestions.

Toil invokes vet as part of build workflows or standalone test runs.

## Principles

- Story cards ARE scenarios -- same format, same files, no separate artifact
- Unix tool -- file path in, structured results out, one scenario per invocation
- API-first -- web UI is a client of the API
- Autonomous exploration -- the agent figures out how to test; steps are optional
- Configurable models -- different LLMs for different roles, mix providers
- Container-ready -- same CLI interface locally or in Docker

## Repository Structure

```
vet/
  src/
    cli/           CLI entrypoints (run, fanout, validate, serve)
    agent/         Test agent (LLM orchestration, tool dispatch)
    adapters/
      web/         Forked superpowers-chrome CDP library
      cli/         PTY-based terminal adapter
    models/        LLM provider abstraction (Anthropic, OpenAI)
    format/        Story card parsing (markdown + YAML frontmatter)
    evidence/      Screenshot capture, run logging, artifact management
    api/           REST API server
    web/           Review/approval UI (later)
  docker/          Container configs (Chrome + bun)
  test/
  docs/
```

## CLI

```
vet run <scenario.md> --target <url> --out <dir> [--adapter web|cli] [--model agent=<m>] [--model judge=<m>]
vet fanout <story.md> --out <dir> [--model fanout=<m>]
vet validate <scenario.md>
vet serve [--port 3000]
```

`vet run` executes a single scenario. Toil handles parallelism by spawning
multiple processes. Stdout is structured JSON. Evidence goes to `--out`.

## Story Card Format

```markdown
---
id: story-001
title: User can add a todo item
status: draft | refined | ready | passed | failed
tags: [onboarding, core]
parent: story-000
stakeholder: new user
---

As a new user, I want to add a todo item so that I can
track my tasks.

## Acceptance Criteria
- User can type a todo item and press Enter
- The item appears in the list
- The item count updates
```

All fields optional except id and title. Steps are optional -- if absent,
the agent explores autonomously. `parent` links fanout scenarios to their
source story card. Acceptance criteria are prose; the agent reads and judges
them, no regex or pattern matching.

Scenarios live in brainstorm's data directory:
`data/products/{slug}/stories/`

## Agent

The agent is an autonomous tester. It receives:
- The story card as context
- A set of tools (web or CLI adapter)
- A target URL or command

It explores the app like a human tester would: reads the story, opens the
app, pokes around, tries to accomplish the goal, reacts to what it sees.
No formal planning phase -- the agent reasons as it goes.

The agent reports:
- Verdict -- pass / fail / investigate
- Reasoning -- why this verdict
- Observations -- incidental findings (bugs, UX issues, typos, suggestions)
- Evidence -- screenshots and logs, referenced by path

Observations are first-class output. A tester sent to verify one thing
often notices others: confusing navigation, unrelated typos, missing
feedback, performance issues. Each observation can become a new story
card via fanout.

## Model Configuration

Models are configurable per role:

```
--model agent=claude-sonnet-4-6
--model judge=claude-opus-4-6
--model fanout=claude-sonnet-4-6
```

Or via environment:

```
VET_AGENT_MODEL=gpt-4o
VET_JUDGE_MODEL=claude-opus-4-6
VET_FANOUT_MODEL=claude-sonnet-4-6
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
```

Provider inferred from model name. Anthropic and OpenAI to start.
Different models excel at different tasks -- GPT series may be better
for browser interaction, Claude for judgment and reasoning.

## Web Adapter

Forked from superpowers-chrome into `src/adapters/web/`. CDP-direct,
zero external dependencies. Tools exposed to the agent:

- `screenshot()` -- capture current viewport, auto-saves to evidence dir
- `click(selector_or_coords)` -- click element
- `type(text)` -- type into focused element
- `press(key)` -- keyboard input
- `navigate(url)` -- go to URL
- `extract(selector?)` -- get page content as markdown
- `eval(js)` -- execute JavaScript
- `wait_for(selector_or_text)` -- wait for element or text

Every action auto-logs to `run.jsonl` with timestamp and screenshot.

## CLI Adapter

PTY-based terminal emulation for testing CLI apps:

- `screenshot()` -- render terminal as image
- `type(text)` -- send input
- `press(key)` -- send key
- `read_output()` -- get recent terminal text

## Structured Output

Stdout JSON from `vet run`:

```json
{
  "scenario": "story-001",
  "status": "pass | fail | investigate",
  "summary": "what happened",
  "reasoning": "why this verdict",
  "observations": [
    {
      "kind": "bug | ux | typo | suggestion | a11y | performance",
      "description": "description of finding",
      "evidence": ["screenshots/step-003.png"]
    }
  ],
  "evidence": {
    "screenshots": ["evidence/screenshots/step-001.png"],
    "log": "evidence/run.jsonl"
  },
  "duration_ms": 12340
}
```

## Evidence Directory

Written to `--out`:

```
evidence/
  screenshots/     PNG screenshots at each step
  run.jsonl        Action-by-action log with timestamps
  bug-report.md    Generated if status is fail
```

## Containerization

Docker image with Chrome + bun for headless execution:

```dockerfile
FROM debian:bookworm-slim
# Install Chrome, bun
# Copy vet
# Entrypoint: vet run
```

Same CLI interface in container and locally. Toil can run containerized
scenarios for isolation.

## API Server

`vet serve` exposes a REST API for scenario management:

- `GET /scenarios` -- list scenarios from brainstorm data dir
- `GET /scenarios/:id` -- scenario detail
- `PUT /scenarios/:id` -- update scenario
- `POST /scenarios/:id/approve` -- approve agent-generated scenario
- `GET /results` -- list test results
- `GET /results/:runId` -- result detail with evidence
- `POST /fanout` -- trigger scenario generation
- `POST /run` -- trigger scenario execution

UI is a separate concern built on this API.

## Fanout

Generates new story cards from various sources:

- Story expansion -- edge cases, error paths, alternate personas
- Failure analysis -- failed runs produce scenarios targeting the failure
- Observation promotion -- incidental observations become new story cards

Output is story card files in the same markdown format with `parent:`
referencing the source.

## Toil Integration

Toil invokes vet as a subprocess:

```yaml
nodes:
  - id: run_scenarios
    kind: shell
    command: vet run ${scenario_path} --target ${target_url} --out ${evidence_dir}
    for_each:
      list: input.scenarios
```

Results flow back to brainstorm via toil's webhook/callback mechanism.

## Tech Stack

- Runtime: bun
- Language: TypeScript
- Browser automation: superpowers-chrome (CDP-direct, forked)
- Terminal automation: PTY (node-pty or bun equivalent)
- LLM: Anthropic SDK + OpenAI SDK, configurable per role
- API: lightweight HTTP server (Hono or similar)
- Database: filesystem + git (story cards as markdown)
- Testing: bun test
- Container: Debian + Chrome + bun
