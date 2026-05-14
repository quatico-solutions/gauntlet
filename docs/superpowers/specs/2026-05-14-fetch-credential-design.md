---
title: fetch_credential — caller-provided runtime credential resolver
date: 2026-05-14
status: proposed (v2 — rewritten after spec review against real code)
author: Lirael@36bd0b63
reviewer: Marlow@e912f4e3
---

# fetch_credential — caller-provided runtime credential resolver

## Problem

Gauntlet handles three credential paths today (`docs/credentials.md`):
username/password (described in a profile's prose and typed by the
agent), `install_cookies` (YAML cookies installed via CDP), and
`install_passkey` (JSON credential installed into Chrome's virtual
authenticator). All three work because the secret is *static at run
time* — it lives on disk and the agent or the install tool reads it.

A real class of sign-in flows is not static at run time:

- **One-time passwords** (TOTP, SMS, email codes) — rotate or arrive
  out-of-band.
- **Invite codes / signup verification codes** — single-use, issued at
  the moment of need.
- **Magic links** — URLs minted on demand.

In dev environments, Gauntlet authors point the agent at an
InBucket-style web inbox; the agent reads the message and extracts the
value. In customer CI / locked-down staging, that web surface often
doesn't exist. The workaround has been prefilling viable tokens into
profiles — fragile (tokens expire, get consumed, rotate) and
embarrassing to recommend.

## Approach

A new built-in agent tool, `fetch_credential(profile, key) → markdown`,
backed by a caller-provided executable. The tool is registered with the
agent only when **both** `contextRootIsPopulated(contextRoot)` *and*
`GAUNTLET_CREDENTIAL_RESOLVER` is set to the path of an executable.
Otherwise the tool is invisible and runs proceed exactly as they do
today.

### Why a tool, not a fixture file

A file on disk is read once at run start. OTPs valid for thirty
seconds, invite codes that burn on first use, and magic links minted
per attempt all need to be fetched *at the moment the agent presents
them to the site*. That requires a callable surface, not a file.

### Why caller-provided, not built-in

The thing that produces an OTP, an invite code, or a magic link is the
caller's auth system — an IMAP scrape, an admin API call, a database
query against the test DB, whatever they already have. Gauntlet has no
business knowing which one. The resolver is a one-line script the
caller writes against their own machinery.

### Why a divergent argument shape from `install_*`

The existing `install_cookies` and `install_passkey` tools take a
single `path: string` argument relative to `.gauntlet/context/`. That
shape exists because those tools *read a file off disk*. `fetch_credential`
does not read a file — it invokes an external process. Its arguments
describe *what to ask the resolver for*, not where to read from.
`profile` matches the profile-directory convention used by the existing
tools (`alice/passkey.yaml` lives under a profile named `alice`); `key`
is a short string identifying the credential within that profile's
ephemeral set. The divergence from the path-shape is intentional and
load-bearing.

## Contract

### Tool surface (agent-facing)

```
fetch_credential
  profile: string  — profile name (e.g. "alice")
  key:     string  — name of the credential being requested (e.g. "otp")
  returns: markdown string (the resolver's stdout)

  Registered only when:
    contextRootIsPopulated(contextRoot)
      AND GAUNTLET_CREDENTIAL_RESOLVER is set and points to an
          executable regular file
```

The tool description tells the agent: *fetch ephemeral credentials
that cannot live in a static profile (OTPs, invite codes, magic
links). The profile's `profile.md` (under `.gauntlet/context/<profile>/`,
read it with the `read` tool) declares which `key` values are available
— read the profile first.*

This anchors discovery on the existing context-tree + `read` flow.
The system-prompt context tree shown at turn 0 lists every profile
directory; the agent reads `<profile>/profile.md` with the `read` tool
to learn what's askable; then it calls `fetch_credential`.

### Resolver invocation (caller-facing)

Gauntlet invokes the configured executable per tool call:

```
$ "$GAUNTLET_CREDENTIAL_RESOLVER" <profile> <key>
```

Two positional argv arguments, no JSON, no stdin payload. Resolver
writes markdown to stdout. Exit 0 = success. Non-zero exit = failure;
stderr is captured and shown to the agent as the tool result.

Example resolver, in any language:

```bash
#!/usr/bin/env bash
# fixture-credential.sh — caller-provided
set -euo pipefail
case "$1:$2" in
  alice:otp)
    oathtool --totp -b "$ALICE_TOTP_SECRET"
    ;;
  alice:signup_verification)
    psql "$TEST_DB" -tAc "SELECT code FROM email_codes WHERE email = 'alice@example.test' ORDER BY id DESC LIMIT 1"
    ;;
  *)
    echo "No credential '$2' known for '$1'" >&2
    exit 2
    ;;
esac
```

### Process semantics

- **Spawn:** `child_process.spawn(resolverPath, [profile, key], { detached: false, stdio: ["ignore", "pipe", "pipe"] })`. No shell interpolation; `profile` and `key` go in as argv after validation.
- **Timeout cascade:** at `GAUNTLET_CREDENTIAL_RESOLVER_TIMEOUT_MS` (default 10_000), send `SIGTERM`. After a fixed 2-second grace, if the process is still alive, send `SIGKILL`. The tool result reports the timeout regardless of how the kill landed.
- **No process group:** the resolver is expected to be a leaf process. If it spawns its own children, they're its problem — Gauntlet does not chase grandchildren. The resolver protocol is "a script that prints and exits quickly"; processes that need to fork/exec are outside the protocol's contract.
- **Stdout cap:** 64 KiB. If the resolver writes more, Gauntlet aborts the read, kills the process, and reports `stdout_overflow` as a failure step. Credentials don't need a megabyte of markdown; the cap is a safety net.
- **Stderr cap:** 8 KiB. Same overflow semantics for stderr surfacing.
- **Concurrency:** two simultaneous tool calls each spawn their own subprocess. No mutex. Resolvers that have race conditions are the caller's bug.

### Argument validation

- `profile`: same shape as a profile-directory name. Reject `/`, `\`, `..`, leading `.`. Empty rejected. (Mirrors `resolveInside` semantics — even though we're not using it for filesystem indexing, identical validation keeps the agent's mental model coherent: profile names are profile names.)
- `key`: `^[a-zA-Z0-9_-]{1,64}$`. Empty rejected, length-capped. Narrow enough to avoid surprising shell semantics in any resolver implementation regardless of how the caller wrote it.

Validation failures fail before the resolver is invoked; the tool result names the offending argument and the rule it violated.

### Failure surface to agent

Every failure mode produces a tool result the agent can read. No silent failures.

| Step (action-log label) | Cause | Tool result body |
|---|---|---|
| `validate_args` | empty / malformed `profile` or `key` | `Error: fetch_credential argument "<name>" rejected: <rule>.` |
| `spawn` | exec failed (ENOENT, EACCES, etc.) | `Error: fetch_credential resolver failed to spawn: <errno>.` |
| `timeout` | SIGTERM/SIGKILL cascade fired | `Error: fetch_credential resolver timed out after <ms>ms for <profile>:<key>.` |
| `nonzero_exit` | resolver exited with non-zero status | `Error: fetch_credential resolver exited <code> for <profile>:<key>:\n<stderr>` |
| `empty_stdout` | exit 0 but no stdout bytes | `Error: fetch_credential resolver returned empty success for <profile>:<key>.` |
| `stdout_overflow` | resolver wrote > 64 KiB | `Error: fetch_credential resolver stdout exceeded 64 KiB for <profile>:<key>.` |

These are the only failure modes. Success returns the resolver's stdout verbatim as the tool result body.

### Secrets handling

Matches the lengths-only pattern from `install_cookies` / `install_passkey`.

- **Live agent context** receives the full resolver stdout — the agent must type or paste the value.
- **Evidence log (`run.jsonl`, action log)** records `fetch_credential_ok` events with: `profile`, `key`, `exitCode: 0`, `stdoutLength`, `stderrLength`, `elapsedMs`. Never the stdout bytes. `fetch_credential_failed` events add `step` (one of the labels above) and `error` (the bounded message). Mirrors `credentialContext()` in `passkey.ts:129`.
- **Transcripts and exported run artifacts** redact the resolver stdout by default. The redacted marker reads `<credential redacted: profile=<p> key=<k> len=<n>>` and is what session revival sees.
- **Opt-in reveal:** `GAUNTLET_CREDENTIAL_INCLUDE_IN_TRANSCRIPTS=1` (parsed via the existing `parseBoolEnv` in `config.ts`) keeps the stdout bytes in transcripts. Off by default. Intended for local debugging only; not safe to set in shared CI.

### Lifecycle

- **No caching.** Each tool call invokes the resolver fresh. Callers whose credentials are single-use issue a new one each call; callers whose credentials rotate read the current value each call. Caching policy lives entirely on the caller's side of the boundary.
- **No setup call.** The tool is purely on-demand. There is no pre-warm at run start.
- **No teardown.** The resolver is a stateless subprocess. Contrast `install_passkey` which has `teardown()` to close its pinned WebAuthn session — `fetch_credential` has no analogous state.

### Session revival

Per `docs/session-revival-spec.md`, revival operates over `run.jsonl`. Because the evidence log carries only the redacted summary (`profile`, `key`, lengths, exit code, elapsed), revival shows the redacted marker (`<credential redacted: profile=alice key=otp len=6>`) in place of the resolver stdout. This is true for all three revival modes: snapshot Q&A reports the marker; deterministic re-execution cannot replay (the original resolver invocation is gone, and the credential it produced is either consumed, rotated, or stale — revival should not attempt to re-invoke the resolver); counterfactual branch likewise sees the marker.

If a user set `GAUNTLET_CREDENTIAL_INCLUDE_IN_TRANSCRIPTS=1` at run time, the transcript retains the value and revival sees it — at the user's stated risk.

This is the only durable-state interaction worth documenting; resolvers don't write to disk and don't participate in any other Gauntlet subsystem.

## Configuration surface

Three new env-var knobs, following the `GAUNTLET_*` pattern in `src/config.ts`:

| Env var | Default | Purpose |
|---|---|---|
| `GAUNTLET_CREDENTIAL_RESOLVER` | unset | Path to caller-provided executable. When unset, the tool is not registered. Relative paths are resolved against `projectRoot`. |
| `GAUNTLET_CREDENTIAL_RESOLVER_TIMEOUT_MS` | `10000` | Per-invocation timeout. Validated via `parseNonNegIntEnv`. |
| `GAUNTLET_CREDENTIAL_INCLUDE_IN_TRANSCRIPTS` | `0` | Boolean. Validated via `parseBoolEnv`. |

`AppConfig` gains a `credentialResolver?: { path: string; timeoutMs: number; includeInTranscripts: boolean }` field, populated by `loadConfig`. Absent when the env var is unset.

At load time, `loadConfig` resolves the path (relative to `projectRoot`), `stat`s it, and verifies it is a regular file with at least one execute bit set in `mode`. Failure throws a clean boot-time error — same shape as the existing errors in `loadConfig`. Shallow on purpose: no PATH lookup, no interpreter validation; we catch obvious misconfigurations at the CLI, not vouch for resolver behavior.

## Code surface

| File | Change |
|---|---|
| `src/context/credential-tool.ts` | **NEW.** Exports `runResolver(config, profile, key): Promise<ResolverResult>` (pure subprocess invocation with timeout, output caps, and structured result) and `buildFetchCredentialTool(contextRoot, resolverConfig, logger): CredentialTool \| null`. Returns `null` when `contextRootIsPopulated(contextRoot)` is false OR `resolverConfig` is undefined. Mirrors the shape of `src/context/read-tool.ts` (adapter-agnostic), with logger pattern from `src/adapters/web/passkey.ts:144`. |
| `src/adapters/web/adapter.ts` | Splice `fetch_credential` next to the existing `buildReadTool` / `buildInstallPasskeyTool` / `buildInstallCookiesTool` calls. Pass `options.credentialResolver`. Dispatch in `executeTool` next to existing tools. |
| `src/adapters/cli/adapter.ts` | Same splice. Pass `options.credentialResolver`. Web-only details (CDP) don't apply, but `fetch_credential` is adapter-agnostic — the CLI agent can also drive flows that need OTPs. |
| `src/adapters/tui/adapter.ts` | Same. |
| `src/config.ts` | Add three env vars and the validation block. Populate `credentialResolver` on `AppConfig`. Add `credentialResolver: "default" \| "env"` to `sources`. |
| `src/cli/run.ts`, `src/api/routes/run.ts` | Thread `config.credentialResolver` into the adapter options. |
| `docs/credentials.md` | Add a fourth section, `fetch_credential`, describing the resolver protocol, profile-declaration convention, secrets-handling guarantees, and example resolver. Cross-link from the username/password section. |

| Test file | Coverage |
|---|---|
| `test/context/credential-tool.test.ts` | `runResolver` covers: success, non-zero exit, empty-stdout-with-exit-0, timeout cascade (SIGTERM → grace → SIGKILL via a slow fake resolver), stdout overflow, stderr overflow, spawn failure (ENOENT). `buildFetchCredentialTool` covers: null return when contextRoot empty, null return when resolverConfig missing, tool definition has correct parameter schema, validate_args rejects each forbidden char in `profile` and bad `key`, execute returns markdown on success, execute returns each documented error shape on failure, action-log events emit with correct step labels and lengths-not-bytes. |
| `test/adapters/web/adapter.test.ts` | `fetch_credential` omitted when `credentialResolver` is undefined; registered when present. |
| `test/adapters/{cli,tui}/adapter.test.ts` | Same registration check. |
| `test/cli/run.test.ts` (and api equivalent) | `loadConfig` rejects an unreadable / non-executable resolver path at boot with a clear error. |
| `test/fixtures/fake-credential-resolver.sh` | Small canned resolver, used by the integration test. |
| Integration test | Agent run against a fixture web app exercising an OTP gate. Verifies: tool registered, argv shape correct, resolver stdout reaches the agent, action-log records length-only context, transcript redacts by default, transcript reveals when env var set. |

No changes to `src/agent/prompts.ts` or `src/agent/agent.ts` — the tool self-documents via its description, matching every other tool in the system.

## Non-goals

- **General caller-provided-tool extension surface.** This is one tool for one specific annoying case. If a second use case for caller-provided tools appears, design it then. The shape of the second use case will tell us whether to extract a general mechanism.
- **Identity provisioning or selection.** The resolver looks up or produces credentials for identities the caller has already arranged. Creating new identities, choosing which identity to use, or rotating identities on the agent's behalf are all out of scope.
- **Structured credential return.** The resolver returns markdown. The agent parses it the same way it parses the `## Credentials` block in `profile.md` today. A structured JSON return surface would be a bigger change and is not justified.
- **Resolver as MCP server.** Subprocess via argv+stdout is the entire protocol. MCP-shaped resolvers can be exposed by a one-line wrapper script if needed; Gauntlet does not learn MCP for this.
- **Process-group lifecycle / grandchild reaping.** The resolver protocol is "leaf script that prints and exits." Resolvers that fork their own subprocesses are outside the contract.

## Open questions

1. **Tool description prose** — the existing `install_*` tool descriptions reference "Gauntlet v1.5 spec §3.X" and have a §13 amendment protocol noted in code comments. Does `fetch_credential`'s description text need to land in that spec doc as well, or does adding it to `docs/credentials.md` suffice? Implementer to confirm during planning.
2. **CLI / TUI adapter coverage** — `read` is registered on all three adapters; `install_passkey` / `install_cookies` are web-only because they need CDP. `fetch_credential` has no browser dependency, so registering on all three matches the `read` pattern. Worth a sanity check that there's a CLI/TUI use case for OTPs in practice; if not, web-only is a defensible default and saves three lines of wiring.
3. **Resolver-side logging vs. evidence log conflict** — if a caller's resolver writes verbose stderr on success (e.g., for their own debugging), Gauntlet currently captures and discards it on the success path. Should successful-but-noisy stderr land somewhere viewable (the evidence log with length only, like stdout)? Cheap to add; deferring unless the implementer hits a real case.
