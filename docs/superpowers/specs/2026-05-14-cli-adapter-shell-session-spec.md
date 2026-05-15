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
  cwd: <runDir>/scratch  (created by the adapter at start; see below)
  remember pgid (= bash's pid, since it's the session leader)
  store target as informational (used by describeTarget)

close():
  if no proc: return
  write "\nexit\n" to stdin            # polite — leading newline flushes
                                        # any half-typed line first
  await up to GRACE_MS                  # give bash a beat to exit
  if still alive: kill(-pgid, "SIGHUP") # interactive bash exits on SIGHUP
  await up to GRACE_MS
  if still alive: kill(-pgid, "SIGKILL")
  await proc.exited
```

`GRACE_MS` is short — 500ms each step, ~1.5s worst case. Long enough that a healthy `\nexit\n` lands, short enough not to drag every run by a noticeable tail.

**Steady-state path is the graceful one.** `close()` always sends `\nexit\n` first. Healthy bash responds within a few ms, never reaching SIGHUP. The SIGHUP and SIGKILL legs are *fallback* — they fire only when bash is wedged. When they fire, that's worth knowing (see "Process-group cleanup invariant" below); when they don't, there's no event and no log.

### Cwd / scratch dir

The adapter creates and owns `<runDir>/scratch/` at `start()` and uses it as the shell's working directory. `runDir` is already plumbed to the adapter via `executeRunCore` (`src/runs/orchestrator.ts`); the adapter constructor or `start()` reads it.

This is a deliberate shift from the current tutorial pattern, where `--target` itself contained `mkdir -p scratch-npm && cd scratch-npm && …` to create a project-root scratch subdir. Under the new model:

- Scratch lives under `.gauntlet/results/<runId>/scratch/`, not the project root. Goes away when results are reaped.
- Nothing the agent does pollutes the project root by default. `npm init`'s `package.json` lands in scratch.
- The current tutorial doc example and `examples/tutorial/README.md:43` need their `mkdir -p scratch-npm && …` examples rewritten to drop the prefix — that's a real doc rewrite, not a one-line tweak. Plan should call it out.

### Tools

Unchanged. `type`, `press`, `read_output`, plus the optional `read` from `contextRoot`. No new tools. `defaultViewport()` still returns `null`. `isMutatingTool()` still classifies `type` and `press` as mutating.

### Interactive bash over pipes

The shell runs on pipes, not a PTY. That means `isatty(stdin)` returns false inside bash, job control prints `bash: cannot set terminal process group` once on startup (harmless), and `set -m` is partial. None of this matters for our usage — we drive line-oriented commands, and child processes inherit the pipe as stdin just fine (npm-init style prompt-response works; tutorial cards already proved that empirically with the launcher prototype). If a future fixture genuinely needs PTY semantics (true `isatty`, terminal resize signals), that's a separate ticket and likely means `node-pty` or platform-specific code.

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

`src/runtime/spawn.ts` needs:

1. **`SpawnOptions { detached?: boolean; cwd?: string }`** — second arg to `spawn()`.
2. **`SpawnedProcess { pid: number; exited: Promise<number> }`** — new fields on the returned object.

Bun path: `Bun.spawn(argv, { ..., cwd, detached: true })`. Bun calls `setsid()` in the child for `detached: true` on POSIX. `pid` and `exited` already exist on `Bun.Subprocess`; surface them unchanged. We don't `unref()`.

Node path: `nodeSpawn(argv[0], argv.slice(1), { ..., cwd, detached: true })`. Same syscall, same semantics. `pid` is on `ChildProcess` directly. `exited` is the not-already-there bit and must be a `Promise<number>` resolved by the `'exit'` event handler:

```ts
const exited = new Promise<number>((resolve) => {
  if (proc.exitCode !== null) { resolve(proc.exitCode); return; }
  proc.once("exit", (code, _signal) => resolve(code ?? -1));
});
```

The `proc.exitCode !== null` guard handles the race where the child exited *before* the wrapper attached the listener — Node's `'exit'` event won't re-fire for an already-exited process. `-1` is the placeholder for "killed by signal" (signal info isn't part of the contract; callers that care can check the signal separately).

`kill(-pgid, signal)` is `process.kill(-pgid, signal)` in both runtimes.

### Process-group cleanup invariant

After `close()` returns, **no process from the agent's session is still running**. The escalation guarantees it (SIGKILL on the pgrp can't be ignored). Tests should pin this with a "spawn a `sleep 999`, close, assert the sleep is dead" case.

**If SIGHUP or SIGKILL fires, we want to know.** When the graceful `\nexit\n` leg doesn't land bash within `GRACE_MS`, log via `logger.logEvent("cli_shell_force_killed", { pgid, escalationStep, durationMs })` where `escalationStep` is `"sighup"` or `"sigkill"`. The event name is operator-facing (read via `run.jsonl`), kept narrow because no auditor needs it. It fires on the fallback paths only — healthy graceful exits emit nothing.

### Existing tutorial cards

`tutorial-01-npm-init` is currently invoked with `--target "mkdir -p scratch-npm && cd scratch-npm && npm init"`. Under the new model:

- Card content (`examples/tutorial/.gauntlet/stories/01-npm-init.md`) unchanged. The card never assumed the program was pre-spawned — it tells the agent to "Run `npm init`," and the agent types that into the shell.
- Invocations in `docs/tutorial.md` and `examples/tutorial/README.md` update to `--target "npm init"` (or just `"npm"`). Both files have the chained-shell example; both need rewriting. That's a real doc edit — the paragraph in `docs/tutorial.md` also explains *why* the scratch dir matters and points at project-root subdirs, all of which gets rewritten to say "the adapter creates `<runDir>/scratch/` for you."
- The adapter creates the per-run scratch dir and sets it as cwd; the `mkdir -p scratch-npm && cd scratch-npm` part is no longer the user's problem.

## Out of scope (v1)

- **TUI adapter changes.** Likely the same model applies (a tmux session with a shell inside), but defer until CLI lands and we have data.
- **Configurable shell.** Bash only. If anyone has a real need for zsh/fish, revisit.
- **Auto-running an initial command from target.** Adapter is idle at start. Agent decides what to run.
- **Capturing exit codes per command.** The agent reads output; if a command's exit code matters, it can `echo $?`. Worth a UX pass later, not v1.
- **Shell history file.** `--norc` keeps it off. Good for reproducibility.

## Test plan

- **Spawn-close roundtrip.** start adapter, close immediately, no orphan processes from the pgrp (check via `pgrep -g <pgid>` or by remembering pgid + polling `/proc` / `ps`).
- **Graceful exit path.** start adapter, close (which sends `\nexit\n`); assert no `cli_shell_force_killed` event fired, `exited` resolved promptly.
- **Half-typed-line robustness.** start adapter, `type("partial")` *without* trailing newline, then close. The leading newline in `\nexit\n` terminates the partial line so bash sees `partial` then `exit`, not `partialexit`. Assert clean exit.
- **SIGHUP path.** A synthetic shell that traps SIGHUP and ignores it (`trap '' HUP`); close, assert escalation reaches SIGKILL within ~1.5s, and `cli_shell_force_killed` fires with `escalationStep: "sigkill"`.
- **SIGHUP-suffices path.** Synthetic shell that ignores `\nexit\n` (e.g. trap on the readline) but exits cleanly on SIGHUP; assert `cli_shell_force_killed` fires with `escalationStep: "sighup"` and exit completes within ~1s.
- **Orphan reap.** start adapter, `type "sleep 999 &\n"`, capture the child's pid via `read_output` (`$!`), close, assert that pid is gone.
- **Cwd correctness.** start adapter, `type "pwd\n"`, read output, assert it equals `<runDir>/scratch`. Also assert the dir exists on disk.
- **npm-init compatibility.** end-to-end run against a stubbed `npm` script that prompts and reads answers; drive via `type`/`press` exactly as the current card does; assert it still works under the new adapter.

## Open questions

None known. All architectural calls resolved in the design discussion that produced this spec.

## Next step

Implementation plan via `superpowers:writing-plans`.
