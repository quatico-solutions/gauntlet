# Gauntlet

Gauntlet is an AI-powered QA testing framework. It uses large language models (Claude or GPT) to test web applications the way a human tester would: navigating pages, clicking buttons, filling forms, taking screenshots, and reporting bugs. You write test scenarios as markdown "story cards," and Gauntlet's AI agent works through them in a real browser, delivering a verdict (pass/fail/investigate) with evidence.

## What it does

1. **You describe what to test** in a story card -- a markdown file with a title, description, and acceptance criteria.
2. **An AI agent opens a real browser**, navigates to your application, and interacts with it using Chrome DevTools Protocol.
3. **The agent explores and evaluates** your acceptance criteria, but also reports anything else it notices: bugs, UX issues, typos, accessibility problems, performance issues, and suggestions.
4. **You get a structured result** with a verdict, reasoning, observations, screenshots, and an action log.

Beyond single-scenario testing, Gauntlet can **generate test variations** ("fanout") from a parent story card -- producing edge-case, error-path, and alternate-persona scenarios automatically. It can also generate follow-up scenarios from observations or failures in previous runs.

## Architecture

```
                  ┌──────────────┐
                  │  Story Cards │  (markdown files with YAML frontmatter)
                  └──────┬───────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
   CLI commands     HTTP API + UI    Fanout generator
   (run, validate)  (Hono server)    (AI-generated variations)
        │                │
        └────────┬───────┘
                 │
           ┌─────┴──────┐
           │   Agent    │  (agentic loop: LLM + browser tools, up to 50 turns)
           └─────┬──────┘
                 │
        ┌────────┼────────┐
        │        │        │
   LLM Client  Browser   Evidence Logger
   (Claude or   Adapter   (screenshots,
    OpenAI)    (CDP)      action log)
```

### Tech stack

- **Runtime**: [Bun](https://bun.sh) (TypeScript)
- **Server**: [Hono](https://hono.dev) (minimal web framework)
- **Frontend**: React 19 + React Router 7 + Vite + Tailwind CSS
- **Browser automation**: Chrome DevTools Protocol (custom CDP library)
- **AI providers**: Anthropic SDK (Claude) and OpenAI SDK
- **Deployment**: Docker (Debian + Chrome + Bun)
- **Storage**: File-based (no database) -- markdown for scenarios, JSON for results

## How it works

### Story cards

Test scenarios are markdown files (conventionally named `scenario.md`) with YAML-style frontmatter followed by a markdown body:

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

- User can enter email and password
- Clicking "Log in" with valid credentials navigates to the dashboard
- Error message is shown for an incorrect password
```

**Frontmatter** (delimited by `---` lines, one `key: value` per line):

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Stable identifier for the card (used in URLs and filenames) |
| `title` | yes | One-line human-readable summary |
| `status` | no | `draft` or `ready` (defaults to `draft`). Only `ready` cards are surfaced for routine runs |
| `tags` | no | Comma-separated list (e.g. `auth, smoke`) |
| `stakeholder` | no | Whose perspective the test takes (e.g. `end-user`, `admin`) |
| `parent` | no | `id` of the parent card -- set automatically on fanout-generated variations to link back to the source |

The frontmatter parser is intentionally minimal: it splits on the first `:` per line, so values are plain strings -- do not quote them and do not use nested YAML structures.

**Body**: free-form markdown describing the scenario. Everything before the `## Acceptance Criteria` heading is treated as the description and passed to the agent as context. Lines under `## Acceptance Criteria` that begin with `- ` are parsed as individual criteria; the agent evaluates each one and the verdict reflects whether they all hold. The `## Acceptance Criteria` section is optional -- a description-only card is valid.

You can validate a card's format with `gauntlet validate scenario.md`.

Each file holds exactly one card: one frontmatter block, one description, one optional `## Acceptance Criteria` list. `gauntlet run` takes a single scenario path and executes it in one agent loop -- there is no built-in batch runner, so to run a suite you either script a shell loop over multiple files or drive `POST /api/run/:id` per card via the HTTP API.

**Copy-paste template** -- a minimal card you can drop into a new `scenario.md` and edit:

```markdown
---
id: my-card-001
title: Short description of what this tests
status: draft
tags: smoke
stakeholder: end-user
---

Describe the scenario here: what the tester should do, any setup or context
they need, and what a successful run looks like.

## Acceptance Criteria

- First thing that must be true
- Second thing that must be true
- Third thing that must be true
```

### The agent loop

The core of Gauntlet is an agentic loop in `src/agent/agent.ts`:

1. The story card is loaded and a system prompt is built, instructing the LLM to act as a thorough QA tester.
2. The LLM is given browser tools (screenshot, click, type, press, navigate, extract, eval, wait_for) plus a special `report_result` tool.
3. On each turn, the LLM decides what to do -- take a screenshot, click a button, type into a form, etc. Tool results (including screenshot images) are fed back into the conversation.
4. The loop continues until the agent calls `report_result` with its verdict, or hits the 50-turn limit.
5. Each tool call has a 30-second timeout to prevent hangs.

The agent reports:
- **Status**: `pass`, `fail`, or `investigate`
- **Summary and reasoning**: what happened and why
- **Observations**: an array of `{kind, description}` where kind is one of: `bug`, `ux`, `typo`, `suggestion`, `a11y`, `performance`

### Browser adapter

The web adapter (`src/adapters/web/adapter.ts`) drives Chrome via CDP and exposes eight tools to the agent:

| Tool | Description |
|------|-------------|
| `screenshot` | Capture the page or a specific element (returns image to the LLM) |
| `click` | Click an element by CSS selector |
| `type` | Type text into an element |
| `press` | Press a key (Enter, Tab, Escape, etc.) |
| `navigate` | Go to a URL |
| `extract` | Convert the page (or element) to markdown text |
| `eval` | Run a JavaScript expression in the page |
| `wait_for` | Wait for an element or text to appear |

Most tools support `return_screenshot` to automatically capture the page state after the action.

### CLI adapters (local and remote)

Gauntlet can also drive a command-line program instead of a browser. Two adapters share the same `type`/`press`/`read_output` tools:

- **`cli`** — spawns the command as a local subprocess (`CLIAdapter` in `src/adapters/cli/adapter.ts`).
- **`remote-cli`** — talks to a relay server on another machine that spawns the subprocess there and proxies its stdio over HTTP (`RemoteCLIAdapter` in `src/adapters/cli/remote-adapter.ts`). This lets Gauntlet run inside Docker or on CI while the subprocess-under-test runs on a dev workstation, an embedded device, or any host reachable over HTTP.

The relay protocol is specified in [`docs/remote-cli.md`](docs/remote-cli.md). A reference Bun implementation lives in [`cli-runner/`](cli-runner/) — see its [README](cli-runner/README.md) for the full endpoint reference and curl examples.

### LLM providers

Gauntlet supports two providers via a common `LLMClient` interface:

- **Anthropic** (`src/models/anthropic.ts`): Uses Claude with prompt caching (ephemeral markers on system prompt, tools, and the last message) to reduce token costs on long agent runs.
- **OpenAI** (`src/models/openai.ts`): Standard chat completions API.

### Fanout: test variation generation

The fanout system (`src/fanout/generator.ts`) uses an LLM to automatically generate additional test scenarios from a parent card. Three modes:

- **Variations**: Edge cases, error paths, alternate personas, boundary conditions (3-5 generated per parent card).
- **From observations**: Promotes observations from a test run (bugs, UX issues, etc.) into focused follow-up story cards.
- **From failures**: When a test fails, generates 2-3 root-cause investigation scenarios.

Generated cards include `parent` linking back to the source and are validated against the story card format before being saved.

### Evidence collection

During each run, the `EvidenceLogger` captures:
- **Screenshots**: PNG images saved to a `screenshots/` directory
- **Action log**: A JSONL file recording every tool call and its arguments
- **Video**: Frame capture for playback in the UI

Results are written to a `results/` directory as `result.json` alongside the evidence files.

## Usage

### CLI

```bash
# Run a test scenario against a target URL
gauntlet run scenario.md --target http://localhost:3000

# Run with a specific model and adapter
gauntlet run scenario.md --target http://localhost:3000 --model claude-sonnet-4-20250514 --adapter web

# Drive a CLI program running on a different machine via the remote relay
gauntlet run scenario.md \
  --adapter remote-cli \
  --target "python3 -u my_cli.py" \
  --relay-url http://my-host:4455 \
  --relay-token "$GAUNTLET_RELAY_TOKEN"

# Validate a story card's format
gauntlet validate scenario.md

# Generate test variations from a story card
gauntlet fanout scenario.md --out ./stories

# Generate follow-up scenarios from a previous result
gauntlet fanout --from-result ./results/run-001 --out ./stories

# Start the web server
gauntlet serve --port 4400 --data-dir ./my-project
```

### Remote CLI adapter

The `remote-cli` adapter drives a subprocess on a **different machine** via an HTTP relay. Typical use: Gauntlet (and its LLM) runs inside Docker or on CI, but the CLI under test runs on your workstation — or on an embedded device, a VM, a staging host, etc.

#### 1. Start the relay on the host that will run the subprocess

Ship the reference relay (a small Bun server, see [`cli-runner/`](cli-runner/)). On the machine where your CLI lives:

```bash
# Inside cli-runner/
bun install

export GAUNTLET_RELAY_TOKEN=$(openssl rand -hex 32)
bun run src/bin.ts
# => gauntlet-relay listening on http://127.0.0.1:4455 (auth: bearer token)
```

Share the token out-of-band — the relay is remote-shell-equivalent behind it. Bind to `127.0.0.1` by default; expose to the network only behind `--allow-command` and ideally an HTTPS-terminating proxy:

```bash
bun run src/bin.ts \
  --bind 0.0.0.0 \
  --port 4455 \
  --allow-command '^(python3|node|bun) '
```

Confirm it's up without auth:

```bash
curl -sS http://<host>:4455/health
# => {"ok":true,"version":"0.1.0"}
```

#### 2a. `gauntlet run` against the relay

On the Gauntlet side, point `--target` at the **shell command** you want the agent to drive (it gets run as `sh -c <command>` on the remote host), then pass the relay URL and token:

```bash
export GAUNTLET_RELAY_URL=http://my-host:4455
export GAUNTLET_RELAY_TOKEN=...  # the token you printed above

gauntlet run scenario.md \
  --adapter remote-cli \
  --target "python3 -u my_cli.py"
```

Flags can be passed explicitly instead of via env:

```bash
gauntlet run scenario.md \
  --adapter remote-cli \
  --target "python3 -u my_cli.py" \
  --relay-url http://my-host:4455 \
  --relay-token "$GAUNTLET_RELAY_TOKEN"
```

Inside the agent loop the model sees the same CLI toolset as with the local `cli` adapter (`type`, `press`, `read_output`) — it just happens to be typing into a shell on another machine.

From Docker, point at the host's relay with `host.docker.internal`:

```bash
docker run --rm \
  -e ANTHROPIC_API_KEY=sk-... \
  -e GAUNTLET_AGENT_MODEL=claude-sonnet-4-20250514 \
  -e GAUNTLET_RELAY_URL=http://host.docker.internal:4455 \
  -e GAUNTLET_RELAY_TOKEN="$GAUNTLET_RELAY_TOKEN" \
  -v "$PWD:/work" -w /work \
  gauntlet run scenario.md \
    --adapter remote-cli \
    --target "python3 -u my_cli.py"
```

#### 2b. `gauntlet serve` + API / UI

The HTTP API accepts the same options per-run. Start the server with the relay env vars set as defaults:

```bash
GAUNTLET_RELAY_URL=http://my-host:4455 \
GAUNTLET_RELAY_TOKEN="$GAUNTLET_RELAY_TOKEN" \
gauntlet serve --port 4400 --data-dir ./my-project
```

Then fire a run for a card with `POST /api/run/:id`:

```bash
curl -sS -X POST http://localhost:4400/api/run/my-card-001 \
  -H "Content-Type: application/json" \
  -d '{
    "target": "python3 -u my_cli.py",
    "adapter": "remote-cli",
    "model": "claude-sonnet-4-20250514"
  }'
```

Per-run overrides are supported — useful if you talk to multiple relays:

```json
{
  "target": "bun run ./my-cli.ts",
  "adapter": "remote-cli",
  "model": "claude-sonnet-4-20250514",
  "relay_url": "http://other-host:4455",
  "relay_token": "..."
}
```

If `relay_url` / `relay_token` aren't in the body, the server falls back to `GAUNTLET_RELAY_URL` / `GAUNTLET_RELAY_TOKEN` from its environment. Missing both → `400`.

#### Protocol summary

A run does roughly:

```
gauntlet (client)              relay (server)             child process
      │  POST /start ──────────────▶ spawn sh -c "<target>"
      │◀──── { ok, pid } ────────────
      │
      │  GET  /output?wait_ms=2000 ──▶  (long-poll)
      │◀──── { data: base64(...) } ─── stdout+stderr merged
      │         (repeats in background)
      │
      │  POST /stdin  (base64)    ──▶  write to child stdin
      │
      │  POST /close             ──▶  SIGTERM, grace, then SIGKILL
```

All stdio is base64'd through JSON so ANSI escapes survive intact. stdout and stderr are merged in arrival order (matches the local `CLIAdapter`). See [`docs/remote-cli.md`](docs/remote-cli.md) for the full wire contract and [`cli-runner/README.md`](cli-runner/README.md) for a per-endpoint reference with curl examples.

### Web UI

Run `gauntlet serve` to start the server (default port 4400). The UI provides:

- **Cards view**: Browse, create, and edit story cards in a sidebar-driven interface.
- **Runs view**: See all test results with status badges (pass/fail/investigate), view summaries, observations, and screenshot evidence.
- **Run detail**: Watch video playback of the test, read the agent's reasoning, see token usage, and trigger fanout (generate variations, investigate failures).
- **Live run**: Start a test from the UI and watch it execute in real-time via WebSocket -- see the browser frames update and the LLM's output stream in.

### API

The HTTP API (Hono) serves at `/api`:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/scenarios` | GET | List all story cards |
| `/api/scenarios` | POST | Create a new story card |
| `/api/scenarios/:id` | GET | Get a single card |
| `/api/scenarios/:id` | PUT | Update a card |
| `/api/scenarios/:id` | DELETE | Delete a card |
| `/api/scenarios/:id/approve` | POST | Set card status to ready |
| `/api/run/:id` | POST | Execute a scenario |
| `/api/results` | GET | List all results |
| `/api/results/:id` | GET | Get result metadata |
| `/api/results/:id/video` | GET | Stream test video |
| `/api/results/:id/screenshots/:name` | GET | Get a screenshot |
| `/api/fanout/:id` | POST | Generate test variations |
| `/api/fanout/:id/observations` | POST | Generate cards from observations |
| `/api/fanout/:id/failure` | POST | Generate cards from a failure |
| `/api/ws` | WS | WebSocket for live run streaming |

## Docker

```bash
docker build -f docker/Dockerfile -t gauntlet .
docker run -p 4400:4400 -e ANTHROPIC_API_KEY=sk-... gauntlet serve
```

Run a scenario from the current directory against a target URL (mount the
current directory into the container and point at `scenario.md`):

```bash
docker run --rm \
  -e OPENAI_API_KEY=sk-... \
  -e GAUNTLET_AGENT_MODEL=gpt-5.4-mini \
  -v "$PWD:/work" -w /work \
  gauntlet run scenario.md --target https://example.com
```

On macOS/Windows, use `--target http://host.docker.internal:3000` to reach a dev server running on the host.

The Docker image includes Chrome, Bun, and the pre-built UI. It uses Debian bookworm-slim as the base.

## Environment variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ANTHROPIC_API_KEY` | API key for Claude models | -- |
| `OPENAI_API_KEY` | API key for OpenAI models | -- |
| `GAUNTLET_PORT` | Server port | 4400 |
| `GAUNTLET_AGENT_MODEL` | Default model for test execution | -- |
| `GAUNTLET_FANOUT_MODEL` | Model for scenario generation | -- |
| `GAUNTLET_RELAY_URL` | Default relay base URL for `--adapter remote-cli` | -- |
| `GAUNTLET_RELAY_TOKEN` | Bearer token for the remote-cli relay | -- |

## Project structure

```
src/
  index.ts              CLI entry point and command router
  types.ts              Core types (VetResult, Observation, etc.)
  agent/
    agent.ts            Agentic loop: LLM + tools for up to 50 turns
    prompts.ts          System prompt construction from story cards
  models/
    provider.ts         LLM client interface
    anthropic.ts        Claude client (with prompt caching)
    openai.ts           OpenAI client
    resolve.ts          Model string -> client instantiation
  adapters/
    adapter.ts          Abstract adapter interface
    web/adapter.ts      Chrome CDP browser adapter (8 tools)
    cli/adapter.ts      Terminal-based adapter
    tui/adapter.ts      Text UI adapter
  api/
    server.ts           Hono app with API routes + static UI serving
    ws.ts               WebSocket broadcaster for live runs
    routes/             HTTP route handlers (scenarios, results, run, fanout)
    safe-path.ts        Path traversal protection
  cli/
    args.ts             CLI argument parsing
    run.ts              `run` command
    validate.ts         `validate` command
    fanout.ts           `fanout` command
  fanout/
    generator.ts        AI-powered test variation generation
  evidence/
    logger.ts           Screenshot/action capture during runs
    writer.ts           Result serialization to disk
  format/
    story-card.ts       Story card parsing and serialization
  streaming/
    screencast.ts       Browser frame capture
ui/
  src/
    App.tsx             React Router setup
    components/         CardsList, CardEditor, RunsList, RunDetail, LiveRun, etc.
    hooks/              Data-fetching hooks (useCards, useResults, useRunStream)
    lib/api.ts          HTTP client for the backend API
docker/
  Dockerfile            Production image (Debian + Chrome + Bun)
```
