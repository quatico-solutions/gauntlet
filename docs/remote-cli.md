# Remote CLI relay -- server spec

This document specifies the **host-side relay server** that `RemoteCLIAdapter` (inside a Gauntlet process, typically running in Docker) talks to in order to drive a CLI subprocess on a different machine.

The spec is written so that someone can build the server without knowing Gauntlet internals. The client (adapter) is described only where it affects the wire contract.

## 1. Overview

```
 ┌──────────────────────────┐   HTTP    ┌─────────────────────────┐
 │  Gauntlet (client)       │ ────────> │  Relay server (this)    │
 │  RemoteCLIAdapter        │ <──────── │  spawns & proxies a CLI │
 └──────────────────────────┘           └─────────────────────────┘
                                                    │
                                                    ▼
                                           ┌────────────────┐
                                           │ target process │
                                           │ (e.g. python)  │
                                           └────────────────┘
```

- The relay is a long-lived HTTP service.
- A **session** represents one subprocess. It is created by `POST /start`, stdio is exchanged via `POST /stdin` + `GET /output`, and it is torn down by `POST /close` (or when the process exits on its own).
- All traffic is stateless HTTP; no WebSockets required. `GET /output` long-polls to keep latency low.
- The relay spawns arbitrary shell commands on the host. Treat it as remote code execution behind a bearer token.

## 2. Transport

- HTTP/1.1, JSON request/response bodies (`Content-Type: application/json`), UTF-8.
- Binary stdio is carried as **base64-encoded strings** inside JSON so raw bytes and ANSI escape sequences survive intact.
- All endpoints require `Authorization: Bearer <token>`. Missing or wrong token → `401 Unauthorized` with `{"error":"unauthorized"}` and no other side effects.
- Default bind: `127.0.0.1`. Binding to a non-loopback address MUST require an explicit flag and SHOULD log a warning on startup.
- CORS is not required (the client is a server-side process, not a browser). Do not set permissive CORS headers.

## 3. Session model

- A session is identified by a `session` string chosen by the client. The server MUST treat it as an opaque identifier. Recommended format: UUID v4.
- A single relay MAY host multiple sessions concurrently. An implementation MAY restrict to one session at a time and return `409 Conflict` on the second `POST /start`; this restriction MUST be documented in the relay's startup logs or `--help`.
- Session state machine:

  ```
   (none) ── POST /start ──> running ── POST /close ──> closed
                                │
                                └── child exits ──> exited
  ```

- Once a session is `closed` or `exited`, any further request that references it (other than `GET /output`, which may still drain the final buffer) MUST return `410 Gone` with `{"error":"session_gone"}`.
- `GET /output` on a terminated session returns any remaining buffered bytes and `exited: true` with the exit code, then continues to return `exited: true` with empty data until the session id is garbage-collected.
- Sessions SHOULD be garbage-collected from memory after a configurable idle timeout (default: 300s after termination).

## 4. Endpoints

All endpoints are under a configurable path prefix (default: `/`). Examples below assume the relay is reachable at `http://host:4455`.

### 4.1 `POST /start`

Create a new session and spawn a subprocess.

**Request body:**

```json
{
  "session": "3f0a…",
  "command": "python my_cli.py --flag",
  "cwd": "/home/user/project",
  "env": { "FOO": "bar" }
}
```

- `session` (required, string): client-chosen session id. If already in use, return `409 Conflict` with `{"error":"session_exists"}`.
- `command` (required, string): shell command line. The relay MUST execute this via `sh -c <command>` (or the platform equivalent). **No argv-array form is supported** -- this matches Gauntlet's local `CLIAdapter` and lets callers rely on shell features (pipes, redirections, env expansion).
- `cwd` (optional, string): working directory. If omitted, use the relay's cwd. If the directory does not exist, return `400 Bad Request` with `{"error":"bad_cwd"}`.
- `env` (optional, object of string→string): extra env vars merged on top of the relay's environment. Keys matching `PATH` and `HOME` MAY be stripped for safety; document whatever policy the relay picks.

**Spawn semantics:**

- `stdin`, `stdout`, `stderr` all piped. `stdout` and `stderr` are **merged** into a single byte stream in arrival order. (The client has no way to distinguish them today; merging matches `CLIAdapter`.)
- No PTY allocation. Apps requiring a TTY (e.g. password prompts via `getpass`) may not behave as expected. Callers are warned in the Gauntlet README.
- The process group SHOULD be the child's own, so the relay can signal it without affecting itself.

**Response (200):**

```json
{
  "ok": true,
  "pid": 12345
}
```

**Errors:**

| Status | `error` value | When |
|--------|---------------|------|
| 400 | `bad_request` | Missing/invalid fields |
| 400 | `bad_cwd` | `cwd` does not exist |
| 401 | `unauthorized` | Bad/missing token |
| 403 | `command_not_allowed` | `--allow-command` regex did not match (see §6) |
| 409 | `session_exists` | Session id already in use |
| 500 | `spawn_failed` | `sh` could not start the child |

### 4.2 `POST /stdin`

Write bytes to the subprocess's stdin.

**Request body:**

```json
{
  "session": "3f0a…",
  "data": "aGVsbG8K"
}
```

- `session` (required).
- `data` (required, base64 string): raw bytes to write. Empty string is legal (no-op).

The relay writes the decoded bytes to the child's stdin and flushes. It MUST NOT append a newline. If the child's stdin has been closed (e.g. child exited), return `410 Gone`.

**Response (200):** `{"ok": true, "bytes_written": 6}`.

### 4.3 `GET /output`

Drain buffered stdout/stderr bytes.

**Query parameters:**

- `session` (required): session id.
- `wait_ms` (optional, integer, default `0`, max `30000`): if the buffer is currently empty AND the child has not exited, block for up to this many milliseconds waiting for new bytes before returning. `0` means "return immediately with whatever is buffered (possibly empty)".
- `max_bytes` (optional, integer, default `1048576` = 1 MiB): cap the number of bytes returned in this call. Further bytes remain buffered.

**Response (200):**

```json
{
  "data": "SGVsbG8sIHdvcmxkIQo=",
  "exited": false,
  "exit_code": null,
  "truncated": false
}
```

- `data`: base64-encoded bytes drained from the buffer. May be empty.
- `exited`: true once the child has terminated AND the buffer has been fully drained in this response.
- `exit_code`: integer once `exited` is true; `null` otherwise. Use `-signal` convention for signaled exits (e.g. `-15` for SIGTERM) or a separate `signal` field -- document whichever the relay picks.
- `truncated`: true if `max_bytes` was reached and more bytes remain buffered.

**Semantics:**

- The buffer is drained on read -- bytes returned from one call will not be returned again.
- Long-polling: if `wait_ms > 0` and the buffer is empty and the child is still running, hold the request open until either a byte arrives, the child exits, or `wait_ms` elapses, whichever happens first. Return immediately after any of those conditions.
- Calls after child exit and full drain continue to succeed (200) with empty `data` and `exited: true` until the session is garbage-collected, after which they return `410 Gone`.

### 4.4 `POST /close`

Terminate the subprocess and release the session.

**Request body:**

```json
{
  "session": "3f0a…",
  "signal": "SIGTERM",
  "grace_ms": 2000
}
```

- `session` (required).
- `signal` (optional, string, default `SIGTERM`): signal to send first. Must be one of `SIGTERM`, `SIGINT`, `SIGKILL`, `SIGHUP`.
- `grace_ms` (optional, integer, default `2000`, max `30000`): after sending the initial signal, wait up to this long for the process to exit, then send `SIGKILL`.

**Response (200):** `{"ok": true, "exit_code": 0}` (the final exit code; `null` if kill path taken and code unavailable).

`POST /close` on a session whose child has already exited is a no-op and returns 200 with the recorded exit code.

### 4.5 `GET /health`

Unauthenticated liveness probe. Returns `200 OK` with `{"ok":true,"version":"…"}`. No session info.

## 5. Error envelope

All non-2xx responses use the same JSON shape:

```json
{ "error": "<machine_readable_code>", "message": "human-readable detail" }
```

The `error` codes used by this spec are listed per-endpoint above. Additional codes MAY be introduced; clients MUST treat unknown codes as generic failures.

## 6. Authentication & safety

- **Bearer token**: the relay is started with a token (flag or env var, e.g. `GAUNTLET_RELAY_TOKEN`). Every request except `GET /health` MUST carry `Authorization: Bearer <token>`. Compare with a constant-time comparison.
- **Bind address**: default `127.0.0.1`. Binding elsewhere requires `--bind <addr>` and SHOULD print a warning that the relay is remote-shell-equivalent.
- **Command allowlist** (optional but recommended): `--allow-command <regex>` restricts what `command` strings may be passed to `POST /start`. Non-matching requests return `403 command_not_allowed`.
- **TLS**: out of scope for v1. If exposing beyond loopback, run behind an HTTPS-terminating reverse proxy.
- **Rate limiting / concurrency caps**: out of scope for v1, but the relay SHOULD refuse absurd requests (e.g. `data` larger than a configurable limit, default 8 MiB) with `413 Payload Too Large`.

## 7. Configuration

Minimum set of flags the relay MUST support:

| Flag | Env var | Default | Purpose |
|------|---------|---------|---------|
| `--port <n>` | `GAUNTLET_RELAY_PORT` | `4455` | TCP port |
| `--bind <addr>` | `GAUNTLET_RELAY_BIND` | `127.0.0.1` | Bind address |
| `--token <str>` | `GAUNTLET_RELAY_TOKEN` | *(required)* | Shared secret |
| `--allow-command <regex>` | -- | *(none)* | Optional command allowlist |
| `--session-timeout <s>` | -- | `300` | GC idle timeout for terminated sessions |
| `--max-body-bytes <n>` | -- | `8388608` | Reject oversized request bodies |

Startup log should print bind address, whether auth is required (it always is), and whether an allowlist is active.

## 8. Example session (curl)

```bash
TOKEN=$(cat ~/.gauntlet-token)
SID=$(uuidgen)
BASE=http://localhost:4455

# 1. spawn
curl -sS -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -X POST "$BASE/start" \
  -d "{\"session\":\"$SID\",\"command\":\"python -u -c 'print(input().upper())'\"}"
# => {"ok":true,"pid":31415}

# 2. feed stdin ("hello\n" -> base64)
curl -sS -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -X POST "$BASE/stdin" \
  -d "{\"session\":\"$SID\",\"data\":\"aGVsbG8K\"}"
# => {"ok":true,"bytes_written":6}

# 3. read output, wait up to 2s
curl -sS -H "Authorization: Bearer $TOKEN" \
  "$BASE/output?session=$SID&wait_ms=2000"
# => {"data":"SEVMTE8K","exited":true,"exit_code":0,"truncated":false}

# 4. close (idempotent after natural exit)
curl -sS -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -X POST "$BASE/close" \
  -d "{\"session\":\"$SID\"}"
# => {"ok":true,"exit_code":0}
```

## 9. Client behavior the server can assume

Informational -- the adapter, not the relay, enforces these. They explain the traffic pattern the relay will see.

- The client issues exactly one `POST /start` per session.
- The client calls `GET /output` in a background loop with `wait_ms` in the 1–5s range, appending decoded bytes to an internal buffer.
- The client calls `POST /stdin` whenever the LLM uses the `type` or `press` tool.
- The client calls `POST /close` on scenario completion, including on failure paths.
- The client does not expect ordering guarantees between concurrent `POST /stdin` and `GET /output` beyond "bytes written before a request are visible to it."

## 10. Out of scope for v1

- PTY allocation / terminal size reporting.
- Separate stdout/stderr channels.
- File upload/download alongside a session.
- Multiple concurrent sessions in the reference implementation (the protocol supports it; the first shipped relay MAY be single-session).
- TLS, OAuth, or any auth beyond a static bearer token.
- WebSocket or SSE transport. (If added later, it MUST live under a new path like `/ws` and coexist with the HTTP API.)

## 11. Reference implementations

Gauntlet ships reference relays under `relay/`:

- `relay/gauntlet-relay.py` -- Python 3 (stdlib only), single-session, suitable for dev workstations.
- `relay/gauntlet-relay.sh` -- bash + `jq` + named FIFOs, for hosts without Python.

Both are conformance-tested against the same black-box test suite (`test/relay/conformance.ts`). A third-party relay that passes the suite is a drop-in replacement.
