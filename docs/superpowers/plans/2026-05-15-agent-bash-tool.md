# Agent bash tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `bash` tool to the Gauntlet agent — a fresh-subprocess `bash -c <command>` primitive returning `{stdout, stderr, exit_code, truncated, timed_out, elapsed_ms}` — mounted on every adapter (web/cli/tui) so the agent can verify reality on disk in addition to what the rendered screen shows.

**Architecture:** New `src/agent/bash-tool.ts` for the tool itself. New `src/agent/shared-tools.ts` bundling adapter-agnostic tools (`read`, `fetch_credential`, `bash`) so each adapter delegates rather than duplicating mount/dispatch. Two extensions to `src/runtime/spawn.ts` (`env`, `timeout_ms`) and a new helper `src/runtime/process-tree.ts:killProcessTree` reused by the bash tool's timeout path and the CLI adapter's existing close path (deduplication, no behavior change for CLI).

**Tech Stack:** Bun/TypeScript. `bun:test` for tests. Existing patterns: `src/context/read-tool.ts` (adapter-agnostic tool, gated null-or-tool), `src/adapters/cli/adapter.ts:close` (process-tree cleanup discipline post-PRI-1611), `src/runtime/spawn.ts` (cross-runtime spawn).

**Spec:** `docs/superpowers/specs/2026-05-15-agent-bash-tool-design.md`.
**Ticket:** PRI-1615.

---

## File Map

**Create:**

- `src/agent/bash-tool.ts` — `buildBashTool({cwd})`, `BashTool` interface, `BASH_TOOL_DESCRIPTION` const, env scrubbing helper, output-capping accumulator.
- `src/agent/shared-tools.ts` — `buildSharedTools({contextRoot, credentialResolver, cwd})`, `SharedTools` interface bundling read + fetch_credential + bash.
- `test/agent/bash-tool.test.ts` — unit tests for buildBashTool.
- `test/agent/shared-tools.test.ts` — unit tests for buildSharedTools.

**Modify:**

- `src/runtime/spawn.ts` — add `env` and `timeout_ms` to `SpawnOptions`; wire through Bun and Node code paths.
- `src/runtime/process-tree.ts` — add `killProcessTree(pgid, descendants)` helper. Trivial: SIGKILL pgid + SIGKILL each descendant pid.
- `src/adapters/cli/adapter.ts` — route `close()`'s inline kill+reap through `killProcessTree`; replace `this.readTool`/`this.credentialTool` with `this.shared = buildSharedTools(...)`. Already accepts `runDir`.
- `src/adapters/web/adapter.ts` — add `runDir` option; replace `this.readTool`/`this.credentialTool` with `this.shared = buildSharedTools(...)`.
- `src/adapters/tui/adapter.ts` — replace `this.readTool`/`this.credentialTool` with `this.shared = buildSharedTools(...)`. Already accepts `runDir`.
- `src/runs/orchestrator.ts` — thread `runDir` (the run's outDir) into the web-adapter construction (CLI and TUI already get it).
- `src/agent/prompts.ts` — add `## Shell access` section to system prompt (always emitted).
- `test/runtime/spawn.test.ts` — env + timeout coverage.
- `test/runtime/process-tree.test.ts` — killProcessTree coverage.
- `test/adapters/cli/adapter.test.ts` — extend: `bash` appears in `toolDefinitions()`; existing close-protocol regression coverage stays green.
- `test/adapters/web/adapter.test.ts` — extend: `bash` appears in `toolDefinitions()`.
- `test/adapters/tui/adapter.test.ts` — extend: `bash` appears in `toolDefinitions()`.
- `test/agent/prompts.test.ts` — `## Shell access` section present in composed prompt.

**Implementation note on cwd lifecycle:** the bash tool calls `mkdirSync(cwd, {recursive: true})` lazily on first `execute()`, so adapters that don't already create the scratch directory in `start()` (web) don't need new mkdir code.

**Background context for executor — the CLI close protocol:** Two recent commits land on `src/adapters/cli/adapter.ts` may confuse you. `f92e98b` (PRI-1608) added a SIGHUP→SIGKILL escalation with grace window. `0d0e557` (PRI-1611) **removed** that and collapsed close to the current trivial form: `process.kill(-pgid, "SIGKILL")` + descendant SIGKILL loop. The current state (post-PRI-1611) is what this plan extracts into `killProcessTree`. There is no escalation to preserve.

---

## Task 1: Add `env` option to runtime/spawn.ts

**Files:**
- Modify: `src/runtime/spawn.ts`
- Test: `test/runtime/spawn.test.ts`

Add `env?: Record<string, string>` to `SpawnOptions`. When provided, **replaces** (not merges) the child's env. Pass through to both Bun.spawn's `env` and node:child_process's `env`.

- [ ] **Step 1: Write failing test for env replacement**

Append to `test/runtime/spawn.test.ts`:

```typescript
test("spawn replaces child env when env option provided", async () => {
  const proc = spawn(["bash", "-c", "echo \"FOO=$FOO PATH_PRESENT=${PATH:+yes}\""], {
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", FOO: "bar" },
  });
  const reader = proc.stdout.getReader();
  let out = "";
  const dec = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += dec.decode(value, { stream: true });
  }
  await proc.exited;
  expect(out.trim()).toBe("FOO=bar PATH_PRESENT=yes");
});

test("spawn drops parent env vars not in env option", async () => {
  process.env.GAUNTLET_TEST_LEAK = "leaked";
  try {
    const proc = spawn(["bash", "-c", "echo \"LEAK=${GAUNTLET_TEST_LEAK:-clean}\""], {
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
    });
    const reader = proc.stdout.getReader();
    let out = "";
    const dec = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      out += dec.decode(value, { stream: true });
    }
    await proc.exited;
    expect(out.trim()).toBe("LEAK=clean");
  } finally {
    delete process.env.GAUNTLET_TEST_LEAK;
  }
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `bun test test/runtime/spawn.test.ts -t "env"`
Expected: 2 FAILED — `env` is not a recognized SpawnOptions field; child inherits parent env so the leak shows up.

- [ ] **Step 3: Add `env` to SpawnOptions and wire through both code paths**

Edit `src/runtime/spawn.ts`. Update `SpawnOptions`:

```typescript
export interface SpawnOptions {
  /** Working directory for the child process. */
  cwd?: string;
  /**
   * When true, the child becomes a session leader (calls `setsid()` on
   * POSIX). Its pid equals its pgid, so `process.kill(-pid, signal)`
   * targets the entire process group — used by callers that need to reap
   * the whole tree at cleanup time.
   */
  detached?: boolean;
  /**
   * When provided, **replaces** the child's environment (not merged with
   * parent). Callers that want inheritance should pass `process.env`.
   */
  env?: Record<string, string>;
}
```

In `spawnViaBun`, add `env`:

```typescript
const proc = Bun.spawn(argv, {
  stdin: "pipe",
  stdout: "pipe",
  stderr: "pipe",
  cwd: options?.cwd,
  ...(options?.detached ? { detached: true } : {}),
  ...(options?.env ? { env: options.env } : {}),
}) as Bun.Subprocess<"pipe", "pipe", "pipe">;
```

In `spawnViaNode`, add `env`:

```typescript
const proc = nodeSpawn(argv[0]!, argv.slice(1), {
  stdio: ["pipe", "pipe", "pipe"],
  cwd: options?.cwd,
  detached: options?.detached === true,
  ...(options?.env ? { env: options.env } : {}),
});
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `bun test test/runtime/spawn.test.ts -t "env"`
Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/spawn.ts test/runtime/spawn.test.ts
git commit -m "runtime/spawn: add env option (replaces child env)"
```

---

## Task 2: Add `timeout_ms` option to runtime/spawn.ts

**Files:**
- Modify: `src/runtime/spawn.ts`
- Test: `test/runtime/spawn.test.ts`

Add `timeout_ms?: number` to `SpawnOptions`. When provided, the child gets SIGKILL if it hasn't exited within the window. Implement uniformly via setTimeout + proc.kill (rather than relying on each runtime's native timeout, which differs in cleanup semantics).

- [ ] **Step 1: Write failing test for timeout enforcement**

Append to `test/runtime/spawn.test.ts`:

```typescript
test("spawn kills child after timeout_ms elapses", async () => {
  const start = Date.now();
  const proc = spawn(["bash", "-c", "sleep 30"], { timeout_ms: 200 });
  const code = await proc.exited;
  const elapsed = Date.now() - start;
  expect(elapsed).toBeLessThan(2000);
  // exited contract: -1 when killed by signal
  expect(code).toBeLessThan(0);
});

test("spawn does not kill child that exits within timeout_ms", async () => {
  const proc = spawn(["bash", "-c", "echo done"], { timeout_ms: 5000 });
  const code = await proc.exited;
  expect(code).toBe(0);
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `bun test test/runtime/spawn.test.ts -t "timeout"`
Expected: FAIL — `timeout_ms` not honored; first test hangs ~30s or fails on elapsed assertion.

- [ ] **Step 3: Add timeout_ms field**

In `SpawnOptions`:

```typescript
  /**
   * When provided, the child is SIGKILLed if it hasn't exited within the
   * window. Implemented uniformly via setTimeout + proc.kill so the
   * caller's `exited` Promise resolves consistently across Bun and Node.
   */
  timeout_ms?: number;
```

- [ ] **Step 4: Wrap the returned SpawnedProcess to enforce timeout**

Add a helper at the bottom of `src/runtime/spawn.ts`:

```typescript
function withTimeout(proc: SpawnedProcess, timeoutMs: number | undefined): SpawnedProcess {
  if (!timeoutMs) return proc;
  const handle = setTimeout(() => {
    try { proc.kill(); } catch { /* already dead */ }
  }, timeoutMs);
  proc.exited.finally(() => {
    clearTimeout(handle);
  });
  return proc;
}
```

In both `spawnViaBun` and `spawnViaNode`, wrap the returned process:

```typescript
return withTimeout({ ... }, options?.timeout_ms);
```

- [ ] **Step 5: Run tests — verify pass**

Run: `bun test test/runtime/spawn.test.ts -t "timeout"`
Expected: 2 PASS, both well under 2s.

- [ ] **Step 6: Commit**

```bash
git add src/runtime/spawn.ts test/runtime/spawn.test.ts
git commit -m "runtime/spawn: add timeout_ms option (uniform setTimeout + kill)"
```

---

## Task 3: Add killProcessTree helper; route CLI close through it

**Files:**
- Modify: `src/runtime/process-tree.ts`, `src/adapters/cli/adapter.ts`
- Test: `test/runtime/process-tree.test.ts`

Post-PRI-1611, the CLI adapter's `close()` is just `process.kill(-pgid, "SIGKILL")` followed by SIGKILL of each pre-snapshotted descendant pid — no escalation, no grace window, no `cli_shell_force_killed` event. Lift that exact pattern into a `killProcessTree(pgid, descendants)` helper. CLI close switches to call it (deduplication, no behavior change). The bash tool's timeout path (Task 6) becomes the second caller.

- [ ] **Step 1: Write failing test for killProcessTree**

Append to `test/runtime/process-tree.test.ts`:

```typescript
import { spawn } from "../../src/runtime/spawn";
import { killProcessTree, listDescendants } from "../../src/runtime/process-tree";

test("killProcessTree SIGKILLs the pgid and reaps descendants", async () => {
  // Parent spawns a background sleep child, writes its pid to a file
  // (more reliable than racing stderr), then sleeps itself.
  // pgid invariant: pid == pgid only because we spawn detached.
  const { mkdtempSync, readFileSync } = await import("fs");
  const { tmpdir } = await import("os");
  const { join } = await import("path");
  const dir = mkdtempSync(join(tmpdir(), "gauntlet-killtree-"));
  const pidFile = join(dir, "child.pid");

  const parent = spawn(
    ["bash", "-c", `sleep 30 & echo $! > ${pidFile}; sleep 30`],
    { detached: true },
  );

  // Wait for the pid file to be written
  let childPid = 0;
  for (let i = 0; i < 50; i++) {
    try {
      childPid = Number(readFileSync(pidFile, "utf-8").trim());
      if (childPid > 0) break;
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 20));
  }
  expect(childPid).toBeGreaterThan(0);

  // Snapshot descendants WHILE PARENT IS STILL ALIVE.
  const descendants = listDescendants(parent.pid);
  expect(descendants.length).toBeGreaterThan(0);

  const result = killProcessTree(parent.pid, descendants);
  expect(result.reaped).toBeGreaterThan(0);

  // Both parent and background child should be dead now.
  await new Promise((r) => setTimeout(r, 50));
  let childAlive = true;
  try { process.kill(childPid, 0); } catch { childAlive = false; }
  expect(childAlive).toBe(false);
  await parent.exited;
});

test("killProcessTree on already-dead pgid does not throw", () => {
  // A pid extremely unlikely to be alive
  expect(() => killProcessTree(999999, [999998])).not.toThrow();
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `bun test test/runtime/process-tree.test.ts -t "killProcessTree"`
Expected: FAIL — `killProcessTree` is not exported.

- [ ] **Step 3: Add killProcessTree to runtime/process-tree.ts**

Append to `src/runtime/process-tree.ts`:

```typescript
export interface KillProcessTreeResult {
  /** Number of descendants successfully signaled. */
  reaped: number;
}

/**
 * Hard-kill a process group plus a snapshotted descendant list.
 * SIGKILLs the pgid leader, then SIGKILLs each pid in `descendants`
 * (children of an exiting shell get re-parented to init and miss
 * pgid-targeted signals — they have to be reaped by pid).
 *
 * **Pgid invariant:** `pgid == pid` only holds for processes spawned
 * with `detached: true` (the spawn abstraction calls `setsid()` then).
 * If a caller forgets, this silently signals the wrong group.
 *
 * **Caller responsibility:** snapshot descendants while the leader is
 * still alive; once it exits, the parent→child relation through it
 * disappears and `listDescendants` returns nothing useful.
 */
export function killProcessTree(
  pgid: number,
  descendants: number[],
): KillProcessTreeResult {
  try { process.kill(-pgid, "SIGKILL"); } catch { /* already dead */ }
  let reaped = 0;
  for (const pid of descendants) {
    try { process.kill(pid, "SIGKILL"); reaped++; } catch { /* already dead */ }
  }
  return { reaped };
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `bun test test/runtime/process-tree.test.ts -t "killProcessTree"`
Expected: 2 PASS.

- [ ] **Step 5: Route CLI close through the helper**

In `src/adapters/cli/adapter.ts`, find `close()` (around line 136) and replace its body. Both `listDescendants` and `killProcessTree` come from the same module — there is **already** an `import { listDescendants } from "../../runtime/process-tree"` near the top of the file (around line 11); modify that line in place to also import `killProcessTree`. Do not add a second import statement.

Final form of the import line:

```typescript
import { listDescendants, killProcessTree } from "../../runtime/process-tree";
```

Replace the `close()` body:

```typescript
  async close(): Promise<void> {
    if (!this.proc || this.pgid === null) return;
    const pgid = this.pgid;
    const bashPid = this.proc.pid;
    const descendants = listDescendants(bashPid);

    const { reaped } = killProcessTree(pgid, descendants);

    if (reaped > 0 && this.logger) {
      this.logger.logEvent("cli_shell_descendants_reaped", {
        pgid,
        descendantCount: descendants.length,
        reapedCount: reaped,
      });
    }

    this.proc = null;
    this.pgid = null;
  }
```

- [ ] **Step 6: Run CLI adapter tests — verify regression-free**

Run: `bun test test/adapters/cli/adapter.test.ts`
Expected: All existing tests PASS — close behavior is byte-identical (same SIGKILL, same descendant reap, same `cli_shell_descendants_reaped` event with the same payload shape).

- [ ] **Step 7: Commit**

```bash
git add src/runtime/process-tree.ts src/adapters/cli/adapter.ts test/runtime/process-tree.test.ts
git commit -m "runtime: add killProcessTree helper; CLI close routes through it"
```

---

## Task 4: Add bash tool — basic execution

**Files:**
- Create: `src/agent/bash-tool.ts`, `test/agent/bash-tool.test.ts`

Minimal viable bash tool: parameter validation, spawn, drain streams, return formatted result. No caps or timeout yet (those land in Tasks 5–6).

- [ ] **Step 1: Write failing test — basic command execution**

Create `test/agent/bash-tool.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildBashTool } from "../../src/agent/bash-tool";
import type { EvidenceLogger } from "../../src/evidence/logger";

function noopLogger(): EvidenceLogger {
  return { logEvent: () => {} } as unknown as EvidenceLogger;
}

function freshCwd(): string {
  return mkdtempSync(join(tmpdir(), "gauntlet-bash-test-"));
}

describe("buildBashTool", () => {
  test("runs a simple command and captures stdout", async () => {
    const tool = buildBashTool({ cwd: freshCwd() });
    const result = await tool.execute({ command: "echo hello" }, noopLogger());
    expect(result.text).toContain("hello");
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `bun test test/agent/bash-tool.test.ts -t "stdout"`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create src/agent/bash-tool.ts with minimal implementation**

```typescript
import { mkdirSync } from "fs";
import type { ToolDefinition, ToolResult } from "../models/provider";
import type { EvidenceLogger } from "../evidence/logger";
import { spawn } from "../runtime/spawn";

export const BASH_TOOL_DESCRIPTION =
  "The best interface for inspecting logs and files on the host via " +
  "standard Unix tools (rg, tail, grep, cat, wc, find, head, jq, etc.). " +
  "Use this to verify what the system under test actually did or what " +
  "landed on disk — not to drive the SUT itself (use the adapter's " +
  "screen/keyboard tools for that). Each call runs `bash -c <command>` " +
  "in a fresh subprocess; pipes and redirects work; no state persists " +
  "between calls.";

export interface BashToolOptions {
  /** Working directory for every bash call. Created lazily on first call. */
  cwd: string;
}

export interface BashTool {
  definition: ToolDefinition;
  execute(args: Record<string, unknown>, logger: EvidenceLogger): Promise<ToolResult>;
}

export function buildBashTool(opts: BashToolOptions): BashTool {
  const definition: ToolDefinition = {
    name: "bash",
    description: BASH_TOOL_DESCRIPTION,
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to run via `bash -c`.",
        },
      },
      required: ["command"],
    },
  };

  const execute = async (
    args: Record<string, unknown>,
    _logger: EvidenceLogger,
  ): Promise<ToolResult> => {
    const command = typeof args.command === "string" ? args.command : "";
    if (!command) {
      return { text: `Error: bash requires a non-empty "command" argument.` };
    }

    mkdirSync(opts.cwd, { recursive: true });
    const start = Date.now();

    const proc = spawn(["bash", "-c", command], { cwd: opts.cwd });

    const [stdout, stderr] = await Promise.all([
      drainStream(proc.stdout),
      drainStream(proc.stderr),
    ]);
    const code = await proc.exited;
    const elapsedMs = Date.now() - start;

    return {
      text: formatResult({
        stdout,
        stderr,
        exit_code: code < 0 ? null : code,
        truncated: { stdout: false, stderr: false },
        timed_out: false,
        elapsed_ms: elapsedMs,
      }),
    };
  };

  return { definition, execute };
}

async function drainStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

interface BashRunResult {
  stdout: string;
  stderr: string;
  exit_code: number | null;
  truncated: { stdout: boolean; stderr: boolean };
  timed_out: boolean;
  elapsed_ms: number;
}

function formatResult(r: BashRunResult): string {
  const parts: string[] = [];
  parts.push(`exit_code: ${r.exit_code === null ? "null (killed)" : r.exit_code}`);
  parts.push(`elapsed_ms: ${r.elapsed_ms}`);
  if (r.timed_out) parts.push(`timed_out: true`);
  if (r.truncated.stdout) parts.push(`stdout truncated at cap`);
  if (r.truncated.stderr) parts.push(`stderr truncated at cap`);
  parts.push("--- stdout ---");
  parts.push(r.stdout);
  parts.push("--- stderr ---");
  parts.push(r.stderr);
  return parts.join("\n");
}
```

- [ ] **Step 4: Run test — verify it passes**

Run: `bun test test/agent/bash-tool.test.ts -t "stdout"`
Expected: PASS.

- [ ] **Step 5: Add tests for exit codes, stderr, error path, cwd**

Append to `test/agent/bash-tool.test.ts` inside the `describe`:

```typescript
test("captures non-zero exit code", async () => {
  const tool = buildBashTool({ cwd: freshCwd() });
  const result = await tool.execute({ command: "exit 7" }, noopLogger());
  expect(result.text).toContain("exit_code: 7");
});

test("captures stderr separately from stdout", async () => {
  const tool = buildBashTool({ cwd: freshCwd() });
  const result = await tool.execute(
    { command: "echo to-stdout; echo to-stderr >&2" },
    noopLogger(),
  );
  expect(result.text).toContain("to-stdout");
  expect(result.text).toContain("to-stderr");
});

test("missing command returns error", async () => {
  const tool = buildBashTool({ cwd: freshCwd() });
  const result = await tool.execute({}, noopLogger());
  expect(result.text).toMatch(/Error.*command/);
});

test("cwd is honored — pwd reports the configured directory", async () => {
  const cwd = freshCwd();
  const tool = buildBashTool({ cwd });
  const result = await tool.execute({ command: "pwd" }, noopLogger());
  // macOS may resolve /var → /private/var; basename comparison is the safe hedge.
  expect(result.text).toContain(cwd.split("/").pop()!);
});
```

- [ ] **Step 6: Run tests — verify pass**

Run: `bun test test/agent/bash-tool.test.ts`
Expected: 5 PASS.

- [ ] **Step 7: Commit**

```bash
git add src/agent/bash-tool.ts test/agent/bash-tool.test.ts
git commit -m "agent: add bash tool — basic execution + exit code + cwd"
```

---

## Task 5: Output caps + truncation flags

**Files:**
- Modify: `src/agent/bash-tool.ts`, `test/agent/bash-tool.test.ts`

Add `STDOUT_CAP_BYTES = 64 * 1024` and `STDERR_CAP_BYTES = 16 * 1024`. Stream draining stops at the cap; surplus bytes are discarded. Each cap-hit sets the corresponding `truncated` flag.

- [ ] **Step 1: Write failing test for stdout cap**

Append to `test/agent/bash-tool.test.ts`:

```typescript
test("stdout cap truncates large output and sets truncated flag", async () => {
  const tool = buildBashTool({ cwd: freshCwd() });
  // Deterministic 100KB of 'a' — exceeds the 64KB cap.
  const result = await tool.execute(
    { command: "head -c 102400 /dev/zero | tr '\\0' 'a'" },
    noopLogger(),
  );
  expect(result.text).toContain("stdout truncated at cap");
});

test("stderr cap truncates large output and sets truncated flag", async () => {
  const tool = buildBashTool({ cwd: freshCwd() });
  // Deterministic 32KB of 'a' on stderr — exceeds the 16KB stderr cap.
  const result = await tool.execute(
    { command: "head -c 32768 /dev/zero | tr '\\0' 'a' >&2" },
    noopLogger(),
  );
  expect(result.text).toContain("stderr truncated at cap");
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `bun test test/agent/bash-tool.test.ts -t "cap"`
Expected: FAIL — no cap implemented; truncated flag never set.

- [ ] **Step 3: Implement capped drain**

In `src/agent/bash-tool.ts`, replace `drainStream` and add caps as constants:

```typescript
const STDOUT_CAP_BYTES = 64 * 1024;
const STDERR_CAP_BYTES = 16 * 1024;

async function drainStreamCapped(
  stream: ReadableStream<Uint8Array>,
  capBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  const chunks: string[] = [];
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (truncated) continue; // keep draining to let the child finish; discard
    if (bytes + value.byteLength > capBytes) {
      const remaining = capBytes - bytes;
      if (remaining > 0) {
        chunks.push(decoder.decode(value.slice(0, remaining), { stream: true }));
        bytes = capBytes;
      }
      truncated = true;
    } else {
      chunks.push(decoder.decode(value, { stream: true }));
      bytes += value.byteLength;
    }
  }
  chunks.push(decoder.decode());
  return { text: chunks.join(""), truncated };
}
```

Update the call sites in `execute`:

```typescript
    const [stdoutResult, stderrResult] = await Promise.all([
      drainStreamCapped(proc.stdout, STDOUT_CAP_BYTES),
      drainStreamCapped(proc.stderr, STDERR_CAP_BYTES),
    ]);
    const code = await proc.exited;
    const elapsedMs = Date.now() - start;

    return {
      text: formatResult({
        stdout: stdoutResult.text,
        stderr: stderrResult.text,
        exit_code: code < 0 ? null : code,
        truncated: { stdout: stdoutResult.truncated, stderr: stderrResult.truncated },
        timed_out: false,
        elapsed_ms: elapsedMs,
      }),
    };
```

Delete the old `drainStream` helper.

- [ ] **Step 4: Run tests — verify pass**

Run: `bun test test/agent/bash-tool.test.ts`
Expected: 7 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/bash-tool.ts test/agent/bash-tool.test.ts
git commit -m "agent/bash-tool: add stdout (64KB) and stderr (16KB) output caps"
```

---

## Task 6: Timeout + process-tree reaping

**Files:**
- Modify: `src/agent/bash-tool.ts`, `test/agent/bash-tool.test.ts`

Add `timeout_ms` parameter (integer, default 10000, range 100..60000). On timeout: snapshot descendants, call `killProcessTree`, return partial output with `timed_out: true` and `exit_code: null`. Spawn with `detached: true` so the pgid invariant holds.

The descendants snapshot is taken at kill time (inside the setTimeout callback). For one-shot bash subprocesses this is sufficient — by the time the timeout fires, the children that exist are the ones we want to kill.

- [ ] **Step 1: Write failing test for timeout**

Append to `test/agent/bash-tool.test.ts`:

```typescript
test("timeout kills the command and sets timed_out flag", async () => {
  const tool = buildBashTool({ cwd: freshCwd() });
  const start = Date.now();
  const result = await tool.execute(
    { command: "sleep 30", timeout_ms: 200 },
    noopLogger(),
  );
  const elapsed = Date.now() - start;
  expect(elapsed).toBeLessThan(2500);
  expect(result.text).toContain("timed_out: true");
  expect(result.text).toContain("exit_code: null");
});

test("timeout reaps background children spawned by the command", async () => {
  const cwd = freshCwd();
  const { join } = await import("path");
  const { readFileSync } = await import("fs");
  const pidFile = join(cwd, "child.pid");

  const tool = buildBashTool({ cwd });
  await tool.execute(
    {
      command: `sleep 30 & echo $! > ${pidFile}; sleep 30`,
      timeout_ms: 300,
    },
    noopLogger(),
  );

  const childPid = Number(readFileSync(pidFile, "utf-8").trim());
  expect(childPid).toBeGreaterThan(0);

  // Give SIGKILL a moment to land
  await new Promise((r) => setTimeout(r, 100));
  let alive = true;
  try { process.kill(childPid, 0); } catch { alive = false; }
  expect(alive).toBe(false);
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `bun test test/agent/bash-tool.test.ts -t "timeout"`
Expected: FAIL — first test hangs ~30s or fails on flag absence; second leaks the child.

- [ ] **Step 3: Implement timeout in bash-tool.ts**

Add imports:

```typescript
import { killProcessTree, listDescendants } from "../runtime/process-tree";
```

Add constants near the existing caps:

```typescript
const DEFAULT_TIMEOUT_MS = 10_000;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 60_000;
```

Update the parameter schema in `definition`:

```typescript
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to run via `bash -c`.",
        },
        timeout_ms: {
          type: "integer",
          description: `Per-call timeout in milliseconds. Default ${DEFAULT_TIMEOUT_MS}, range ${MIN_TIMEOUT_MS}–${MAX_TIMEOUT_MS}. On timeout, the process tree is SIGKILLed and partial output is returned.`,
          minimum: MIN_TIMEOUT_MS,
          maximum: MAX_TIMEOUT_MS,
        },
      },
      required: ["command"],
    },
```

Replace the spawn + drain section in `execute`:

```typescript
    mkdirSync(opts.cwd, { recursive: true });
    const start = Date.now();

    const timeoutMs =
      typeof args.timeout_ms === "number" && Number.isFinite(args.timeout_ms)
        ? Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, Math.floor(args.timeout_ms)))
        : DEFAULT_TIMEOUT_MS;

    // detached: true makes proc.pid serve as pgid (setsid).
    const proc = spawn(["bash", "-c", command], {
      cwd: opts.cwd,
      detached: true,
    });

    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      const descendants = listDescendants(proc.pid);
      killProcessTree(proc.pid, descendants);
    }, timeoutMs);

    const [stdoutResult, stderrResult] = await Promise.all([
      drainStreamCapped(proc.stdout, STDOUT_CAP_BYTES),
      drainStreamCapped(proc.stderr, STDERR_CAP_BYTES),
    ]);
    const code = await proc.exited;
    clearTimeout(timeoutHandle);
    const elapsedMs = Date.now() - start;

    return {
      text: formatResult({
        stdout: stdoutResult.text,
        stderr: stderrResult.text,
        exit_code: timedOut || code < 0 ? null : code,
        truncated: { stdout: stdoutResult.truncated, stderr: stderrResult.truncated },
        timed_out: timedOut,
        elapsed_ms: elapsedMs,
      }),
    };
```

- [ ] **Step 4: Run tests — verify pass**

Run: `bun test test/agent/bash-tool.test.ts`
Expected: 9 PASS, all under ~3s each.

- [ ] **Step 5: Commit**

```bash
git add src/agent/bash-tool.ts test/agent/bash-tool.test.ts
git commit -m "agent/bash-tool: add timeout_ms with process-tree reaping"
```

---

## Task 7: Env scrubbing with allow-list

**Files:**
- Modify: `src/agent/bash-tool.ts`, `test/agent/bash-tool.test.ts`

Build the child env from a static allow-list rather than inheriting `process.env`. The allow-list combines a minimal base (PATH, HOME, USER, SHELL, LANG, LC_ALL, TERM, TMPDIR, TZ) with the SDK pass-through set the README documents (Anthropic + OpenAI + proxy vars).

- [ ] **Step 1: Write failing test for env scrubbing**

Append to `test/agent/bash-tool.test.ts`:

```typescript
test("env is scrubbed: random parent vars do not leak", async () => {
  process.env.GAUNTLET_BASH_LEAK_TEST = "should-not-appear";
  try {
    const tool = buildBashTool({ cwd: freshCwd() });
    const result = await tool.execute(
      { command: "echo \"LEAK=${GAUNTLET_BASH_LEAK_TEST:-clean}\"" },
      noopLogger(),
    );
    expect(result.text).toContain("LEAK=clean");
  } finally {
    delete process.env.GAUNTLET_BASH_LEAK_TEST;
  }
});

test("env passes through ANTHROPIC_API_KEY when set in parent", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-test-passthrough";
  try {
    const tool = buildBashTool({ cwd: freshCwd() });
    const result = await tool.execute(
      { command: "echo \"K=$ANTHROPIC_API_KEY\"" },
      noopLogger(),
    );
    expect(result.text).toContain("K=sk-test-passthrough");
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
  }
});

test("env includes minimal base vars", async () => {
  const tool = buildBashTool({ cwd: freshCwd() });
  const result = await tool.execute({ command: "echo \"P=${PATH:+set} H=${HOME:+set}\"" }, noopLogger());
  expect(result.text).toContain("P=set");
  expect(result.text).toContain("H=set");
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `bun test test/agent/bash-tool.test.ts -t "env"`
Expected: FAIL on the leak test (parent env inherited; leak shows up).

- [ ] **Step 3: Add env scrubbing**

In `src/agent/bash-tool.ts`, add near other constants:

```typescript
const BASE_ENV_KEYS = [
  "PATH", "HOME", "USER", "SHELL", "LANG", "LC_ALL", "TERM", "TMPDIR", "TZ",
] as const;

const SDK_PASSTHROUGH_KEYS = [
  "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "ANTHROPIC_LOG",
  "OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_ORG_ID", "OPENAI_PROJECT",
  "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY",
] as const;

function buildScrubbedEnv(parent: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of [...BASE_ENV_KEYS, ...SDK_PASSTHROUGH_KEYS]) {
    const v = parent[key];
    if (typeof v === "string") out[key] = v;
  }
  return out;
}
```

Update the spawn call in `execute`:

```typescript
    const proc = spawn(["bash", "-c", command], {
      cwd: opts.cwd,
      detached: true,
      env: buildScrubbedEnv(process.env),
    });
```

- [ ] **Step 4: Run tests — verify pass**

Run: `bun test test/agent/bash-tool.test.ts`
Expected: 12 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/bash-tool.ts test/agent/bash-tool.test.ts
git commit -m "agent/bash-tool: scrub env to allow-list + SDK pass-through"
```

---

## Task 8: Evidence log events

**Files:**
- Modify: `src/agent/bash-tool.ts`, `test/agent/bash-tool.test.ts`

Emit `bash_call` on every successful invocation (whether the command exited 0 or non-zero — those are normal). Emit `bash_spawn_failed` when the spawn itself throws (e.g., bash not on PATH).

- [ ] **Step 1: Write failing test — bash_call event emitted**

Add a recording-logger helper near `noopLogger` in `test/agent/bash-tool.test.ts`:

```typescript
interface CapturedEvent { name: string; payload: Record<string, unknown> }
function recordingLogger(events: CapturedEvent[]): EvidenceLogger {
  return {
    logEvent: (name: string, payload: Record<string, unknown>) => {
      events.push({ name, payload });
    },
  } as unknown as EvidenceLogger;
}
```

Add new tests:

```typescript
test("emits bash_call event with metadata on successful run", async () => {
  const tool = buildBashTool({ cwd: freshCwd() });
  const events: CapturedEvent[] = [];
  await tool.execute({ command: "echo hello" }, recordingLogger(events));
  const call = events.find((e) => e.name === "bash_call");
  expect(call).toBeDefined();
  expect(call!.payload.command).toBe("echo hello");
  expect(call!.payload.exit_code).toBe(0);
  expect(call!.payload.timed_out).toBe(false);
  expect(call!.payload.stdout_bytes).toBeGreaterThan(0);
  expect(typeof call!.payload.elapsed_ms).toBe("number");
});

test("emits bash_call event for non-zero exit (not bash_spawn_failed)", async () => {
  const tool = buildBashTool({ cwd: freshCwd() });
  const events: CapturedEvent[] = [];
  await tool.execute({ command: "exit 7" }, recordingLogger(events));
  const call = events.find((e) => e.name === "bash_call");
  expect(call).toBeDefined();
  expect(call!.payload.exit_code).toBe(7);
  expect(events.find((e) => e.name === "bash_spawn_failed")).toBeUndefined();
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `bun test test/agent/bash-tool.test.ts -t "bash_call"`
Expected: FAIL — events not emitted.

- [ ] **Step 3: Add logger.logEvent calls in execute**

In `src/agent/bash-tool.ts`, change the `_logger` parameter to `logger` (no underscore — now used).

Add the event emission just before the return:

```typescript
    logger.logEvent("bash_call", {
      command,
      cwd: opts.cwd,
      timeout_ms: timeoutMs,
      stdout_bytes: stdoutResult.text.length,
      stderr_bytes: stderrResult.text.length,
      exit_code: timedOut || code < 0 ? null : code,
      timed_out: timedOut,
      truncated: { stdout: stdoutResult.truncated, stderr: stderrResult.truncated },
      elapsed_ms: elapsedMs,
    });
```

Wrap the spawn in a try/catch for bash_spawn_failed:

```typescript
    let proc;
    try {
      proc = spawn(["bash", "-c", command], {
        cwd: opts.cwd,
        detached: true,
        env: buildScrubbedEnv(process.env),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.logEvent("bash_spawn_failed", { command, error: msg });
      return { text: `Error: bash spawn failed: ${msg}` };
    }
```

- [ ] **Step 4: Run tests — verify pass**

Run: `bun test test/agent/bash-tool.test.ts`
Expected: 14 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/bash-tool.ts test/agent/bash-tool.test.ts
git commit -m "agent/bash-tool: emit bash_call and bash_spawn_failed evidence events"
```

---

## Task 9: SharedTools bundle (read + fetch_credential, no bash yet)

**Files:**
- Create: `src/agent/shared-tools.ts`, `test/agent/shared-tools.test.ts`

Bundle the existing two adapter-agnostic tools (`read`, `fetch_credential`) behind a single `SharedTools` interface. No behavior change to the tools themselves; the bundle is purely an indirection that lets the three adapters share one mount/dispatch path. Bash joins the bundle in Task 11; tests for "bash always present" land then.

- [ ] **Step 1: Write failing test — conditional mounts only**

Create `test/agent/shared-tools.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildSharedTools } from "../../src/agent/shared-tools";

function emptyContextRoot(): string {
  return mkdtempSync(join(tmpdir(), "gauntlet-shared-ctx-"));
}

function populatedContextRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "gauntlet-shared-ctx-"));
  mkdirSync(join(root, "users"), { recursive: true });
  writeFileSync(join(root, "users", "alice.md"), "# Alice");
  return root;
}

describe("buildSharedTools", () => {
  test("mounts read when context root populated", () => {
    const bundle = buildSharedTools({ contextRoot: populatedContextRoot() });
    const names = bundle.definitions().map((d) => d.name);
    expect(names).toContain("read");
    expect(bundle.canExecute("read")).toBe(true);
  });

  test("does not mount read when context root empty", () => {
    const bundle = buildSharedTools({ contextRoot: emptyContextRoot() });
    expect(bundle.definitions().map((d) => d.name)).not.toContain("read");
  });

  test("does not mount read when no context root provided", () => {
    const bundle = buildSharedTools({});
    expect(bundle.canExecute("read")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `bun test test/agent/shared-tools.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create src/agent/shared-tools.ts**

```typescript
import type { ToolDefinition, ToolResult } from "../models/provider";
import type { EvidenceLogger } from "../evidence/logger";
import type { CredentialResolverConfig } from "../config";
import { buildReadTool, type ReadTool } from "../context/read-tool";
import { buildFetchCredentialTool, type FetchCredentialTool } from "../context/credential-tool";

export interface SharedToolsOptions {
  contextRoot?: string;
  credentialResolver?: CredentialResolverConfig;
}

export interface SharedTools {
  definitions(): ToolDefinition[];
  canExecute(name: string): boolean;
  execute(
    name: string,
    args: Record<string, unknown>,
    logger: EvidenceLogger,
  ): Promise<ToolResult> | ToolResult;
}

export function buildSharedTools(opts: SharedToolsOptions): SharedTools {
  const readTool: ReadTool | null = opts.contextRoot
    ? buildReadTool(opts.contextRoot)
    : null;
  const credentialTool: FetchCredentialTool | null = buildFetchCredentialTool(
    opts.contextRoot ?? "",
    opts.credentialResolver,
  );

  const definitions = (): ToolDefinition[] => {
    const defs: ToolDefinition[] = [];
    if (readTool) defs.push(readTool.definition);
    if (credentialTool) defs.push(credentialTool.definition);
    return defs;
  };

  const canExecute = (name: string): boolean => {
    if (name === "read") return readTool !== null;
    if (name === "fetch_credential") return credentialTool !== null;
    return false;
  };

  const execute = (
    name: string,
    args: Record<string, unknown>,
    logger: EvidenceLogger,
  ): Promise<ToolResult> | ToolResult => {
    if (name === "read" && readTool) return readTool.execute(args);
    if (name === "fetch_credential" && credentialTool) {
      return credentialTool.execute(args, logger);
    }
    throw new Error(`SharedTools: unknown or unmounted tool: ${name}`);
  };

  return { definitions, canExecute, execute };
}
```

- [ ] **Step 4: Run tests — verify pass**

Run: `bun test test/agent/shared-tools.test.ts`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/shared-tools.ts test/agent/shared-tools.test.ts
git commit -m "agent: introduce SharedTools bundle (read + fetch_credential)"
```

---

## Task 10: Wire SharedTools into all three adapters

**Files:**
- Modify: `src/adapters/cli/adapter.ts`, `src/adapters/web/adapter.ts`, `src/adapters/tui/adapter.ts`, `src/runs/orchestrator.ts`
- Test: existing adapter tests stay green; orchestrator updated for web

Each adapter constructor today calls `buildReadTool(...)` + `buildFetchCredentialTool(...)` directly and dispatches both in `executeTool`. Replace with a single `this.shared = buildSharedTools(...)` call. Behavior must be byte-identical for the existing two tools.

**Note:** CLI and TUI adapters already accept `runDir`. **Only web** needs the new `runDir?: string` option added (used in Task 11 for bash cwd; declare here for forward compatibility).

- [ ] **Step 1: Refactor cli/adapter.ts to use SharedTools**

In `src/adapters/cli/adapter.ts`:

Add to imports:

```typescript
import { buildSharedTools, type SharedTools } from "../../agent/shared-tools";
```

Remove these imports (now indirect):

```typescript
import { buildReadTool, type ReadTool } from "../../context/read-tool";
import { buildFetchCredentialTool, type FetchCredentialTool } from "../../context/credential-tool";
```

Replace the `readTool` + `credentialTool` private fields with:

```typescript
  private shared: SharedTools;
```

Update the constructor (preserving the existing runDir + logger handling):

```typescript
  constructor(options?: CLIAdapterOptions) {
    this.shared = buildSharedTools({
      contextRoot: options?.contextRoot,
      credentialResolver: options?.credentialResolver,
    });
    this.runDir = options?.runDir;
    this.logger = options?.logger;
  }
```

Update `toolDefinitions()` to include the bundle's definitions:

```typescript
  toolDefinitions(): ToolDefinition[] {
    const tools: ToolDefinition[] = [
      // ...existing type/press/read_output entries unchanged...
    ];
    tools.push(...this.shared.definitions());
    return tools;
  }
```

Update `executeTool()` — replace the two `if (name === "read" && this.readTool)` / `if (name === "fetch_credential" && ...)` branches with one delegation, placed after `validateToolArgs` but before the switch:

```typescript
    if (this.shared.canExecute(name)) {
      return this.shared.execute(name, args, logger);
    }
```

- [ ] **Step 2: Run CLI adapter tests — verify regression-free**

Run: `bun test test/adapters/cli/adapter.test.ts`
Expected: All existing tests PASS.

- [ ] **Step 3: Refactor tui/adapter.ts to use SharedTools**

Same pattern as Step 1. TUI already has `runDir?: string` in `TUIAdapterOptions` — do **not** add it again. Just replace the two tool fields with the bundle.

- [ ] **Step 4: Run TUI adapter tests — verify regression-free**

Run: `bun test test/adapters/tui/adapter.test.ts`
Expected: All existing tests PASS.

- [ ] **Step 5: Refactor web/adapter.ts to use SharedTools and add runDir option**

In `src/adapters/web/adapter.ts`:

Add `runDir?: string` to `WebAdapterOptions`:

```typescript
export interface WebAdapterOptions {
  // ...existing fields...
  runDir?: string;
}
```

Apply the same SharedTools refactor pattern. The web adapter currently passes `tab` and a `CookiesDriver` to install_cookies/install_passkey — leave those as-is (they're web-specific and stay outside SharedTools). Only the read + fetch_credential mounts collapse into SharedTools. Store `this.runDir = options?.runDir;` in the constructor.

- [ ] **Step 6: Run web adapter tests — verify regression-free**

Run: `bun test test/adapters/web/adapter.test.ts`
Expected: All existing tests PASS.

- [ ] **Step 7: Thread runDir through orchestrator for the web adapter**

In `src/runs/orchestrator.ts`, find the function that constructs each adapter from `EffectiveRunConfig` (`buildDefaultAdapter` or equivalent). CLI and TUI already receive `runDir` (the run's outDir). Add the same to web:

```typescript
// CLI (existing — unchanged)
new CLIAdapter({ contextRoot, credentialResolver, runDir: outDir, logger });

// TUI (existing — unchanged; already gets runDir)
new TUIAdapter({ ..., runDir: outDir });

// Web (modified — add runDir)
new WebAdapter({ ..., runDir: outDir });
```

(The exact constructor argument names may differ; verify by reading the file before editing. The relevant variable in the orchestrator is the run's output directory — if it's named `outDir`, use that; if it's `runDir` already in scope, use that.)

- [ ] **Step 8: Run all adapter + orchestrator tests**

Run: `bun test test/adapters/ test/runs/`
Expected: All PASS.

- [ ] **Step 9: Commit**

```bash
git add src/adapters/ src/runs/orchestrator.ts
git commit -m "adapters: delegate to SharedTools bundle; thread runDir to web adapter"
```

---

## Task 11: Add bash to the SharedTools bundle

**Files:**
- Modify: `src/agent/shared-tools.ts`, `test/agent/shared-tools.test.ts`, `src/adapters/{cli,web,tui}/adapter.ts`, `test/adapters/{cli,web,tui}/adapter.test.ts`

With SharedTools in place and bash tool standalone, splice them together. Bash is always mounted; cwd is the run scratch dir derived from `runDir`. When no `runDir` is provided (registry tool-introspection path that never executes tools), fall back to a fresh tmpdir — never `process.cwd()`, since that would put the bash tool's cwd at the operator's project root and turn an accidental `bash {command: "rm *"}` into a footgun.

- [ ] **Step 1: Add failing test — bash always present in bundle**

Append to `test/agent/shared-tools.test.ts`:

```typescript
test("always mounts bash regardless of context", () => {
  const bundle = buildSharedTools({ cwd: emptyContextRoot() });
  const names = bundle.definitions().map((d) => d.name);
  expect(names).toContain("bash");
  expect(bundle.canExecute("bash")).toBe(true);
});

test("dispatches bash to the underlying tool", async () => {
  const bundle = buildSharedTools({ cwd: emptyContextRoot() });
  const result = await bundle.execute(
    "bash",
    { command: "echo from-bundle" },
    { logEvent: () => {} } as any,
  );
  expect((result as { text: string }).text).toContain("from-bundle");
});
```

Update the existing tests in this file to pass `cwd` (now required by `SharedToolsOptions`):

- For each existing call to `buildSharedTools({...})`, add `cwd: emptyContextRoot()` (or any fresh tmpdir) to the options bag.

- [ ] **Step 2: Run tests — verify they fail**

Run: `bun test test/agent/shared-tools.test.ts`
Expected: FAIL — bash not yet wired into bundle.

- [ ] **Step 3: Add bash to buildSharedTools**

In `src/agent/shared-tools.ts`:

Add to imports:

```typescript
import { buildBashTool, type BashTool } from "./bash-tool";
```

Update `SharedToolsOptions` (cwd is now required):

```typescript
export interface SharedToolsOptions {
  contextRoot?: string;
  credentialResolver?: CredentialResolverConfig;
  /** Working directory for the bash tool. Required because bash is always mounted. */
  cwd: string;
}
```

In `buildSharedTools`, build the bash tool:

```typescript
  const bashTool: BashTool = buildBashTool({ cwd: opts.cwd });
```

Update `definitions`, `canExecute`, `execute` to include bash:

```typescript
  const definitions = (): ToolDefinition[] => {
    const defs: ToolDefinition[] = [];
    if (readTool) defs.push(readTool.definition);
    if (credentialTool) defs.push(credentialTool.definition);
    defs.push(bashTool.definition);
    return defs;
  };

  const canExecute = (name: string): boolean => {
    if (name === "read") return readTool !== null;
    if (name === "fetch_credential") return credentialTool !== null;
    if (name === "bash") return true;
    return false;
  };

  const execute = (
    name: string,
    args: Record<string, unknown>,
    logger: EvidenceLogger,
  ): Promise<ToolResult> | ToolResult => {
    if (name === "read" && readTool) return readTool.execute(args);
    if (name === "fetch_credential" && credentialTool) {
      return credentialTool.execute(args, logger);
    }
    if (name === "bash") return bashTool.execute(args, logger);
    throw new Error(`SharedTools: unknown or unmounted tool: ${name}`);
  };
```

- [ ] **Step 4: Update each adapter to compute cwd from runDir and pass to buildSharedTools**

For each of `src/adapters/{cli,web,tui}/adapter.ts`, update the `buildSharedTools(...)` call in the constructor. Treat the imports below as **"ensure these are imported"** — most adapters already import some of them (e.g. CLI/TUI already import `join` and `mkdirSync`; web already imports `tmpdir`). Add only the symbols missing from each file's existing imports rather than appending duplicate import statements.

```typescript
import { join } from "path";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
// ...
    const scratch = options?.runDir
      ? join(options.runDir, "scratch")
      : mkdtempSync(join(tmpdir(), "gauntlet-bash-noruncwd-"));
    this.shared = buildSharedTools({
      contextRoot: options?.contextRoot,
      credentialResolver: options?.credentialResolver,
      cwd: scratch,
    });
```

The tmpdir fallback covers the registry tool-introspection construction path that doesn't supply `runDir`. Avoid `process.cwd()` — it would make accidental destructive commands operate on the operator's project root.

- [ ] **Step 5: Add adapter-level test asserting bash appears in toolDefinitions**

In each of `test/adapters/{cli,web,tui}/adapter.test.ts`, add a test. Match each adapter's actual constructor shape — the snippets below show the CLI shape; adjust class name and stub injection per adapter (for web, follow the existing tests' pattern of injecting a stub Chrome session).

```typescript
// test/adapters/cli/adapter.test.ts — CLI is straightforward (no Chrome)
test("toolDefinitions includes bash", () => {
  const adapter = new CLIAdapter({
    runDir: mkdtempSync(join(tmpdir(), "gauntlet-bash-adapter-")),
  });
  const names = adapter.toolDefinitions().map((d) => d.name);
  expect(names).toContain("bash");
});

// test/adapters/tui/adapter.test.ts — same pattern as CLI
test("toolDefinitions includes bash", () => {
  const adapter = new TUIAdapter({
    runDir: mkdtempSync(join(tmpdir(), "gauntlet-bash-adapter-")),
  });
  const names = adapter.toolDefinitions().map((d) => d.name);
  expect(names).toContain("bash");
});

// test/adapters/web/adapter.test.ts — reuse existing chrome-stub pattern from
// the file's other tests (look at how install_cookies tests construct WebAdapter
// with a stub session/driver). Then assert:
test("toolDefinitions includes bash", () => {
  const adapter = new WebAdapter({
    /* whatever stub session + options the existing tests use */
    runDir: mkdtempSync(join(tmpdir(), "gauntlet-bash-adapter-")),
  });
  const names = adapter.toolDefinitions().map((d) => d.name);
  expect(names).toContain("bash");
});
```

- [ ] **Step 6: Run all the above tests**

Run: `bun test test/agent/shared-tools.test.ts test/adapters/`
Expected: All PASS, including the new bash mount tests on each adapter.

- [ ] **Step 7: Commit**

```bash
git add src/agent/shared-tools.ts src/adapters/ test/agent/shared-tools.test.ts test/adapters/
git commit -m "agent/shared-tools: bundle bash and mount on every adapter"
```

---

## Task 12: Add `## Shell access` to the system prompt

**Files:**
- Modify: `src/agent/prompts.ts`
- Test: `test/agent/prompts.test.ts`

Add a single section at composition time, always emitted (the bash tool is always mounted). The prompt-composition function in this codebase is `buildSystemPrompt(card, contextTree, adapterName, projectPrompt)` (positional args; see `src/agent/prompts.ts:43` and existing tests in `test/agent/prompts.test.ts` for usage examples).

- [ ] **Step 1: Write failing test for the new section**

Append to `test/agent/prompts.test.ts`. **Match the existing call sites in this file** for the card shape — but **do not copy any 5th positional argument** if you see one in sibling tests; that's a stale leftover from an old `buildSystemPrompt` signature, and the current function takes exactly 4 positional args (`card, contextTree, adapterName, projectPrompt`). Snippet below is illustrative:

```typescript
test("system prompt includes Shell access section", () => {
  // Use the same minimal card other tests in this file use; copy from a
  // sibling test in this file. Pass exactly 4 args.
  const card = /* minimal valid StoryCard, see other tests in this file */;
  const prompt = buildSystemPrompt(card, undefined, undefined, undefined);
  expect(prompt).toContain("## Shell access");
  expect(prompt).toContain("`bash` tool");
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `bun test test/agent/prompts.test.ts -t "Shell access"`
Expected: FAIL — section not present.

- [ ] **Step 3: Add the section in src/agent/prompts.ts**

Find where other `## ` sections are concatenated (Context, etc., inside `buildSystemPrompt`) and append:

```typescript
const SHELL_ACCESS_SECTION = `## Shell access

You have a \`bash\` tool for inspecting logs and files on the host via
standard Unix utilities (\`rg\`, \`tail\`, \`grep\`, \`cat\`, \`wc\`, \`find\`,
\`head\`, \`jq\`, etc.). Use it to verify what the system under test
actually did or what landed on disk. Do **not** use it to drive the
system under test — the adapter's screen/keyboard tools (type, press,
click, navigate, etc.) are for that.

Each call runs in a fresh subprocess; pipes and redirects work; no
state persists between calls.`;

// Then in buildSystemPrompt, append SHELL_ACCESS_SECTION unconditionally
// to the prompt body.
```

- [ ] **Step 4: Run prompt tests — verify pass**

Run: `bun test test/agent/prompts.test.ts`
Expected: All PASS, including the new section test.

- [ ] **Step 5: Update show-prompt snapshot (if present)**

If `test/cli/show-prompt.test.ts` (or similar) has a snapshot of the composed prompt, regenerate it:

Run: `bun test test/cli/show-prompt.test.ts -u`
Verify the diff includes only the new `## Shell access` section.

- [ ] **Step 6: Commit**

```bash
git add src/agent/prompts.ts test/agent/prompts.test.ts test/cli/
git commit -m "agent/prompts: add Shell access section announcing bash tool"
```

---

## Task 13: Final sweep + commit spec and plan docs

**Files:**
- Add to git: `docs/superpowers/specs/2026-05-15-agent-bash-tool-design.md`, `docs/superpowers/plans/2026-05-15-agent-bash-tool.md`

Run the full test suite to catch any cross-cutting regression. Commit the spec and plan as part of the implementation branch (they were uncommitted at branch start).

- [ ] **Step 1: Run the full test suite**

Run: `bun test`
Expected: All PASS. Investigate and fix any unrelated regressions before proceeding.

- [ ] **Step 2: Run typecheck**

Run: `bun run tsc --noEmit` (or whatever the repo's typecheck command is — check `package.json` scripts).
Expected: No errors.

- [ ] **Step 3: Commit the design and plan docs**

```bash
git add docs/superpowers/specs/2026-05-15-agent-bash-tool-design.md docs/superpowers/plans/2026-05-15-agent-bash-tool.md
git commit -m "docs: spec and plan for agent bash tool (PRI-1615)"
```

- [ ] **Step 4: Verify branch state**

Run: `git log --oneline -20`
Expected: Series of commits implementing each task, ending with the docs commit. No untracked files except the standard `.gauntlet/results/` etc.

- [ ] **Step 5: Move ticket to In Review (per linear-ticket-lifecycle skill)**

Use the Linear MCP to:
1. Update PRI-1615 to state "In Review".
2. Add a reflective implementation comment per the linear-ticket-lifecycle skill (what went smoothly, what was tricky, risk flags, subjective experience).

---

## Self-Review Notes

**Spec coverage check:**
- ✅ bash tool with required parameters: Tasks 4–7
- ✅ Always mounted on every adapter: Task 11
- ✅ Output caps: Task 5
- ✅ Timeout + process-tree reaping: Task 6
- ✅ Env scrub + SDK pass-through: Task 7
- ✅ Evidence log events (`bash_call`, `bash_spawn_failed`): Task 8
- ✅ SharedTools bundle (DRY refactor): Tasks 9–11
- ✅ runtime/spawn.ts env + timeout_ms: Tasks 1–2
- ✅ killProcessTree helper + CLI close routes through it: Task 3
- ✅ System prompt `## Shell access` section: Task 12
- ✅ Tests at `test/<mirror-of-src>/...`: throughout
- ✅ Tool description is use-case-shaped (not "runs any shell command"): Task 4 Step 3 (`BASH_TOOL_DESCRIPTION` constant) and Task 12 Step 3 (`SHELL_ACCESS_SECTION`)

**Type/method consistency check:** `buildBashTool`, `buildSharedTools`, `BashTool`, `SharedTools`, `killProcessTree`, `BASE_ENV_KEYS`, `SDK_PASSTHROUGH_KEYS` used consistently across tasks. Parameter `timeout_ms` (snake_case for agent-facing, matching tool API style) vs `timeoutMs` (internal camelCase) is intentional.

**Open implementation notes flagged for executor:**
- The orchestrator's `buildDefaultAdapter` shape (Task 10 Step 7) — verify the parameter name for the run output directory matches what the file actually uses (`outDir`, `runDir`, etc.) before editing.
- The web adapter's tests (Task 11 Step 5) — copy the existing chrome-session stub pattern from sibling tests in `test/adapters/web/adapter.test.ts` rather than constructing a fresh chrome session.
