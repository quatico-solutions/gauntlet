# remote-cli-demo — lab notes

A running log of exactly what was done to get a Gauntlet `remote-cli` run
going end-to-end against a local Python CLI.

## Goal

Prove the remote-cli adapter works by:

1. Writing a small interactive Python CLI (`script.py`) that has enough
   branching behaviour to be worth testing.
2. Writing a Gauntlet scenario (`scenario.md`) that drives it.
3. Starting the Bun relay server from `cli-runner/`.
4. Running `gauntlet run --adapter remote-cli` and capturing the result in
   `remote-cli-demo/evidence/`.

## Environment

- `bun` 1.3.12 at `/Users/simon/.bun/bin/bun`
- `uv` 0.11.0
- `docker` 29.3.1 available (not actually used — gauntlet runs locally via
  `bun run src/index.ts`).
- API keys pulled from `llm keys get <name>` per user instruction.

## Step 1 — the Python CLI

`script.py` is a tiny TODO REPL:

- Commands: `add <text>`, `list`, `done <n>`, `help`, `quit`.
- All output prefixed with `todo>` so the agent can grep easily.
- Lines are flushed eagerly so the agent's `read_output` loop sees them
  immediately.

Chose a TODO list rather than something single-shot because it exercises
state across multiple turns, which is the whole point of the CLI adapter.

Manual smoke test before involving Gauntlet: pipe some commands in via
`printf ... | uv run --python 3.13 script.py` (logged below).

## Step 2 — the scenario

`scenario.md` has four acceptance criteria covering the golden path:

1. Two `add`s each produce a matching `todo> added: …` line.
2. `list` shows both items numbered 1 and 2.
3. `done 1` followed by `list` shows only the original second item,
   now numbered 1.
4. `quit` causes `todo> bye` and a clean exit.

## Step 3 — start the relay

```bash
cd ../cli-runner
GAUNTLET_RELAY_TOKEN=demo-token-abc123 \
  bun run src/bin.ts --port 4466 > /tmp/relay.log 2>&1 &
# => gauntlet-relay listening on http://127.0.0.1:4466 (auth: bearer token)
curl -sS http://127.0.0.1:4466/health
# => {"ok":true,"version":"0.1.0"}
```

Ran a quick manual round-trip (`/start` → `/stdin` → `/output`) directly with
curl before involving Gauntlet, just to make sure the relay + uv + script
combination actually produced `todo>`-prefixed output:

```
todo> ready. type 'help' for commands.
todo> added: hi
todo> 1. hi
todo> bye
exited=True code=0
```

## Step 4 — run Gauntlet

From `remote-cli-demo/`:

```bash
ANTHROPIC_API_KEY="$(llm keys get claude)" \
GAUNTLET_AGENT_MODEL=claude-sonnet-4-5 \
GAUNTLET_RELAY_URL=http://127.0.0.1:4466 \
GAUNTLET_RELAY_TOKEN=demo-token-abc123 \
bun run ../src/index.ts run scenario.md \
  --adapter remote-cli \
  --target "uv run --python 3.13 $(pwd)/script.py" \
  --out ./evidence
```

Notes on the invocation:

- `--target` is the **shell command** that the relay runs on the remote host.
  Because the relay and Gauntlet are on the same machine here, `$(pwd)` is
  fine; from a real remote host it would just be `uv run …`.
- `--adapter remote-cli` picks the new adapter wired through `src/cli/run.ts`.
- Relay URL + token are passed via env vars; `--relay-url` / `--relay-token`
  flags would work too.

### Result

Gauntlet reported **status: pass** with all four acceptance criteria met.

- 21 agent turns, 47.9s wall-clock.
- `evidence/result.json`, `evidence/result.md`, `evidence/run.jsonl` written.
- `run.jsonl` shows the clean sequence: `type "add buy milk"`, `press Enter`,
  `read_output`, …, ending with `type "quit"`, `press Enter`,
  two `read_output`s as the agent confirmed `todo> bye`.
- `screenshots/` is empty, as expected — no browser involved.

### Step 5 — cleanup

```bash
kill 11124   # relay pid
```

## Gotchas encountered

- **API keys weren't in the shell env.** Fixed by pulling them from
  `llm keys get openai` / `llm keys get claude` per the user's hint.
- **Background bash task semantics.** Starting the relay with both
  `run_in_background: true` and a `&` in the shell meant the wrapping task
  completed immediately while the bun process stayed up as an orphan. Had to
  grab the actual pid via `ps` to stop it afterwards.
- **Docker not actually used.** The user mentioned Docker was available but
  since `gauntlet` runs natively under Bun and the relay runs natively under
  Bun, there was no need to containerise for the demo. A real
  "Gauntlet-in-Docker → relay-on-host" setup would just swap
  `GAUNTLET_RELAY_URL` from `127.0.0.1:4466` to
  `host.docker.internal:4466` — the README's Docker block covers that.

## Files in this directory

```
remote-cli-demo/
  script.py        the Python CLI under test (TODO REPL)
  scenario.md      Gauntlet story card targeting script.py
  notes.md         this file
  evidence/
    result.json    structured verdict + token usage
    result.md      human-readable summary
    run.jsonl      action log (type/press/read_output timeline)
    screenshots/   empty — no browser in this adapter
```

