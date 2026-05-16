---
title: Agent bash tool — read beyond the screen
date: 2026-05-15
status: proposed (v1)
author: Foaly@3006ca20
---

# Agent bash tool — read beyond the screen

## Problem

The Gauntlet agent's view of the system under test is, today, exclusively
the rendered surface: DOM + screenshots for web, stdout bytes for CLI,
ANSI for TUI. That's the right primary signal — it's what the human
user sees — but it isn't always *the truth*.

Concrete motivating case: Gauntlet drives Claude Code or Codex via the
TUI adapter. The screen shows what the agent under test *said* it did.
The session log on disk shows what the agent under test *actually* did
(every tool call, every file write, every model turn). Story cards
that need to verify real behavior — not just narrated behavior — have
no way to reach that log today.

The same shape recurs broadly: webapp server logs, files the target
created, audit logs, state files, snapshots a card could `diff`
against. All variants of the same need: *verify reality, not just
narration*.

## Approach

A single new agent-side tool: **`bash`**. Runs an arbitrary shell
command via `bash -c` in a fresh subprocess, captures
`{stdout, stderr, exit_code}`, returns them with truncation +
elapsed-time metadata.

The agent uses native Unix utilities — `tail`, `grep`, `ls`, `cat`,
`find`, `wc`, `jq`, `diff`, `du`, `head` — and pipes them as needed.
No bespoke tail/grep/etc. implementations; the toolbox `bash` already
unlocks is broader, more composable, and more familiar than anything
we'd build.

**Always mounted, on every adapter.** No opt-in flag. The premise:
Gauntlet runs on the operator's machine; if the operator launched
`gauntlet run`, they have accepted that Gauntlet executes arbitrary
code on their behalf. A bash primitive doesn't expand that posture —
the existing CLI/TUI adapters already spawn long-lived shells the
agent drives via keystrokes. `bash` formalizes a *cleaner shape* for
the read-only / one-off case.

The card author tells the agent *what* to look for and *where* to
look using prose; the `bash` tool lets it look. Discovery becomes a
runtime capability — paths the operator could never have known
upfront (e.g. `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl`)
are now findable from inside the run.

This work also bundles a small DRY refactor: the three adapters today
each duplicate scaffolding for the existing opt-in tools (`read`,
`fetch_credential`). The refactor extracts a `SharedTools` bundle the
adapters delegate to; `bash` joins the bundle in the same change.

## The driving shell vs. the bash tool

CLI and TUI adapters already run a "shell" — `bash --norc --noprofile -i`
spawned at session start, which the agent drives via `type`/`press` to
exercise the target program. That shell is **the SUT's host**:
long-lived, stateful, terminal-bound, output interleaved with target
prompts and screen redraws.

The new `bash` tool is **fundamentally different in shape**:

| | Driving shell (CLI/TUI) | `bash` tool |
|--|--|--|
| Lifetime | Per run (long-lived) | Per call (fresh subprocess) |
| State | cwd, env, history persist | None across calls |
| Input | Keystrokes via `type`/`press` | `command` string via tool call |
| Output | ANSI-rendered screen / interleaved bytes | Clean `stdout`/`stderr` capture |
| Purpose | Drive the SUT | Inspect the world around the SUT |

Same word "shell," genuinely different operation. The two should
coexist; the agent uses each for what it's good for. The web adapter
has no driving shell at all; `bash` gives it filesystem reach for the
first time.

## Prior art in the codebase

There is **no existing agent-side command-running tool** today —
`bash` is a new agent capability. But Gauntlet already runs
subprocesses internally (CLI adapter's driving shell, TUI adapter's
tmux calls, `ps` walks for process-tree reaping, etc.), all routed
through `src/runtime/spawn.ts` — a cross-runtime Bun/Node spawn
abstraction. The bash tool builds on that infrastructure rather than
reaching into `child_process` directly.

The CLI adapter also already implements **subprocess cleanup** at
`src/adapters/cli/adapter.ts:close` (post-PRI-1611 simplification):
SIGKILL the pgid, then SIGKILL each pre-snapshotted descendant by pid
(children of an exiting shell get re-parented to init and miss
pgid-targeted signals). Emits `cli_shell_descendants_reaped` with the
reaped count when any descendants were killed. The bash tool reuses
this exact discipline for its timeout path, so a timed-out command
like `bash -c "sleep 30 & echo done"` doesn't leak orphaned
background children.

## Required runtime changes

Two new `SpawnOptions` fields in `src/runtime/spawn.ts`:

| Field | Type | Semantics |
|-------|------|-----------|
| `env` | `Record<string, string>` | When provided, replaces (not merges) the child's env. Wired through to Bun.spawn's `env` and node:child_process's `env`. |
| `timeout_ms` | `number` | When provided, the child is SIGKILLed if it hasn't exited within the window. Implemented uniformly via `setTimeout` + `proc.kill` so the `exited` Promise resolves consistently across Bun and Node. |

New helper `src/runtime/process-tree.ts:killProcessTree(pgid, descendants)`:
SIGKILLs the pgid, then SIGKILLs each pid in `descendants`. Returns
`{ reaped: number }` (count of descendants successfully signaled,
matching the existing `cli_shell_descendants_reaped` event payload).
Used by both the CLI adapter's `close` (deduplicating its current
inline logic — same external behavior, just routed through the helper)
and the bash tool's timeout path (new). Snapshotting the descendant
list is the **caller's** responsibility — for CLI, before SIGKILL'ing
the shell; for bash, inside the timeout callback right before calling
the helper.

**Pgid invariant:** `pgid == pid` only holds for processes spawned
with `detached: true` (the spawn abstraction calls `setsid()` in that
case). Both callers spawn detached. If a future caller forgets, the
pgid argument silently targets the wrong group.

## Components

### The `bash` tool

`src/agent/bash-tool.ts` exports `buildBashTool(opts) → BashTool`.

```ts
export interface BashToolOptions {
  cwd: string;                    // run's scratch directory
}

export interface BashTool {
  definition: ToolDefinition;
  execute(args, logger): Promise<ToolResult>;
}
```

Unlike `read` / `fetch_credential`, `buildBashTool` never returns
`null` — the tool is always mounted.

Internally:

1. Spawn `bash -c <command>` via `runtime/spawn.ts` with
   `{ cwd, env: scrubbedEnv, detached: true, timeout_ms }`.
2. Snapshot descendants via `listDescendants(pid)` at spawn time +
   re-snapshot just before any kill (descendants change over the
   command's lifetime).
3. Drain stdout/stderr through size-capped accumulators.
4. On natural exit: return result.
5. On timeout: `killProcessTree(pgid, descendants)`, return partial
   output + `timed_out: true`.

### Shared tools bundle (DRY refactor)

New module `src/agent/shared-tools.ts`:

```ts
export interface SharedTools {
  definitions(): ToolDefinition[];
  canExecute(name: string): boolean;
  execute(
    name: string,
    args: Record<string, unknown>,
    logger: EvidenceLogger,
  ): Promise<ToolResult> | ToolResult;
}

export function buildSharedTools(opts: {
  contextRoot?: string;
  credentialResolver?: CredentialResolverConfig;
  cwd: string;
}): SharedTools;
```

Internally calls `buildReadTool`, `buildFetchCredentialTool`,
`buildBashTool`. The existing opt-in tools may return `null` and get
omitted from `definitions()`; `bash` is always included.

Each adapter:

- constructor: `this.shared = buildSharedTools({...})`
- `toolDefinitions()`: `tools.push(...this.shared.definitions())`
- `executeTool(name, args, logger)`: `if (this.shared.canExecute(name)) return this.shared.execute(name, args, logger);`

Result: adding a future shared tool is one edit inside
`buildSharedTools`, not three.

### System prompt

`src/agent/prompts.ts` gains a short new section, always emitted:

```
## Shell access

You have a `bash` tool for inspecting logs and files on the host via
standard Unix utilities (`rg`, `tail`, `grep`, `cat`, `wc`, `find`,
`head`, `jq`, etc.). Use it to verify what the system under test
actually did or what landed on disk. Do **not** use it to drive the
system under test — the adapter's screen/keyboard tools (type, press,
click, navigate, etc.) are for that.

Each call runs in a fresh subprocess; pipes and redirects work; no
state persists between calls.
```

Tool descriptions are affordances, not documentation — they tell the
agent *when to reach for the tool*, not just what it does. The wording
above is deliberately use-case-shaped (logs/files/disk-truth) rather
than capability-shaped ("runs any shell command") because a generic
shell-exec description invites the agent to bash its way through CLI
prompts and TUI navigation instead of using the adapter's actual
driving tools.

### Tool description (parameter-side)

The same use-case framing applies to the tool definition itself:

```
The best interface for inspecting logs and files on the host via
standard Unix tools (rg, tail, grep, cat, wc, find, head, jq, etc.).
Use this to verify what the system under test actually did or what
landed on disk — not to drive the SUT itself (use the adapter's
screen/keyboard tools for that). Each call runs `bash -c <command>`
in a fresh subprocess; pipes and redirects work; no state persists
between calls.
```

## Tool semantics

### Parameters

| name | type | default | range |
|------|------|---------|-------|
| `command` | string | (required, non-empty) | — |
| `timeout_ms` | integer | 10000 | 100..60000 |

`command` is the literal string passed to `bash -c`. No constraints
on syntax — pipes, redirects, command substitution, multi-line scripts
all work. The agent is trusted to write reasonable commands.

### Execution

```ts
spawn(["bash", "-c", command], {
  cwd,
  env: scrubbedEnv,
  detached: true,
  timeout_ms,
})
```

`detached: true` makes the child a session leader so the whole
process tree can be reaped by pgid on timeout (see "Required runtime
changes"). On timeout, `killProcessTree(pgid, descendants)` runs and
partial stdout/stderr captured up to that point are returned with
`timed_out: true`.

### Return shape

```ts
{
  stdout: string,
  stderr: string,
  exit_code: number | null,    // null iff killed (timeout or signal)
  truncated: { stdout: boolean, stderr: boolean },
  timed_out: boolean,
  elapsed_ms: number,
}
```

Streams are decoded UTF-8 with invalid sequences passed through as
U+FFFD (no binary-rejection — `bash` callers may legitimately want
hex dumps via `xxd`, `od`, etc., and rejecting binary at this layer
defeats the purpose of giving the agent native tools). Output caps
apply per stream:

- `stdout`: 64 KB
- `stderr`: 16 KB

On overflow, the captured prefix is returned with the matching
`truncated` flag set. The agent can re-run with narrower pipes if it
needs to see more.

### Cwd

The subprocess's cwd is the run's scratch directory
(`<.gauntlet/results/<runId>/scratch/`). Consistent with where the
CLI adapter's driving shell starts, so the agent reasoning ("I just
wrote a file with the target; let me `ls` to confirm") works
naturally. Absolute paths work for everything else.

### Env

Process env is built from scratch, not inherited. The allow-list:

**Minimal base** (commands need these to function):
`PATH`, `HOME`, `USER`, `SHELL`, `LANG`, `LC_ALL`, `TERM`, `TMPDIR`, `TZ`

**LLM SDK pass-through** (per the SDK pass-through policy in README):
`ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_LOG`,
`OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_ORG_ID`, `OPENAI_PROJECT`,
`HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY`

Anything else from Gauntlet's parent env is dropped. Rationale: an
agent that runs `bash {command: "env"}` should see a deliberate
working set, not whatever happened to be exported when the operator
launched Gauntlet (which may include unrelated secrets, dev-only
tokens, etc.).

The pass-through set is honestly named "things the SUT may need to
function" — Claude Code wants `ANTHROPIC_API_KEY`; a sub-test that
calls another LLM tool wants the same; a curl through a corporate
proxy wants `HTTPS_PROXY`.

### No secret scrubbing in output

If the agent runs `echo $ANTHROPIC_API_KEY`, the key lands in the
evidence log. Same for any command whose output happens to include a
secret. This is intentional: comprehensive evidence is the point, and
clever scrubbing introduces both false negatives (missed leaks) and
false positives (legitimate output mangled). Operators who want
post-hoc redaction should run a scrubber over the evidence log; this
is not the bash tool's job.

## Failure modes

| Condition | Behavior |
|-----------|----------|
| `command` missing / empty | Validated upstream by `validateToolArgs` |
| `timeout_ms` out of range | Validated upstream |
| Timeout exceeded | SIGKILL; return partial output + `timed_out: true` + `exit_code: null` |
| Spawn fails (e.g. `bash` not on PATH) | Surface error string verbatim |
| Output exceeds cap | Capture prefix; set `truncated.stdout` or `truncated.stderr` |
| Subprocess exits non-zero | Normal return; `exit_code` reflects the value. Not an error — many useful commands exit non-zero (`grep` with no match, `test`) |

## Evidence log events

| Event | Fields |
|-------|--------|
| `bash_call` | `command`, `cwd`, `timeout_ms`, `stdout_bytes`, `stderr_bytes`, `exit_code`, `timed_out`, `truncated`, `elapsed_ms` |
| `bash_spawn_failed` | `command`, `error` |

The actual captured stdout/stderr are included in the tool result
returned to the agent (and therefore in the model conversation log)
but **not** duplicated into the evidence event payload — that would
double-write potentially large blobs. The conversation log is the
authoritative record of output the agent saw.

**`command` is logged verbatim** in both events. This is the same
no-scrubbing posture as the captured output: comprehensive evidence
is the point, and clever scrubbing introduces both false negatives
(missed leaks) and false positives (legitimate values mangled). If
the agent runs `bash {command: "echo $ANTHROPIC_API_KEY"}`, the
command string lands in the event payload too. Operators who want
post-hoc redaction should run a scrubber over the evidence log.

## Testing

Tests live at `test/<mirror-of-src>/<file>.test.ts` per the repo's
existing convention.

| File | Coverage |
|------|----------|
| `test/runtime/spawn.test.ts` | extended: `env` replaces (not merges) child env; `timeout_ms` SIGKILLs an unresponsive child; both options work cross-runtime (Bun and Node code paths) |
| `test/runtime/process-tree.test.ts` | extended: `killProcessTree(pgid, descendants)` SIGKILLs a `sleep 30 & echo $!` background child after the parent exits |
| `test/agent/bash-tool.test.ts` | basic command, exit codes, stderr capture, timeout (`sleep 30` with 1s timeout), background-child reaping (`sleep 30 &; echo done`), stdout overflow → truncation flag, stderr overflow → truncation flag, env scrubbing (run `env`, assert only allow-listed vars present), env pass-through (set ANTHROPIC_API_KEY, run `printenv`, assert present), cwd (run `pwd`, assert scratch dir), spawn failure |
| `test/agent/shared-tools.test.ts` | empty bundle (cwd only) mounts just `bash`; with `contextRoot` mounts `read` + `bash`; with `credentialResolver` mounts `fetch_credential` + `bash`; `canExecute` discrimination; dispatch routing |
| `test/adapters/{web,cli,tui}/adapter.test.ts` | extended: `toolDefinitions()` includes `bash` on every adapter |
| `test/agent/prompts.test.ts` | `## Shell access` section present in composed system prompt; snapshot test for `--show-prompt-and-exit` updated |
| `test/adapters/cli/adapter.test.ts` | existing CLI close-protocol tests continue to pass after the `killProcessTree` extraction (regression guard) |

No end-to-end "agent uses bash to read the log" test in v1. A
follow-up tutorial story exercising the agent path (e.g. tutorial 7:
"verify what Claude actually did via the session log") is worthwhile
but out of scope here.

## Out of scope (v1)

- **Per-call cwd override.** v1 fixes cwd to the run scratch
  directory. If a card needs the agent to run things elsewhere, the
  agent prefixes the command with `cd /other/place && ...`.
- **Per-call env override.** v1 fixes env to the allow-list +
  pass-through set. If a card needs additional env, the agent
  prefixes with `FOO=bar ...`.
- **Persistent bash session.** Each call is a fresh subprocess. If a
  user wants stateful work, the CLI adapter's driving shell already
  serves that role.
- **stdin to subprocess.** No way to pipe input in via tool args. If
  needed, use a heredoc: `bash {command: "cmd <<'EOF'\\ndata\\nEOF"}`.
- **Output scrubbing.** See "No secret scrubbing in output" above.
- **Sandboxing / restricted shell / command allow-listing.** Operator
  trust is the gating mechanism (they ran Gauntlet); no per-command
  policy.
- **`--log` flag.** The earlier `--log` / `--log-description` design
  is fully subsumed by `bash` + card-prose discovery. Operators who
  want to pin the agent at a specific log path can put it in the
  card or in a `.gauntlet/context/` fixture file.

## Open questions

None outstanding at design time.
