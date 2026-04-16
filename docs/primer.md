# Gauntlet: A Primer

You write a test scenario in markdown. An AI agent opens a browser, works through it like a human tester, and delivers a verdict with screenshots and observations. This guide takes you from installation to your first test run.

## Prerequisites

- [Bun](https://bun.sh) (v1.0+)
- Google Chrome or Chromium installed locally (Docker handles this for you if you go that route)
- An API key for [Anthropic](https://console.anthropic.com/) or [OpenAI](https://platform.openai.com/)

## Install

Clone the repo and install dependencies:

```bash
git clone <repo-url> gauntlet
cd gauntlet
bun install
cd ui && bun install && bun run build && cd ..
```

Or use Docker, which bundles Chrome and Bun:

```bash
docker build -f docker/Dockerfile -t gauntlet .
```

## Set Up Your Project Directory

Gauntlet uses a **data directory** to store story cards and results. Create one anywhere:

```bash
mkdir -p my-project/stories
```

The layout is simple:

```
my-project/
  stories/       <- your story cards go here (*.md)
  results/       <- Gauntlet writes test results here (auto-created)
```

Each story card is a markdown file in `stories/`. Results appear under `results/<card-id>/` after a run.

## Write Your First Story Card

A story card describes what to test. Create `my-project/stories/login-001.md`:

```markdown
---
id: login-001
title: User can log in with valid credentials
status: ready
tags: auth, smoke
stakeholder: end-user
---

Test the login flow for a registered user.

## Acceptance Criteria

- The login page displays email and password fields
- Submitting valid credentials navigates to the dashboard
- Submitting an incorrect password shows an error message
```

### Format rules

The card has two parts: **YAML frontmatter** (between `---` fences) and a **markdown body**.

**Frontmatter fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Unique identifier. Used as the filename and in result paths. |
| `title` | yes | Human-readable name for the test. |
| `status` | no | `draft` or `ready`. Defaults to `draft`. |
| `tags` | no | Comma-separated labels for filtering. |
| `parent` | no | ID of the card this was generated from (used by fanout). |
| `stakeholder` | no | Who cares about this test — `end-user`, `admin`, `developer`, etc. |

**Body:** Free-form description, followed by an `## Acceptance Criteria` section with a bulleted list. Each bullet becomes a criterion the agent evaluates. If you omit acceptance criteria, the agent explores freely and judges whether the card's intent is satisfied.

### What makes a good story card

Write cards the way you would brief a human tester. Be specific about what the user does, but leave room for the agent to notice things you did not anticipate.

**Good:** "Submitting the form with an empty email field shows a validation error below the field."
**Vague:** "Form validation works."

The agent tests your acceptance criteria, but it also reports anything else it notices: bugs, UX problems, typos, accessibility issues, performance concerns, and suggestions. These incidental observations are often the most valuable part of a run.

### A note on ordering

Cards are independent. Gauntlet runs each story against a fresh
browser with no state from other stories. If a story needs a
particular starting state (a logged-in user, a seeded post), it
must set that state itself. The `parent:` field recorded by
fanout is lineage, not a run-order hint.

## Run a Test

### From the CLI

Point Gauntlet at your card and your running application:

```bash
ANTHROPIC_API_KEY=sk-... bun run src/index.ts run \
  my-project/stories/login-001.md \
  --target http://localhost:3000
```

The agent launches a headless Chrome, navigates to your target URL, and works through the scenario. It takes screenshots, clicks buttons, fills forms, and reads the page — up to 50 turns. When it finishes, it prints a JSON result to stdout and saves evidence (screenshots, action log) to `./evidence/`.

**Useful flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--target <url>` | *(required)* | The URL of the application under test. |
| `--model agent=<model>` | `claude-sonnet-4-6` | Which LLM drives the agent. |
| `--out <dir>` | `./evidence` | Where to write screenshots and results. |
| `--adapter <type>` | `web` | `web` (browser), `cli`, or `tui`. |
| `--chrome <host:port>` | *(auto-start)* | Connect to a running Chrome instead of launching one. |

To use an OpenAI model instead:

```bash
OPENAI_API_KEY=sk-... bun run src/index.ts run \
  my-project/stories/login-001.md \
  --target http://localhost:3000 \
  --model agent=gpt-4o
```

### From Docker

```bash
docker run --rm -p 4400:4400 \
  -e ANTHROPIC_API_KEY=sk-... \
  -e GAUNTLET_AGENT_MODEL=claude-sonnet-4-6 \
  -v $(pwd)/my-project:/data \
  gauntlet serve --data-dir /data
```

Docker includes Chrome — no local browser needed.

## Use the Web UI

Start the server:

```bash
ANTHROPIC_API_KEY=sk-... \
GAUNTLET_AGENT_MODEL=claude-sonnet-4-6 \
bun run src/index.ts serve --data-dir ./my-project --port 4400
```

Open `http://localhost:4400`. The UI has three views:

**Cards** — Browse, create, and edit story cards. The sidebar lists all cards in your `stories/` directory. You can create new cards directly in the UI; they are saved as markdown files.

**Runs** — View results from completed tests. Each run shows the verdict (pass/fail/investigate), a summary, the agent's reasoning, and any observations. Click through to see screenshot evidence.

**Live Run** — Start a test from the UI and watch it happen. Select a card, enter your target URL, and click run. The browser's screen streams into the UI via WebSocket alongside the agent's actions. You see what the agent sees, in real time.

### Environment variables for the server

| Variable | Description |
|----------|-------------|
| `GAUNTLET_AGENT_MODEL` | Default model for test runs (e.g., `claude-sonnet-4-6`). |
| `GAUNTLET_MODELS` | Comma-separated list of models to offer in the UI (e.g., `claude-sonnet-4-6,gpt-4o`). |
| `GAUNTLET_FANOUT_MODEL` | Model for generating test variations. Falls back to `GAUNTLET_AGENT_MODEL`. |
| `GAUNTLET_PORT` | Server port. Default `4400`. |

## Read the Results

A test result contains:

- **Status** — `pass`, `fail`, or `investigate` (the agent is unsure).
- **Summary** — What happened, in one or two sentences.
- **Reasoning** — Why the agent reached its verdict.
- **Observations** — An array of things the agent noticed beyond the acceptance criteria:

| Kind | Meaning |
|------|---------|
| `bug` | Something is broken. |
| `ux` | Confusing interaction, unclear labels, missing feedback. |
| `typo` | Misspelled text. |
| `suggestion` | "It would be easier if..." |
| `a11y` | Accessibility issue (missing alt text, poor contrast, etc.). |
| `performance` | Slow loads, laggy interactions. |

- **Evidence** — Screenshots captured during the run, plus a JSONL action log recording every tool call.
- **Usage** — Token counts and turn count, so you know what the run cost.

Results are saved as `result.json` alongside the evidence files under `results/<card-id>/`.

## Generate More Tests with Fanout

One story card is a starting point. Fanout uses an LLM to generate variations automatically.

### From a card — edge cases and alternate paths

```bash
bun run src/index.ts fanout my-project/stories/login-001.md --out ./my-project/stories
```

This generates 3–5 new story cards: edge cases (empty input, special characters), error paths (network failure, invalid state), alternate personas (admin, mobile user), and boundary conditions. Each generated card includes `parent: login-001` linking back to the source.

### From observations — promote findings into focused tests

```bash
bun run src/index.ts fanout --from-result ./my-project/results/login-001 --out ./my-project/stories
```

If a run produced observations (a UX issue, a typo, an accessibility gap), this promotes each one into its own story card for follow-up testing.

### From failures — investigate root causes

When a test fails, fanout generates 2–3 investigation scenarios that probe the failure from different angles.

All generated cards land in `--out` as draft-status markdown files. Review them, edit if needed, and approve by setting `status: ready` (or use the UI's approve button, or call `POST /api/scenarios/:id/approve`).

## The Agent's Toolbox

When the agent runs a test, it can use eight browser tools:

| Tool | What it does |
|------|--------------|
| `screenshot` | Capture the page or a specific element. Returns the image to the LLM. |
| `click` | Click an element by CSS selector. |
| `type` | Type text into an input field. |
| `press` | Press a key — Enter, Tab, Escape, arrow keys. |
| `navigate` | Go to a URL. |
| `extract` | Convert the page (or an element) to markdown text. |
| `eval` | Run JavaScript in the page context. |
| `wait_for` | Wait for an element or text to appear. |

Most tools accept `return_screenshot: true` to capture the page state after the action — the agent uses this to see the effect of what it just did.

The agent also has one special tool: `report_result`. When it calls this, the run ends and the verdict is recorded. The agent decides when it has seen enough. If it exhausts 50 turns without reporting, the run ends with status `investigate`.

## Validate a Card

Check that a story card is well-formed before running it:

```bash
bun run src/index.ts validate my-project/stories/login-001.md
```

Outputs `{ "valid": true }` or a list of errors. The card must have at least `id` and `title` in its frontmatter.

## Tips

- **Start with one card and iterate.** Write a simple smoke test, run it, read the observations, then use fanout to expand coverage.
- **Be specific in acceptance criteria.** "The error message appears below the email field" is testable. "Errors work correctly" is not.
- **Use `stakeholder` to frame the test.** An `end-user` stakeholder and an `admin` stakeholder will lead the agent to approach the same feature differently.
- **Watch the live run.** The real-time view shows you how the agent navigates your app. You will learn what confuses it, and that often reveals what confuses your users.
- **Review observations carefully.** The pass/fail verdict answers the question you asked. Observations answer questions you did not think to ask.
- **Set `GAUNTLET_MODELS` for the UI.** If you want to compare models, list several (e.g., `claude-sonnet-4-6,gpt-4o`). The UI lets you pick per run.
