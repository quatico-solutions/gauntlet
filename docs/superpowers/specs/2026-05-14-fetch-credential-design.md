---
title: fetch_credential — caller-provided runtime credential resolver
date: 2026-05-14
status: proposed
author: Lirael@36bd0b63
---

# fetch_credential — caller-provided runtime credential resolver

## Problem

Gauntlet handles three credential paths today (`docs/credentials.md`):
username/password (read from `profile.md` and typed by the agent),
`install_cookies` (YAML cookies installed via CDP), and `install_passkey`
(JSON credential installed into Chrome's virtual authenticator). Each of
these works because the secret is *static at run time* — it lives on disk
and the agent or the install tool reads it.

A whole class of real-world sign-in flows is not static at run time:

- **One-time passwords (TOTP, SMS, email codes).** The current value
  rotates or is delivered out-of-band.
- **Invite codes / signup verification codes.** Single-use, issued at
  the moment of need.
- **Magic links.** A URL minted on demand and delivered out-of-band.

In dev environments, Gauntlet authors work around this by pointing the
agent at an InBucket-style web inbox; the agent reads the message and
extracts the value. In customer CI / locked-down staging, that surface
often doesn't exist. The workaround has been prefilling viable tokens
into profiles — fragile (tokens expire, get consumed, rotate) and
embarrassing to recommend.

## Approach

A new built-in agent tool, `fetch_credential(who, what) → markdown`,
backed by a caller-provided executable. The tool is registered with the
agent only when the caller sets `GAUNTLET_CREDENTIAL_RESOLVER` to the
path of an executable; otherwise the tool is invisible and runs proceed
exactly as they do today.

Static `.gauntlet/context/profiles/<name>.md` files remain the canonical
description of each character (existing `read_profile` flow). The new
tool is exclusively for the ephemeral pieces a static file cannot
represent.

### Why a tool, not a fixture file

A `.txt` or `.yaml` on disk is read once at run start. OTPs that valid
for thirty seconds, invite codes that burn on first use, and magic
links minted per attempt all need to be fetched *at the moment the
agent presents them to the site*. That requires a callable surface, not
a file.

### Why caller-provided, not built-in

The thing that produces an OTP, an invite code, or a magic link is the
caller's auth system — an IMAP scrape, an admin API call, a database
query against the test DB, whatever they already have. Gauntlet has no
business knowing which one. The resolver is a one-line script the
caller writes against their own machinery.

## Contract

### Tool surface (agent-facing)

```
fetch_credential
  who:  string  — profile name (matches a file in .gauntlet/context/profiles/)
  what: string  — name of the credential being requested (e.g. "otp")
  returns: markdown string

  registered only when GAUNTLET_CREDENTIAL_RESOLVER is set and the
  target path is executable; absent otherwise.
```

The tool description tells the agent: *fetch ephemeral credentials
that cannot live in a static profile (OTPs, invite codes, magic
links). The profile for `who` lists which `what` values are valid;
read the profile first.*

### Resolver invocation (caller-facing)

Gauntlet invokes the configured executable per tool call:

```
$ "$GAUNTLET_CREDENTIAL_RESOLVER" <who> <what>
```

Two positional argv arguments, no JSON, no stdin payload. Resolver
writes markdown to stdout. Exit 0 = success. Non-zero exit = failure;
stderr is captured and shown to the agent as the tool result.

Gauntlet imposes a 10-second timeout by default. Override via
`GAUNTLET_CREDENTIAL_RESOLVER_TIMEOUT_MS`.

Example resolver, in any language:

```bash
#!/usr/bin/env bash
# fixture-credential.sh — caller-provided
set -euo pipefail
case "$1:$2" in
  fred:otp)
    oathtool --totp -b "$FRED_TOTP_SECRET"
    ;;
  fred:signup_verification)
    psql "$TEST_DB" -tAc "SELECT code FROM email_codes WHERE email = 'fred@example.test' ORDER BY id DESC LIMIT 1"
    ;;
  *)
    echo "No credential '$2' known for '$1'" >&2
    exit 2
    ;;
esac
```

### Profile declaration (convention, not validation)

Profile authors document what's askable directly in `profile.md`:

```markdown
# Fred

Test user for the signup-and-onboarding flow.

## Credentials
- Username: fred@example.test

## Available via fetch_credential
- `otp` — current login OTP (TOTP, 30-second window)
- `signup_verification` — code emailed at account creation
```

Gauntlet does not parse this section. It exists so the agent reading
the profile knows which `what` values to ask for. Drift between
declared keys and resolver behavior surfaces as runtime errors, not
silent failure. Documented in `docs/credentials.md`.

### Argument validation

- `who`: same validation as `readProfile` today (reject `/`, `\`,
  `..`, leading `.`). Empty rejected.
- `what`: alphanumeric, underscore, hyphen only. Empty rejected. This
  is narrow enough to avoid surprising shell or filesystem semantics
  in any resolver implementation, regardless of how the caller wrote
  it.

Invalid arguments fail before the resolver is invoked, with a tool
result that names the offending argument.

### Failure surface to agent

Every failure mode produces a tool result the agent can read. No
silent failures.

- **Resolver exits non-zero:** tool result is markdown of the form
  `Resolver exited <code> for <who>:<what>:\n<stderr>`. Agent learns
  and adapts.
- **Resolver times out:** tool result is
  `Resolver timed out after <ms>ms for <who>:<what>`. Same shape.
- **Resolver writes nothing to stdout but exits 0:** tool result is
  `Resolver returned empty success for <who>:<what>`. Treated as
  failure; the agent should not type an empty string into the form.
- **Resolver path missing or not executable at run start:** Gauntlet
  refuses to start the run with a clear configuration error from the
  CLI. The tool is never registered with the agent.
- **Argument validation failure:** tool result names the offending
  argument and the rule it violated, no resolver invocation.

### Secrets handling

Matches the existing pattern from `install_cookies` and
`install_passkey`:

- **Live agent context** receives the full resolver stdout — the agent
  needs the value to type it into the page.
- **Run evidence (`run.jsonl`, action log)** records: `who`, `what`,
  exit code, stdout length in bytes, stderr length in bytes, elapsed
  ms. Never the stdout bytes.
- **Transcripts** redact the resolver stdout by default. The redacted
  marker includes `who`, `what`, and length so debugging is possible
  without the secret. An opt-in env var
  (`GAUNTLET_CREDENTIAL_INCLUDE_IN_TRANSCRIPTS=1`) reveals values for
  local debugging.

### Lifecycle

- **No caching.** Each tool call invokes the resolver fresh. Callers
  whose credentials are single-use (invite codes) issue a new one each
  call; callers whose credentials rotate (TOTP) read the current
  value each call. Caching is entirely the caller's choice and lives
  on their side of the boundary.
- **No setup call.** The tool is purely on-demand. There is no
  pre-warm at run start; the agent calls it when it needs a value.
- **No teardown.** The resolver is a stateless subprocess.

## Configuration surface

Three new env-var knobs, following the existing `GAUNTLET_*` pattern:

| Env var | Default | Purpose |
|---|---|---|
| `GAUNTLET_CREDENTIAL_RESOLVER` | unset | Path to caller-provided executable. When unset, the tool is not registered. |
| `GAUNTLET_CREDENTIAL_RESOLVER_TIMEOUT_MS` | `10000` | Per-invocation timeout, milliseconds. |
| `GAUNTLET_CREDENTIAL_INCLUDE_IN_TRANSCRIPTS` | `0` | When `1`/`true`/`yes`/`on`, include resolver stdout in transcripts instead of redacting. |

`AppConfig` gains a `credentialResolver?: { path: string; timeoutMs:
number; includeInTranscripts: boolean }` field, populated by
`loadConfig`. Absent when the env var is unset.

At load time, `loadConfig` resolves the path (relative paths are
resolved against `projectRoot`), `stat`s it, and verifies it is a
regular file with at least one execute bit set in its mode. Failure
to satisfy either check throws a clean error at boot — same shape as
the existing config errors in `loadConfig`. The check is intentionally
shallow (no PATH lookup, no interpreter validation); the goal is to
catch obvious misconfigurations at the CLI, not to vouch for the
resolver's behavior.

## Code surface (sketch)

| File | Change |
|---|---|
| `src/format/credential-resolver.ts` | **NEW.** `runResolver({ path, timeoutMs }, who, what): Promise<ResolverResult>` — argv invocation, timeout enforcement, stdout/stderr/exit-code capture. Pure function; no agent or adapter awareness. |
| `src/adapters/credential-tool.ts` | **NEW.** `buildFetchCredentialTool(resolverConfig): CredentialTool \| null` — returns `null` when no resolver is configured. Returned object has `definition`, `execute`, and a `summarizeForActionLog` helper that produces the lengths-not-bytes summary. |
| `src/adapters/web/adapter.ts` | Accepts `{ credentialResolver }` in constructor. Splices `fetch_credential` into `toolDefinitions()` when present. Dispatches in `executeTool()`. |
| `src/adapters/cli/adapter.ts` | Same. CLI adapter gains the tool for parity (relevant when agents drive non-web flows that still need ephemeral creds). |
| `src/adapters/tui/adapter.ts` | Same. |
| `src/cli/run.ts`, `src/api/routes/run.ts` | Pass `config.credentialResolver` through to whichever adapter is constructed. |
| `src/config.ts` | Add the three env vars, validate resolver path at load time (exists + executable), populate `credentialResolver` on `AppConfig`. |
| `docs/credentials.md` | Add a fourth section, `fetch_credential`, describing the resolver protocol, the profile-declaration convention, and the secrets-handling guarantees. Cross-link from the username/password section ("If the sign-in form also requires an OTP, see fetch_credential below"). |

| Test file | Coverage |
|---|---|
| `test/format/credential-resolver.test.ts` | Argv shape, success path, non-zero exit, empty-stdout-with-exit-0, timeout, missing/non-executable binary, argument validation rejects path traversal in `who` and bad chars in `what`. |
| `test/adapters/credential-tool.test.ts` | Builder returns `null` when no config; tool description includes the "read the profile first" guidance; execute returns markdown on success; execute returns helpful errors for each failure mode listed above; action-log summary contains lengths not bytes. |
| `test/adapters/web/adapter.test.ts` | `fetch_credential` is omitted when `credentialResolver` is undefined and registered when present. |
| `test/cli/run.test.ts` (and api equivalent) | `loadConfig` rejects an unreadable / missing resolver path at boot with a clear error. |
| Integration test | Small `test/fixtures/fake-resolver.sh` returns canned values; agent run against a fixture web app exercising an OTP gate verifies argv shape, agent invocation, and redaction. |

No changes to `src/agent/prompts.ts` or `src/agent/agent.ts` — the tool
self-documents via its description, matching `read_profile` and
`install_passkey`.

## Non-goals

- **General caller-provided-tool extension surface.** This is one tool
  for one specific annoying case. If a second use case for caller-
  provided tools appears, design it then. The shape of the second use
  case will tell us whether to extract a general mechanism.
- **Identity provisioning or selection.** The resolver looks up or
  produces credentials for identities the caller has already arranged.
  Creating new identities, choosing which identity to use, or rotating
  identities on the agent's behalf are all out of scope. The agent
  always names the profile (the `who`); narrative coherence depends on
  this.
- **Structured credential return.** The resolver returns markdown. The
  agent parses it (the same way it parses `## Credentials` blocks in
  `profile.md` today). A structured JSON return surface would be a
  bigger change and is not justified by the use cases.
- **Resolver as MCP server.** Subprocess via argv+stdout is the entire
  protocol. MCP-shaped resolvers can still be exposed by a one-line
  wrapper script; Gauntlet does not need to learn MCP for this.

## Open questions

None at spec time. The design has been brainstormed end-to-end with
Matt; this document captures the agreed shape. Anything that turns up
during planning or implementation gets added here or surfaced as a
plan-level question.
