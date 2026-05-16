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
});
