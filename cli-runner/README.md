# gauntlet-cli-runner

A Bun/TypeScript implementation of the Gauntlet **remote CLI relay** — a small HTTP service that spawns a subprocess on the host and proxies its stdio to a remote Gauntlet process (typically running in Docker).

The wire contract is defined in [`../docs/remote-cli.md`](../docs/remote-cli.md). This relay is a conforming reference implementation: any adapter written against that spec should work against it unchanged.

> ⚠️ **The relay is remote-code-execution behind a bearer token.** It spawns arbitrary shell commands on the host. Bind only to loopback unless you know what you're doing, rotate the token, and prefer `--allow-command` when you can.

---

## Contents

- [Install & run](#install--run)
- [Configuration](#configuration)
- [Running the tests](#running-the-tests)
- [Quickstart (curl)](#quickstart-curl)
- [Protocol reference](#protocol-reference)
  - [Transport](#transport)
  - [Session lifecycle](#session-lifecycle)
  - [`POST /start`](#post-start)
  - [`POST /stdin`](#post-stdin)
  - [`GET /output`](#get-output)
  - [`POST /close`](#post-close)
  - [`GET /health`](#get-health)
  - [Error envelope](#error-envelope)
- [Safety model](#safety-model)
- [Implementation notes](#implementation-notes)

---

## Install & run

Requires [Bun](https://bun.sh) ≥ 1.3.

```bash
cd cli-runner
bun install

# Start the relay (token is required):
export GAUNTLET_RELAY_TOKEN=$(openssl rand -hex 32)
bun run src/bin.ts
# => gauntlet-relay listening on http://127.0.0.1:4455 (auth: bearer token)
```

Or with explicit flags:

```bash
bun run src/bin.ts \
  --port 4455 \
  --bind 127.0.0.1 \
  --token "$(cat ~/.gauntlet-token)" \
  --allow-command '^(python|bun|node) '
```

`--help` prints the full flag list.

## Configuration

| Flag | Env var | Default | Purpose |
|---|---|---|---|
| `--port <n>` | `GAUNTLET_RELAY_PORT` | `4455` | TCP port |
| `--bind <addr>` | `GAUNTLET_RELAY_BIND` | `127.0.0.1` | Bind address. Anything other than `127.0.0.1` / `localhost` prints a warning at startup. |
| `--token <str>` | `GAUNTLET_RELAY_TOKEN` | *(required)* | Shared bearer token. Compared in constant time. |
| `--allow-command <regex>` | — | *(none)* | JS regex; `command` strings that do not match are rejected with `403 command_not_allowed`. |
| `--session-timeout <s>` | — | `300` | Seconds after a session terminates before its buffered output & exit code are garbage-collected. |
| `--max-body-bytes <n>` | — | `8388608` | Maximum request body size. Larger requests are rejected with `413`. |

## Running the tests

```bash
bun test
```

The suite is a black-box HTTP test of the server (`test/helpers.ts` spins up a fresh relay on an ephemeral port for each test). It exercises auth, every endpoint, the session state machine, stdout+stderr merging, long-polling, `max_bytes` truncation, SIGKILL escalation, and body-size limits.

---

## Quickstart (curl)

Full round-trip: spawn `python`, send a line on stdin, read its uppercased output, close.

```bash
GAUNTLET_RELAY_TOKEN=$(cat ~/.gauntlet-token)
BASE=http://127.0.0.1:4455
SID=$(uuidgen)

# 1. Spawn the subprocess.
curl -sS -X POST "$BASE/start" \
  -H "Authorization: Bearer $GAUNTLET_RELAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"session\":\"$SID\",
    \"command\":\"python3 -u -c 'print(input().upper())'\"
  }"
# => {"ok":true,"pid":31415}

# 2. Feed stdin. "hello\n" base64-encoded is "aGVsbG8K".
curl -sS -X POST "$BASE/stdin" \
  -H "Authorization: Bearer $GAUNTLET_RELAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"session\":\"$SID\",\"data\":\"aGVsbG8K\"}"
# => {"ok":true,"bytes_written":6}

# 3. Drain output, long-polling up to 2s.
curl -sS -H "Authorization: Bearer $GAUNTLET_RELAY_TOKEN" \
  "$BASE/output?session=$SID&wait_ms=2000"
# => {"data":"SEVMTE8K","exited":true,"exit_code":0,"truncated":false}
# echo SEVMTE8K | base64 -d  # → HELLO

# 4. Close (idempotent after natural exit).
curl -sS -X POST "$BASE/close" \
  -H "Authorization: Bearer $GAUNTLET_RELAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"session\":\"$SID\"}"
# => {"ok":true,"exit_code":0}
```

### Health check (no auth)

```bash
curl -sS http://127.0.0.1:4455/health
# => {"ok":true,"version":"0.1.0"}
```

### Typical client loop

An adapter keeps two things going concurrently:

1. A **read loop** that polls `GET /output?session=…&wait_ms=2000` in a background task, appending decoded bytes to an internal buffer and stopping once `exited:true` has been observed.
2. **Writes on demand**: every time the LLM / user decides to `type` or `press`, the adapter issues a single `POST /stdin`.

Both sides just need to handle `410 session_gone` (the child terminated or the session was GC'd) and the normal error envelope.

---

## Protocol reference

The authoritative spec is [`../docs/remote-cli.md`](../docs/remote-cli.md). This section summarises what the *server* actually does; differences from the spec are noted inline.

### Transport

- HTTP/1.1, no WebSockets.
- Request/response bodies are JSON (`Content-Type: application/json`), UTF-8.
- Raw stdio bytes are carried as **base64 strings** inside JSON so ANSI sequences and arbitrary binary data survive a JSON round-trip intact.
- Every endpoint except `GET /health` requires `Authorization: Bearer <token>`. Missing or wrong token → `401 unauthorized`.
- No CORS headers are set. The client is a server-side process, not a browser.

### Session lifecycle

A **session** is one child process, identified by a client-chosen opaque `session` string (UUID v4 recommended). The relay supports many concurrent sessions.

```
 (none) ── POST /start ──> running ── POST /close ──> closed
                              │
                              └── child exits ──> exited
```

- `running → exited` happens whenever the child exits on its own.
- `running → closed` is triggered by `POST /close` (with optional signal + grace period, then `SIGKILL` escalation).
- Once a session is terminated, `GET /output` may still be called to drain any remaining buffered bytes and to observe `exited:true` plus the final `exit_code`. Other endpoints referencing a terminated or unknown session return `410 session_gone`.
- Terminated sessions are kept in memory for `--session-timeout` seconds (default 300) so late drains still succeed, then they are garbage-collected. After GC, all references return `410`.

### `POST /start`

Spawn a subprocess and register the session.

**Request**

```json
{
  "session": "3f0a…",
  "command": "python my_cli.py --flag",
  "cwd": "/home/user/project",
  "env": { "FOO": "bar" }
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `session` | string | yes | Opaque client-chosen id. `409 session_exists` if reused. |
| `command` | string | yes | Always executed as `sh -c <command>`. No argv-array form — callers can rely on shell features (pipes, redirects, env expansion). Matches Gauntlet's local `CLIAdapter`. |
| `cwd` | string | no | Working directory. Must exist and be a directory or `400 bad_cwd`. Defaults to the relay's cwd. |
| `env` | object (string→string) | no | Extra env vars merged on top of the relay's environment. No keys are stripped. |

**Spawn semantics**

- `stdin`, `stdout`, `stderr` all piped. `stdout` and `stderr` are **merged** into a single byte stream in arrival order (the client has no way to distinguish them today; merging matches `CLIAdapter`).
- No PTY. Apps that require a TTY (e.g. `getpass` password prompts) may misbehave.
- The child is spawned with `detached:true`, giving it its own process group. Signals sent by `POST /close` are delivered to the whole group (`kill(-pgid, sig)`), falling back to the single-pid kill if the group signal fails.

**Response (200)**

```json
{ "ok": true, "pid": 12345 }
```

**Errors**

| Status | `error` | When |
|---|---|---|
| 400 | `bad_request` | Missing or invalid fields / invalid JSON. |
| 400 | `bad_cwd` | `cwd` does not exist or is not a directory. |
| 401 | `unauthorized` | Bad/missing token. |
| 403 | `command_not_allowed` | `--allow-command` regex did not match. |
| 409 | `session_exists` | Session id is already live. |
| 413 | `payload_too_large` | Request body exceeds `--max-body-bytes`. |
| 500 | `spawn_failed` | `sh` could not start the child. |

### `POST /stdin`

Write bytes to the child's stdin.

**Request**

```json
{ "session": "3f0a…", "data": "aGVsbG8K" }
```

- `data` is base64. Empty string is a legal no-op (`{"ok":true,"bytes_written":0}`).
- Bytes are written and flushed; no newline is appended.

**Response (200):** `{ "ok": true, "bytes_written": 6 }`.

**Errors**

| Status | `error` | When |
|---|---|---|
| 400 | `bad_request` | Missing `session`/`data` or not-a-string. |
| 410 | `session_gone` | Unknown session, child already exited, or stdin already closed. |
| 413 | `payload_too_large` | Request body exceeds `--max-body-bytes`. |

### `GET /output`

Drain buffered stdout+stderr bytes.

**Query parameters**

| Name | Type | Default | Notes |
|---|---|---|---|
| `session` | string | — | Required. |
| `wait_ms` | int | `0` | If the buffer is empty AND the child has not exited, block up to this many ms for new bytes. Clamped to `[0, 30000]`. |
| `max_bytes` | int | `1048576` (1 MiB) | Cap on bytes returned in this single call. Remainder stays buffered. |

**Response (200)**

```json
{
  "data": "SGVsbG8sIHdvcmxkIQo=",
  "exited": false,
  "exit_code": null,
  "truncated": false
}
```

- `data` — base64 bytes, drained from the buffer. May be empty.
- `exited` — `true` once the child has terminated **and** the buffer has been fully drained in *this* response (so clients can rely on "one final `exited:true`" after they have seen all output).
- `exit_code` — integer when `exited:true`, else `null`. Signal deaths are reported as `-1` (this relay does not split into a separate `signal` field; it matches the "`-signal`-ish" sentinel described as an option in the spec).
- `truncated` — `true` if `max_bytes` capped the response.

**Semantics**

- Reads are destructive: bytes returned in one call will not be returned again.
- When `wait_ms > 0`, the call returns as soon as *any* byte arrives, the child exits, or the timeout elapses — whichever happens first.
- Calls after the child exits and the buffer is drained keep returning `200 {data:"", exited:true, exit_code:N}` until the session is GC'd, after which they return `410 session_gone`.

**Errors**

| Status | `error` | When |
|---|---|---|
| 400 | `bad_request` | Missing `session`. |
| 401 | `unauthorized` | Bad/missing token. |
| 410 | `session_gone` | Unknown or garbage-collected session. |

### `POST /close`

Terminate the child and release the session. Idempotent: calling `/close` on an already-exited session returns the recorded exit code without doing anything.

**Request**

```json
{ "session": "3f0a…", "signal": "SIGTERM", "grace_ms": 2000 }
```

| Field | Type | Default | Notes |
|---|---|---|---|
| `session` | string | — | Required. |
| `signal` | string | `SIGTERM` | Must be one of `SIGTERM`, `SIGINT`, `SIGKILL`, `SIGHUP`. Any other value → `400 bad_request`. |
| `grace_ms` | int | `2000` | Max wait after the initial signal before escalating to `SIGKILL`. Clamped to `[0, 30000]`. |

Sequence: send `signal` to the child's process group → wait up to `grace_ms` for exit → if still alive, send `SIGKILL` to the group and wait up to 2s more.

**Response (200):** `{ "ok": true, "exit_code": 0 }`. `exit_code` is the recorded exit code (or `-1` for signal deaths; `null` only if the kill path failed and no code was ever observed).

**Errors**

| Status | `error` | When |
|---|---|---|
| 400 | `bad_request` | Missing `session` or invalid `signal`. |
| 410 | `session_gone` | Unknown or garbage-collected session. |

### `GET /health`

Unauthenticated liveness probe.

```json
{ "ok": true, "version": "0.1.0" }
```

No session info is exposed.

### Error envelope

All non-2xx responses share a single JSON shape:

```json
{ "error": "<machine_readable_code>", "message": "human readable detail" }
```

Clients should key off `error` and treat unknown codes as generic failures.

---

## Safety model

- **Bearer token** is compared with `crypto.timingSafeEqual`. Missing, malformed, or wrong-length tokens all fail identically.
- **Default bind is `127.0.0.1`.** Binding elsewhere requires passing a non-loopback `--bind`/`GAUNTLET_RELAY_BIND`; the startup log prints a warning that the relay is remote-shell-equivalent.
- **TLS is out of scope.** If you expose the relay off-host, put it behind an HTTPS-terminating reverse proxy.
- **Command allowlist** (`--allow-command <regex>`) is recommended whenever you know the shape of commands the client will send. Non-matching commands get `403 command_not_allowed` before any process is spawned.
- **Body-size limit** (`--max-body-bytes`, default 8 MiB) is enforced both via `Content-Length` (fast-reject) and after-read. Oversized requests get `413 payload_too_large`.
- **Rate limiting / concurrency caps** are not implemented — the relay assumes a cooperative single client per token.

## Implementation notes

- Server: `src/server.ts` — a single `createServer(opts)` that returns `{ port, stop() }`, built on `Bun.serve` for the HTTP layer and `node:child_process` for spawning (so we get `detached:true` process groups and can `process.kill(-pgid, sig)`).
- CLI entrypoint: `src/bin.ts` — flag parsing, env fallback, non-loopback warning, SIGINT/SIGTERM clean shutdown.
- Tests: `test/*.test.ts` — every test boots a fresh server on an ephemeral port via `withServer(...)` in `test/helpers.ts`. No mocks: every assertion goes through real HTTP.
- The escalation test uses `perl -e '$SIG{TERM}="IGNORE"; sleep 30'` rather than a shell `trap`, because `sh -c '<single command>'` commonly `exec`s into the child and loses the shell-level trap.
