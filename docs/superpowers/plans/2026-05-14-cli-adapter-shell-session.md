# CLI adapter shell-as-session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the CLI adapter's single-program-spawn model with a long-lived bash session. Target becomes informational; existing tools drive the shell. Process-group cleanup catches forgotten children.

**Architecture:** `start()` spawns `bash --norc --noprofile -i` with `setsid` (via Bun.spawn `detached: true`) in `<runDir>/scratch/`. The shell is the durable thing the agent drives. `close()` escalates `\nexit\n` → SIGHUP → SIGKILL on the pgrp.

**Tech Stack:** TypeScript / Bun. Tests use `bun:test`. Existing `src/runtime/spawn.ts` is extended with `cwd` + `detached` options and `pid` + `exited` on the returned process.

**Spec:** `docs/superpowers/specs/2026-05-14-cli-adapter-shell-session-spec.md` (commits `5724ef4`, `a7dc7ba`).

**Linear:** [PRI-1608](https://linear.app/prime-radiant/issue/PRI-1608/). Blocks PRI-1604.

**Order:** spawn primitive → adapter rewrite → docs. TDD throughout; each layer green before the next starts.

---

## File structure

```
src/runtime/spawn.ts                        # T1: extend with cwd/detached/pid/exited
src/adapters/cli/adapter.ts                 # T2–T6: rewrite to shell-as-session
docs/tutorial.md                            # T7: rewrite the chained-shell example
examples/tutorial/README.md                 # T7: same rewrite

test/runtime/spawn.test.ts                  # T1 additions
test/adapters/cli-adapter.test.ts           # T2–T6 (new file)
```

Single point of behavior change: `CLIAdapter`. `spawn()` gets new optional fields. Nothing else changes — `Adapter` interface unchanged, `initial-message.ts` unchanged, orchestrator unchanged (it already passes `runDir` adjacent fields and the adapter constructor takes options).

Adapter construction gets a new `runDir` option. `buildDefaultAdapter` in `src/runs/orchestrator.ts` already has `outDir` in scope (it just doesn't pass it to the CLI constructor today); plumb it.

---

## Task 1: Extend `spawn.ts` with `cwd`, `detached`, `pid`, `exited`

**Files:**
- Modify: `src/runtime/spawn.ts`
- Modify: `test/runtime/spawn.test.ts`

- [ ] **Step 1: Add failing tests for the new fields**

Append to `test/runtime/spawn.test.ts`:

```ts
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("spawn options + new fields", () => {
  test("cwd option puts the child in the named directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "spawn-cwd-"));
    try {
      const proc = spawn(["sh", "-c", "pwd"], { cwd: dir });
      const out = await readAll(proc.stdout);
      // macOS canonicalizes /var → /private/var; accept either.
      expect(out.trim().endsWith(dir) || out.trim() === dir).toBe(true);
      await proc.exited;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("pid is the child's pid; exited resolves to the exit code", async () => {
    const proc = spawn(["sh", "-c", "exit 7"]);
    expect(typeof proc.pid).toBe("number");
    expect(proc.pid).toBeGreaterThan(0);
    const code = await proc.exited;
    expect(code).toBe(7);
  });

  test("exited resolves even if process already exited before await", async () => {
    const proc = spawn(["sh", "-c", "exit 0"]);
    // Sleep long enough that the process has exited by the time we await.
    await new Promise((r) => setTimeout(r, 200));
    const code = await proc.exited;
    expect(code).toBe(0);
  });

  test("detached makes the child a session leader (pid is its own pgid)", async () => {
    const proc = spawn(["sh", "-c", "ps -o pgid= -p $$"], { detached: true });
    const out = (await readAll(proc.stdout)).trim();
    const childPgid = Number(out);
    expect(childPgid).toBe(proc.pid);
    await proc.exited;
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/runtime/spawn.test.ts`
Expected: FAIL — `spawn` doesn't accept options; `pid` and `exited` don't exist on `SpawnedProcess`.

- [ ] **Step 3: Implement the changes**

Replace the contents of `src/runtime/spawn.ts` with the following. The diff vs current is: add `SpawnOptions`, add `pid` + `exited` to `SpawnedProcess`, thread the options through both Bun and Node code paths, build the Node-side `exited` promise.

```ts
import {
  spawn as nodeSpawn,
  spawnSync as nodeSpawnSync,
} from "node:child_process";
import { Readable } from "node:stream";

/**
 * Cross-runtime subprocess primitives. Production code calls these instead
 * of `Bun.spawn` / `Bun.spawnSync` so the rest of the codebase stays
 * runtime-agnostic. The adapter chosen at module load is sticky for the
 * lifetime of the process.
 */
const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";

export interface SpawnOptions {
  /** Working directory for the child process. */
  cwd?: string;
  /**
   * When true, the child becomes a session leader (calls `setsid()` on
   * POSIX). Its pid equals its pgid, so `process.kill(-pid, signal)`
   * targets the entire process group — used by callers that need to reap
   * the whole tree at cleanup time (e.g. `src/adapters/cli/adapter.ts`).
   */
  detached?: boolean;
}

export interface SpawnedProcess {
  pid: number;
  stdin: { write(data: string | Uint8Array): void; flush(): void };
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  kill(): void;
  /**
   * Resolves with the child's exit code when it exits. Resolves with -1
   * when the child was killed by a signal (signal info isn't part of the
   * contract; callers that care can inspect the signal separately).
   * Safe to await after the child has already exited.
   */
  exited: Promise<number>;
}

export interface SpawnSyncResult {
  exitCode: number | null;
  stdout: Uint8Array;
  stderr: Uint8Array;
}

export function spawn(argv: string[], options?: SpawnOptions): SpawnedProcess {
  return isBun ? spawnViaBun(argv, options) : spawnViaNode(argv, options);
}

export function spawnSync(argv: string[]): SpawnSyncResult {
  return isBun ? spawnSyncViaBun(argv) : spawnSyncViaNode(argv);
}

function spawnViaBun(argv: string[], options?: SpawnOptions): SpawnedProcess {
  const Bun = (globalThis as { Bun: typeof globalThis.Bun }).Bun;
  const proc = Bun.spawn(argv, {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    cwd: options?.cwd,
    // Bun.spawn calls setsid() in the child on POSIX when detached: true.
    // We don't `unref` — we want to await proc.exited at close time.
    ...(options?.detached ? { detached: true } : {}),
  }) as Bun.Subprocess<"pipe", "pipe", "pipe">;
  return {
    pid: proc.pid,
    stdin: {
      write: (d) => { proc.stdin.write(d as string); },
      flush: () => { proc.stdin.flush(); },
    },
    stdout: proc.stdout,
    stderr: proc.stderr,
    kill: () => { proc.kill(); },
    exited: proc.exited.then((code) => code ?? -1),
  };
}

function spawnViaNode(argv: string[], options?: SpawnOptions): SpawnedProcess {
  const proc = nodeSpawn(argv[0]!, argv.slice(1), {
    stdio: ["pipe", "pipe", "pipe"],
    cwd: options?.cwd,
    detached: options?.detached === true,
  });
  if (!proc.stdin || !proc.stdout || !proc.stderr) {
    throw new Error("Node spawn returned a process with missing stdio");
  }
  // proc.pid is `number | undefined` until the process has started; in
  // practice it is set synchronously. Guard the rare missing case to keep
  // the SpawnedProcess.pid contract honest.
  if (proc.pid === undefined) {
    throw new Error("Node spawn returned a process with no pid");
  }
  const exited = new Promise<number>((resolve) => {
    if (proc.exitCode !== null) {
      resolve(proc.exitCode);
      return;
    }
    proc.once("exit", (code, _signal) => resolve(code ?? -1));
  });
  return {
    pid: proc.pid,
    stdin: {
      write: (d) => { proc.stdin!.write(d); },
      // Node's child_process stdin flushes synchronously to the kernel
      // pipe on each write call; there's no equivalent of FileSink.flush.
      flush: () => {},
    },
    stdout: Readable.toWeb(proc.stdout) as unknown as ReadableStream<Uint8Array>,
    stderr: Readable.toWeb(proc.stderr) as unknown as ReadableStream<Uint8Array>,
    kill: () => { proc.kill(); },
    exited,
  };
}

function spawnSyncViaBun(argv: string[]): SpawnSyncResult {
  const Bun = (globalThis as { Bun: typeof globalThis.Bun }).Bun;
  const r = Bun.spawnSync(argv);
  return {
    exitCode: r.exitCode,
    stdout: new Uint8Array(r.stdout),
    stderr: new Uint8Array(r.stderr),
  };
}

function spawnSyncViaNode(argv: string[]): SpawnSyncResult {
  const r = nodeSpawnSync(argv[0]!, argv.slice(1));
  return {
    exitCode: r.status,
    stdout: r.stdout ? new Uint8Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.byteLength) : new Uint8Array(),
    stderr: r.stderr ? new Uint8Array(r.stderr.buffer, r.stderr.byteOffset, r.stderr.byteLength) : new Uint8Array(),
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `bun test test/runtime/spawn.test.ts`
Expected: PASS — all the new tests plus the pre-existing ones.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/spawn.ts test/runtime/spawn.test.ts
git commit -m "runtime/spawn: cwd, detached, pid, exited (PRI-1608)"
```

---

## Task 2: CLI adapter — spawn bash, create scratch dir

**Files:**
- Modify: `src/adapters/cli/adapter.ts`
- Create: `test/adapters/cli-adapter.test.ts`
- Modify: `src/runs/orchestrator.ts` (plumb `runDir` into the CLI adapter constructor)

- [ ] **Step 1: Write a failing test for shell spawn + scratch dir**

Content for `test/adapters/cli-adapter.test.ts`:

```ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { CLIAdapter } from "../../src/adapters/cli/adapter";
import { EvidenceLogger } from "../../src/evidence/logger";

let runDir: string;
let logger: EvidenceLogger;

beforeEach(() => {
  runDir = mkdtempSync(join(tmpdir(), "cli-adapter-"));
  logger = new EvidenceLogger(runDir);
});

afterEach(() => {
  rmSync(runDir, { recursive: true, force: true });
});

describe("CLIAdapter — shell session", () => {
  test("start() creates <runDir>/scratch and runs bash there", async () => {
    const adapter = new CLIAdapter({ contextRoot: undefined, runDir });
    await adapter.start("docker");
    try {
      const scratch = join(runDir, "scratch");
      expect(existsSync(scratch)).toBe(true);
      // Verify the shell's cwd is the scratch dir.
      await adapter.executeTool("type", { text: "pwd\n" }, logger);
      // Give bash a beat to respond.
      await new Promise((r) => setTimeout(r, 200));
      const out = await adapter.executeTool("read_output", {}, logger);
      expect(out.text).toContain(scratch);
    } finally {
      await adapter.close();
    }
  });

  test("describeTarget mentions the shell and the target command", () => {
    const adapter = new CLIAdapter({ contextRoot: undefined, runDir });
    const msg = adapter.describeTarget("docker");
    expect(msg).toContain("bash");
    expect(msg).toContain("docker");
    expect(msg).toContain("exit");  // tells the agent to type exit when done
  });

  test("describeTarget omits the target sentence when target is empty", () => {
    const adapter = new CLIAdapter({ contextRoot: undefined, runDir });
    const msg = adapter.describeTarget("");
    expect(msg).toContain("bash");
    expect(msg).not.toMatch(/command you are exercising/i);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `bun test test/adapters/cli-adapter.test.ts`
Expected: FAIL — `runDir` option not accepted; describeTarget still says "A CLI program is already running."

- [ ] **Step 3: Replace `src/adapters/cli/adapter.ts`**

Replace the file contents:

```ts
import { mkdirSync } from "fs";
import { join } from "path";
import type { Adapter } from "../adapter";
import type { ToolDefinition, ToolResult } from "../../models/provider";
import type { EvidenceLogger } from "../../evidence/logger";
import { buildReadTool, type ReadTool } from "../../context/read-tool";
import { validateToolArgs } from "../../agent/validators";
import { spawn, type SpawnedProcess } from "../../runtime/spawn";

const KEY_MAP: Record<string, string> = {
  Enter: "\n",
  Tab: "\t",
  Escape: "\x1b",
  "Ctrl+C": "\x03",
  "Ctrl+D": "\x04",
  "Ctrl+Z": "\x1a",
};

const GRACE_MS = 500;

export interface CLIAdapterOptions {
  contextRoot?: string;
  /**
   * Per-run directory under which the adapter creates a `scratch/`
   * subdirectory that becomes the shell's cwd. The orchestrator passes
   * the run's `outDir` here. Optional only so the registry's
   * tool-introspection construction (which never starts a shell) still
   * works; in production it is always set.
   */
  runDir?: string;
  /**
   * Logger used by the adapter to emit cleanup-fallback events
   * (`cli_shell_force_killed`). Optional for the same registry reason.
   */
  logger?: EvidenceLogger;
}

export class CLIAdapter implements Adapter {
  readonly name = "cli";
  private proc: SpawnedProcess | null = null;
  private pgid: number | null = null;
  private buffer = "";
  private readTool: ReadTool | null;
  private toolSchemas: Map<string, ToolDefinition["parameters"]> | null = null;
  private runDir: string | undefined;
  private logger: EvidenceLogger | undefined;
  private scratchDir: string | null = null;

  constructor(options?: CLIAdapterOptions) {
    this.readTool = options?.contextRoot
      ? buildReadTool(options.contextRoot)
      : null;
    this.runDir = options?.runDir;
    this.logger = options?.logger;
  }

  async start(_target: string): Promise<void> {
    // Target is informational only — see describeTarget. We spawn bash,
    // not the target.
    this.buffer = "";
    if (!this.runDir) {
      throw new Error("CLIAdapter: runDir is required to start a session");
    }
    const scratch = join(this.runDir, "scratch");
    mkdirSync(scratch, { recursive: true });
    this.scratchDir = scratch;

    this.proc = spawn(
      ["bash", "--norc", "--noprofile", "-i"],
      { cwd: scratch, detached: true },
    );
    this.pgid = this.proc.pid;

    this.readStream(this.proc.stdout);
    this.readStream(this.proc.stderr);
  }

  private readStream(stream: ReadableStream<Uint8Array>): void {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const pump = (): void => {
      reader.read().then(({ done, value }) => {
        if (done) return;
        this.buffer += decoder.decode(value, { stream: true });
        pump();
      });
    };
    pump();
  }

  readOutput(): string {
    const output = this.buffer;
    this.buffer = "";
    return output;
  }

  describeTarget(target: string): string {
    const base =
      `You are at an interactive bash shell. Use \`type\` and \`press\` to ` +
      `issue shell commands and answer any prompts. The shell is your ` +
      `durable session — many commands can run through it during the ` +
      `run. When you are finished, type \`exit\` to close the shell cleanly.`;
    if (!target) return base;
    return (
      `${base} The command you are exercising is \`${target}\`.`
    );
  }

  defaultViewport(): null {
    return null;
  }

  async type(text: string): Promise<void> {
    if (!this.proc) throw new Error("Process not started");
    this.proc.stdin.write(text);
    this.proc.stdin.flush();
  }

  async press(key: string): Promise<void> {
    const mapped = KEY_MAP[key];
    if (!mapped) throw new Error(`Unknown key: ${key}`);
    await this.type(mapped);
  }

  async close(): Promise<void> {
    if (!this.proc || this.pgid === null) return;
    const pgid = this.pgid;
    const startedAt = Date.now();

    // Graceful: leading newline flushes any half-typed line before `exit`.
    try {
      this.proc.stdin.write("\nexit\n");
      this.proc.stdin.flush();
    } catch {
      // shell may already be dead — that's fine, we move on
    }
    if (await this.awaitExitWithin(GRACE_MS)) {
      this.cleanupRefs();
      return;
    }

    // Fallback 1: SIGHUP the pgrp. Interactive bash exits on SIGHUP.
    try {
      process.kill(-pgid, "SIGHUP");
    } catch {
      // already dead
    }
    if (await this.awaitExitWithin(GRACE_MS)) {
      this.logForceKilled(pgid, "sighup", Date.now() - startedAt);
      this.cleanupRefs();
      return;
    }

    // Fallback 2: SIGKILL the pgrp. Can't be ignored.
    try {
      process.kill(-pgid, "SIGKILL");
    } catch {
      // already dead
    }
    // SIGKILL always reaps; if exited didn't already resolve, await it briefly.
    await this.awaitExitWithin(GRACE_MS);
    this.logForceKilled(pgid, "sigkill", Date.now() - startedAt);
    this.cleanupRefs();
  }

  private async awaitExitWithin(ms: number): Promise<boolean> {
    if (!this.proc) return true;
    const exited = this.proc.exited;
    const result = await Promise.race([
      exited.then(() => true),
      new Promise<false>((r) => setTimeout(() => r(false), ms)),
    ]);
    return result;
  }

  private logForceKilled(pgid: number, step: "sighup" | "sigkill", durationMs: number): void {
    if (!this.logger) return;
    this.logger.logEvent("cli_shell_force_killed", {
      pgid,
      escalationStep: step,
      durationMs,
    });
  }

  private cleanupRefs(): void {
    this.proc = null;
    this.pgid = null;
    this.scratchDir = null;
  }

  isMutatingTool(name: string): boolean {
    return name === "type" || name === "press";
  }

  toolDefinitions(): ToolDefinition[] {
    const tools: ToolDefinition[] = [
      {
        name: "type",
        description: "Type text into the shell stdin (commands and prompt answers)",
        parameters: {
          type: "object",
          properties: {
            text: { type: "string", description: "Text to type" },
          },
          required: ["text"],
        },
      },
      {
        name: "press",
        description:
          "Press a special key (Enter, Tab, Escape, Ctrl+C, Ctrl+D, Ctrl+Z)",
        parameters: {
          type: "object",
          properties: {
            key: { type: "string", description: "Key name to press" },
          },
          required: ["key"],
        },
      },
      {
        name: "read_output",
        description:
          "Read and clear the buffered terminal output since last read",
        parameters: {
          type: "object",
          properties: {},
        },
      },
    ];
    if (this.readTool) {
      tools.push(this.readTool.definition);
    }
    return tools;
  }

  async executeTool(
    name: string,
    args: Record<string, unknown>,
    logger: EvidenceLogger,
  ): Promise<ToolResult> {
    if (!this.toolSchemas) {
      this.toolSchemas = new Map(
        this.toolDefinitions().map((t) => [t.name, t.parameters] as const),
      );
    }
    const schema = this.toolSchemas.get(name);
    if (schema) {
      const check = validateToolArgs(name, args, schema);
      if (!check.ok) {
        return { text: `Error: invalid args for ${name}: ${check.reason}` };
      }
    }

    if (name === "read" && this.readTool) {
      return this.readTool.execute(args);
    }

    switch (name) {
      case "type": {
        await this.type(args.text as string);
        return { text: "typed" };
      }
      case "press": {
        await this.press(args.key as string);
        return { text: "pressed" };
      }
      case "read_output": {
        return { text: this.readOutput() };
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}
```

- [ ] **Step 4: Plumb runDir and logger into `buildDefaultAdapter`**

Edit `src/runs/orchestrator.ts` line 157. Change:

```ts
    case "cli":
      return new CLIAdapter({ contextRoot, credentialResolver });
```

to:

```ts
    case "cli":
      return new CLIAdapter({ contextRoot, runDir: outDir, logger });
```

Wait — `outDir` and `logger` aren't currently in scope inside `buildDefaultAdapter`. They are in scope at the call site (`executeRunCore`, line 200-208). Add them to `buildDefaultAdapter`'s parameter list:

Edit `src/runs/orchestrator.ts` lines 146–174. Replace:

```ts
async function buildDefaultAdapter(
  type: RunAdapterType,
  contextRoot: string,
  logger: EvidenceLogger,
  runId: string,
  chrome: ChromeEndpoint | undefined,
  viewport: Viewport | undefined,
  credentialResolver: CredentialResolverConfig | undefined,
): Promise<Adapter> {
  switch (type) {
    case "cli":
      return new CLIAdapter({ contextRoot, credentialResolver });
    case "tui": {
      const { TUIAdapter } = await import("../adapters/tui/adapter");
      return new TUIAdapter({ contextRoot, credentialResolver });
    }
    case "web": {
      const { WebAdapter } = await import("../adapters/web/adapter");
      return new WebAdapter({
        chrome,
        contextRoot,
        logger,
        chromeProfileName: `gauntlet-run-${runId}`,
        viewport,
        credentialResolver,
      });
    }
  }
}
```

with:

```ts
async function buildDefaultAdapter(
  type: RunAdapterType,
  contextRoot: string,
  logger: EvidenceLogger,
  runId: string,
  runDir: string,
  chrome: ChromeEndpoint | undefined,
  viewport: Viewport | undefined,
  credentialResolver: CredentialResolverConfig | undefined,
): Promise<Adapter> {
  switch (type) {
    case "cli":
      return new CLIAdapter({ contextRoot, runDir, logger });
    case "tui": {
      const { TUIAdapter } = await import("../adapters/tui/adapter");
      return new TUIAdapter({ contextRoot, credentialResolver });
    }
    case "web": {
      const { WebAdapter } = await import("../adapters/web/adapter");
      return new WebAdapter({
        chrome,
        contextRoot,
        logger,
        chromeProfileName: `gauntlet-run-${runId}`,
        viewport,
        credentialResolver,
      });
    }
  }
}
```

And update the call at lines 198–208. Replace:

```ts
  const adapter = await (opts.adapterFactory
    ? opts.adapterFactory({ contextRoot, runId, logger })
    : buildDefaultAdapter(
        runConfig.adapter,
        contextRoot,
        logger,
        runId,
        runConfig.chrome,
        runConfig.viewport,
        runConfig.credentialResolver,
      ));
```

with:

```ts
  const adapter = await (opts.adapterFactory
    ? opts.adapterFactory({ contextRoot, runId, logger })
    : buildDefaultAdapter(
        runConfig.adapter,
        contextRoot,
        logger,
        runId,
        outDir,
        runConfig.chrome,
        runConfig.viewport,
        runConfig.credentialResolver,
      ));
```

Note: the existing CLI adapter took `credentialResolver`. The new one drops it because shell-as-session doesn't need credential injection at the adapter layer — that's a context-tree concern. Verify no other test or code paths depend on the credential resolver being on the CLI adapter (a grep of `CLIAdapter` will tell you). If they do, keep the option, just don't use it inside the adapter.

- [ ] **Step 5: Run the CLI adapter test suite**

Run: `bun test test/adapters/cli-adapter.test.ts`
Expected: PASS — three tests.

- [ ] **Step 6: Run the full project tests**

Run: `bun test`
Expected: PASS. Watch for any test that constructs `CLIAdapter` directly without `runDir` and fails — likely candidates: `test/adapters/is-mutating-tool.test.ts`, `test/e2e/cli-smoke.test.ts`, `test/e2e/cli-bc.test.ts`. If any fail because they call `adapter.start()` without `runDir`, update them to pass a tempdir.

- [ ] **Step 7: Commit**

```bash
git add src/adapters/cli/adapter.ts src/runs/orchestrator.ts test/adapters/cli-adapter.test.ts
git commit -m "adapters/cli: shell-as-session (bash + scratch + setsid) (PRI-1608)"
```

---

## Task 3: CLI adapter — cleanup escalation tests

**Files:**
- Modify: `test/adapters/cli-adapter.test.ts`

- [ ] **Step 1: Write failing tests for the three cleanup paths**

Append to `test/adapters/cli-adapter.test.ts`:

```ts
import { spawnSync } from "bun";

function pidStillAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);  // signal 0 = check only
    return true;
  } catch {
    return false;
  }
}

describe("CLIAdapter — close escalation", () => {
  test("graceful exit: \\nexit\\n triggers no SIGHUP or SIGKILL", async () => {
    const adapter = new CLIAdapter({ contextRoot: undefined, runDir, logger });
    await adapter.start("");
    // Read any startup banner before close so we measure the close path.
    await new Promise((r) => setTimeout(r, 100));
    await adapter.close();
    // run.jsonl shouldn't contain a force-killed event.
    const fs = await import("fs");
    const jsonl = fs.readFileSync(join(runDir, "run.jsonl"), "utf8");
    expect(jsonl).not.toContain("cli_shell_force_killed");
  });

  test("orphan reap: backgrounded sleep is gone after close", async () => {
    const adapter = new CLIAdapter({ contextRoot: undefined, runDir, logger });
    await adapter.start("");
    // Spawn a backgrounded sleep, capture its pid via $!.
    await adapter.executeTool(
      "type",
      { text: "sleep 999 & echo PID=$!\n" },
      logger,
    );
    await new Promise((r) => setTimeout(r, 300));
    const out = await adapter.executeTool("read_output", {}, logger);
    const match = out.text.match(/PID=(\d+)/);
    expect(match).not.toBeNull();
    const childPid = Number(match![1]);
    expect(pidStillAlive(childPid)).toBe(true);

    await adapter.close();
    // Give the OS a beat to finalize the reap.
    await new Promise((r) => setTimeout(r, 100));
    expect(pidStillAlive(childPid)).toBe(false);
  });

  test("half-typed line: close still exits cleanly", async () => {
    const adapter = new CLIAdapter({ contextRoot: undefined, runDir, logger });
    await adapter.start("");
    // Type a partial command with no trailing newline.
    await adapter.executeTool("type", { text: "echo partial" }, logger);
    await new Promise((r) => setTimeout(r, 100));
    // Close — the leading \n in \nexit\n flushes the partial line first.
    await adapter.close();
    // No force-killed event expected.
    const fs = await import("fs");
    const jsonl = fs.readFileSync(join(runDir, "run.jsonl"), "utf8");
    expect(jsonl).not.toContain("cli_shell_force_killed");
  });
});
```

- [ ] **Step 2: Run tests; expect them to pass**

Run: `bun test test/adapters/cli-adapter.test.ts`
Expected: PASS — close() logic was already implemented in Task 2; these tests verify it works end-to-end.

If a test fails, the most likely causes are:
- `GRACE_MS` too short for the test environment — bump it temporarily in the adapter to triage, then fix the underlying race.
- The Bun pipe buffer not flushing — confirm `proc.stdin.flush()` is called after writing `\nexit\n`.
- A test platform without `pgrep`/`process.kill(0, ...)` — the tests use the latter (POSIX-only), so they shouldn't run on Windows. The project doesn't support Windows, so this is fine.

- [ ] **Step 3: Commit**

```bash
git add test/adapters/cli-adapter.test.ts
git commit -m "adapters/cli: tests pin close escalation paths (PRI-1608)"
```

---

## Task 4: CLI adapter — SIGHUP and SIGKILL fallback tests

**Files:**
- Modify: `test/adapters/cli-adapter.test.ts`

These exercise the fallback legs by using a shell that traps `\nexit\n` (silently ignores it) or both `\nexit\n` and `SIGHUP`. We can't actually trap "the agent typed exit" inside bash itself, but we can make the shell ignore SIGHUP and SIGTERM via `trap`. To trigger the SIGHUP leg we need bash to *not* respond to `\nexit\n` within `GRACE_MS` — easy: have it `sleep` first.

- [ ] **Step 1: Write the SIGHUP-suffices test**

Append to `test/adapters/cli-adapter.test.ts`:

```ts
describe("CLIAdapter — fallback escalation", () => {
  test("SIGHUP-suffices: bash that ignores \\nexit\\n exits on SIGHUP", async () => {
    const adapter = new CLIAdapter({ contextRoot: undefined, runDir, logger });
    await adapter.start("");
    // Install a trap that makes bash sleep on every command rather than
    // act on `exit` — but not on SIGHUP (default action: terminate).
    // The simplest way is to put bash into a long `read` so the `exit`
    // we send becomes pending input on the line that the read is consuming.
    await adapter.executeTool(
      "type",
      { text: "read -r blocking_input\n" },
      logger,
    );
    await new Promise((r) => setTimeout(r, 100));

    // Now close. \nexit\n becomes input to `read`, not a command — bash
    // doesn't exit gracefully. SIGHUP terminates bash (default action).
    await adapter.close();

    // Verify the force-killed event fired with step "sighup".
    const fs = await import("fs");
    const jsonl = fs.readFileSync(join(runDir, "run.jsonl"), "utf8");
    expect(jsonl).toContain("cli_shell_force_killed");
    expect(jsonl).toContain('"escalationStep":"sighup"');
  });

  test("SIGKILL fallback: shell that ignores SIGHUP gets SIGKILL", async () => {
    const adapter = new CLIAdapter({ contextRoot: undefined, runDir, logger });
    await adapter.start("");
    // Install a SIGHUP trap that ignores the signal AND put bash in a
    // pending `read` so `\nexit\n` is consumed as input.
    await adapter.executeTool(
      "type",
      { text: "trap '' HUP\nread -r blocking_input\n" },
      logger,
    );
    await new Promise((r) => setTimeout(r, 200));

    await adapter.close();

    const fs = await import("fs");
    const jsonl = fs.readFileSync(join(runDir, "run.jsonl"), "utf8");
    expect(jsonl).toContain("cli_shell_force_killed");
    expect(jsonl).toContain('"escalationStep":"sigkill"');
  });
});
```

- [ ] **Step 2: Run tests**

Run: `bun test test/adapters/cli-adapter.test.ts`
Expected: PASS. The SIGHUP test exercises the first fallback; the SIGKILL test exercises the second.

If a fallback test takes the wrong leg (e.g. SIGKILL test reports `escalationStep:"sighup"`), the trap isn't sticking — verify the `trap '' HUP` lands by typing `trap -p\n` before `read` and inspecting `read_output`.

- [ ] **Step 3: Commit**

```bash
git add test/adapters/cli-adapter.test.ts
git commit -m "adapters/cli: tests pin SIGHUP and SIGKILL fallback paths (PRI-1608)"
```

---

## Task 5: npm-init compatibility test

**Files:**
- Modify: `test/adapters/cli-adapter.test.ts`

End-to-end test that the existing prompt-response pattern works under the new adapter. We use a tiny stub `prompts.sh` script that prompts for input and echoes it back — equivalent to npm-init for our purposes without depending on npm being installed.

- [ ] **Step 1: Write the prompt-response test**

Append to `test/adapters/cli-adapter.test.ts`:

```ts
import { writeFileSync, chmodSync } from "fs";

describe("CLIAdapter — prompt-response compatibility", () => {
  test("agent can drive an interactive prompt-and-answer script", async () => {
    // Write a tiny prompts script into the scratch dir so it's on cwd.
    const scratch = join(runDir, "scratch");
    require("fs").mkdirSync(scratch, { recursive: true });
    const scriptPath = join(scratch, "prompts.sh");
    writeFileSync(
      scriptPath,
      [
        "#!/usr/bin/env bash",
        'read -p "name: " name',
        'read -p "color: " color',
        'echo "got: $name / $color"',
      ].join("\n") + "\n",
    );
    chmodSync(scriptPath, 0o755);

    const adapter = new CLIAdapter({ contextRoot: undefined, runDir, logger });
    await adapter.start("prompts.sh");
    try {
      // Invoke the script.
      await adapter.executeTool("type", { text: "./prompts.sh\n" }, logger);
      await new Promise((r) => setTimeout(r, 200));
      // First prompt: name.
      await adapter.executeTool("type", { text: "fred\n" }, logger);
      await new Promise((r) => setTimeout(r, 100));
      // Second prompt: color.
      await adapter.executeTool("type", { text: "red\n" }, logger);
      await new Promise((r) => setTimeout(r, 200));
      // Read what came back.
      const out = await adapter.executeTool("read_output", {}, logger);
      expect(out.text).toContain("got: fred / red");
    } finally {
      await adapter.close();
    }
  });
});
```

- [ ] **Step 2: Run tests**

Run: `bun test test/adapters/cli-adapter.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add test/adapters/cli-adapter.test.ts
git commit -m "adapters/cli: end-to-end prompt-response compatibility test (PRI-1608)"
```

---

## Task 6: Full project test pass + typecheck

- [ ] **Step 1: Run the full suite**

Run: `bun run check`
Expected: PASS — typecheck, UI typecheck, UI build, tests.

The full suite likely picks up the pre-existing 13 typecheck errors in `src/agent/prompts/loader.ts` and `src/cli/batch.ts` that have been there from the beginning of this session. If those still error, they're not your problem — confirm by `git diff main` shows nothing in those files.

If a real new typecheck error appears, fix it. The most likely cause is a stale `credentialResolver` reference if you decided to drop the option from `CLIAdapterOptions` in Task 2 — search the codebase: `grep -rn 'credentialResolver.*CLI'` or similar.

- [ ] **Step 2: If anything broke, fix it and re-run.** No commit unless something needed adjusting.

---

## Task 7: Docs — rewrite the chained-shell tutorial examples

**Files:**
- Modify: `docs/tutorial.md`
- Modify: `examples/tutorial/README.md`

- [ ] **Step 1: Find the existing examples**

Run:

```bash
grep -n "scratch-npm\|scratch-bun" docs/tutorial.md examples/tutorial/README.md
```

You'll get hits in both files. The pattern is `--target "mkdir -p scratch-X && cd scratch-X && <command>"` plus a surrounding paragraph that explains why the scratch dir matters.

- [ ] **Step 2: Update `docs/tutorial.md`**

For each chained-shell example, replace:

```
gauntlet run .gauntlet/stories/01-npm-init.md \
  --adapter cli \
  --target "mkdir -p scratch-npm && cd scratch-npm && npm init" \
  --max-time 3m
```

with:

```
gauntlet run .gauntlet/stories/01-npm-init.md \
  --adapter cli \
  --target "npm init" \
  --max-time 3m
```

And the surrounding paragraph that explains the scratch dir (around lines 115–120 in `docs/tutorial.md`) needs to be rewritten. The old paragraph said:

> The scratch dir matters: `npm init` writes `package.json` into the current directory, and we don't want it landing on top of the tutorial fixtures. Each setup-creating story uses its own `scratch-<tool>/` subdirectory (gitignored). Delete those dirs to reset.

Replace with:

> The CLI adapter creates a per-run scratch directory under `.gauntlet/results/<runId>/scratch/` and uses it as the shell's working directory. Anything the agent writes (e.g. `package.json` from `npm init`) lands there and is cleaned up with the rest of the run's evidence. You no longer need to wrap the target in `mkdir`/`cd` — just give it the command you want the agent to exercise.

Apply the same target-string change to the `02-bun-init` example.

- [ ] **Step 3: Update `examples/tutorial/README.md`**

Same pattern: replace the chained-shell example invocation with `--target "npm init"` and rewrite any accompanying paragraph about scratch dirs to point at the per-run scratch model.

- [ ] **Step 4: Commit**

```bash
git add docs/tutorial.md examples/tutorial/README.md
git commit -m "docs: update CLI examples for shell-as-session adapter (PRI-1608)"
```

---

## Task 8: Move PRI-1608 to In Review with a reflective comment

- [ ] **Step 1: Final check — full test suite green**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 2: Transition the Linear ticket**

Per the `linear-ticket-lifecycle` skill: move PRI-1608 to **In Review** and post a reflective comment via `mcp__plugin_linear_linear__save_comment`. Cover what went smoothly, what was tricky, how you felt, any risk flags. Don't make it a status report — make it field notes for the next person.

---

## Self-review checklist

- **Spec coverage:**
  - "Adapter spawns bash + setsid + scratch cwd" → T2.
  - "Tools unchanged" → T2 (tool definitions verbatim from current adapter).
  - "describeTarget rewrite" → T2.
  - "Spawn primitive: cwd/detached/pid/exited" → T1.
  - "Process-group cleanup escalation" → T2 (close logic), T3 (graceful + orphan tests), T4 (SIGHUP + SIGKILL tests).
  - "cli_shell_force_killed event" → T2 (logForceKilled) + T4 (asserted in tests).
  - "Interactive bash over pipes" → T2 (default shell args + comment).
  - "Compatibility: npm-init keeps working" → T5.
  - "Doc surface (tutorial.md + examples/tutorial/README.md)" → T7.
- **Placeholder scan:** no TBDs, no "implement later", no "similar to Task N." Each step contains the actual code or actual commands.
- **Type consistency:** `CLIAdapter` constructor option name `runDir` used in T2 (definition) and T3/T4/T5 (tests construct adapter with same field name). `escalationStep` literal values `"sighup"` / `"sigkill"` consistent across T2 implementation and T4 test assertions. `cli_shell_force_killed` event name consistent across T2 and T4.
- **Frequent commits:** every task except T6 (verification-only) ends in a commit.
