# CLI adapter — shell-as-session model

**Linear:** PRI-1608
**Blocks:** PRI-1604 (TODO fixture)
**Author:** Granny@6a0b7550 (Opus 4.7)

---

## Problem

The CLI adapter today spawns one program (`sh -c "<target>"`) at `start()`, drives it via `type`/`press`/`read_output`, and ends when it exits. That fits *single-program* tools — vim, npm init, htop — where one process owns the session for the run's lifetime.

Most CLI testing is *multi-invocation*: docker, kubectl, git, `todo`. The agent issues many short commands, observes each one, and converges on a state. There's no clean target shape for that under today's adapter — fixtures end up wrapping themselves in a shell launcher (as PRI-1604 discovered the hard way), and the agent inherits whatever signal-handling quirks that wrapper has.

## Decision

The adapter spawns a long-lived **bash session** at `start()`. `--target` becomes *informational* — the name or path of the command under test — and the adapter does not auto-run it. The agent types commands into the shell; the existing tools (`type`/`press`/`read_output`) drive that interaction unchanged.

The shell is the durable thing; what runs inside it changes turn-to-turn.

### Why not a new adapter, or an `invoke` tool

Earlier drafts considered an `invoke(args)` tool that spawns one subprocess per call. Two problems:

1. **Interactive prompts.** Tools like `npm init` show one question, wait for the answer, *then* compute the next question. The agent can't pipe all answers up front. A single `invoke(args, stdin)` call can't model iterative prompt-response without re-introducing the same long-running-stdio surface the adapter already provides.
2. **TUI overlap.** Long-running TTY-driven things are TUI's domain. CLI's distinct value is *what you type at a shell*. A shell session matches that exactly.

So: no new tools, no new adapter, no `invoke`. Same surface; different relationship between target and lifecycle.

## Design

### Adapter

```
start(target):
  spawn bash --norc --noprofile -i  (with setsid → fresh pgrp)
  cwd: per-run scratch dir
  remember pgid (= bash's pid, since it's the session leader)
  store target as informational (used by describeTarget)

close():
  if no proc: return
  write "exit\n" to stdin              # polite
  await up to GRACE_MS                  # give bash a beat to exit
  if still alive: kill(-pgid, "SIGHUP") # interactive bash exits on SIGHUP
  await up to GRACE_MS
  if still alive: kill(-pgid, "SIGKILL")
  await proc.exited
```

`GRACE_MS` is short — 500ms each step, ~1.5s worst case. Long enough that a healthy `exit` lands, short enough not to drag every run by a noticeable tail.

### Tools

Unchanged. `type`, `press`, `read_output`, plus the optional `read` from `contextRoot`. No new tools.

### `describeTarget`

The first user message tells the agent that it has a shell and what command it's exercising. Today's CLI `describeTarget` says *"A CLI program is already running. Its command line was: …"*. The new version replaces that:

> You are at an interactive bash shell. The command you are exercising is
> `<target>`. Use `type` and `press` to issue shell commands and answer
> any prompts. The shell is your durable session — many commands can run
> through it during the run. When you are finished, type `exit` to close
> the shell cleanly.

If `<target>` is empty (`--target ""`), drop the "command you are exercising" sentence. The shell still works; the agent's card narrative tells them what to do.

### Spawn primitive

`src/runtime/spawn.ts` needs two small additions:

1. **`SpawnOptions { detached?: boolean; cwd?: string }`** — passed to `spawn()`.
2. **`SpawnedProcess { pid: number; exited: Promise<number> }`** — exposes what we need for pgrp kills + clean `await`.

Bun path: `Bun.spawn(argv, { ..., cwd, detached: true })`. Bun calls `setsid()` in the child for `detached: true` on POSIX. We don't `unref()`.

Node path: `nodeSpawn(..., { ..., cwd, detached: true })`. Same syscall, same semantics. We don't `unref()`.

`kill(-pgid, signal)` is `process.kill(-pgid, signal)` in both runtimes.

### Process-group cleanup invariant

After `close()` returns, **no process from the agent's session is still running**. The escalation guarantees it (SIGKILL on the pgrp can't be ignored). Tests should pin this with a "spawn a `sleep 999`, close, assert the sleep is dead" case.

If the SIGKILL leg fires in production we want to know — log a `cli_shell_force_killed` evidence event with `{ pgid, durationMs, escalationStep }`. Fields kept narrow because the event is operator-facing, not auditor-facing.

### Existing tutorial cards

`tutorial-01-npm-init` is currently invoked with `--target "mkdir -p scratch-npm && cd scratch-npm && npm init"`. Under the new model:

- Card content unchanged.
- Doc example in `docs/tutorial.md` updates the invocation: `--target "npm init"` (or just `"npm"` — both work). The agent reads the card, types `npm init` into the shell, and the existing prompt-response flow proceeds as today.
- The harness creates the per-run scratch dir and sets it as cwd; the `mkdir -p scratch-npm && cd scratch-npm` part is no longer the agent's or the user's problem.

That's a doc tweak, not a card move.

## Out of scope (v1)

- **TUI adapter changes.** Likely the same model applies (a tmux session with a shell inside), but defer until CLI lands and we have data.
- **Configurable shell.** Bash only. If anyone has a real need for zsh/fish, revisit.
- **Auto-running an initial command from target.** Adapter is idle at start. Agent decides what to run.
- **Capturing exit codes per command.** The agent reads output; if a command's exit code matters, it can `echo $?`. Worth a UX pass later, not v1.
- **Shell history file.** `--norc` keeps it off. Good for reproducibility.

## Test plan

- Spawn-close roundtrip: start adapter, close immediately, no orphan processes (check via `pgrep -g`).
- `exit\n` path: agent sends `type "exit\n"`, close completes via the graceful leg without SIGHUP.
- SIGHUP path: `trap '' SIGTERM` inside the shell can't happen (we send SIGHUP, not SIGTERM, and bash exits on SIGHUP); pin behavior with a synthetic child that ignores SIGTERM, confirm cleanup still completes.
- SIGKILL path: shell that ignores SIGHUP — confirm escalation reaches SIGKILL within ~1.5s.
- Orphan reap: start adapter, `type "sleep 999 &\n"`, close, assert sleep is gone.
- Cwd correctness: start adapter, `type "pwd\n"`, read output, assert it's the scratch dir.
- npm-init compatibility: end-to-end run against a stubbed `npm` script that prompts and reads answers, drive it via `type`/`press` exactly as the current card does, assert it still works.

## Open questions

None known. All architectural calls resolved in the design discussion that produced this spec.

## Next step

Implementation plan via `superpowers:writing-plans`.
