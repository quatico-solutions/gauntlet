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

interface CapturedEvent { name: string; payload: Record<string, unknown> }
function recordingLogger(events: CapturedEvent[]): EvidenceLogger {
  return {
    logEvent: (name: string, payload: Record<string, unknown>) => {
      events.push({ name, payload });
    },
  } as unknown as EvidenceLogger;
}

describe("buildBashTool", () => {
  test("runs a simple command and captures stdout", async () => {
    const tool = buildBashTool({ cwd: freshCwd() });
    const result = await tool.execute({ command: "echo hello" }, noopLogger());
    expect(result.text).toContain("hello");
  });

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
});
