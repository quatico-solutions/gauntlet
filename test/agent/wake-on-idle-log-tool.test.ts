import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  WatchManager,
  WAKE_IDLE_MS_MIN,
  WAKE_TIMEOUT_MS_MAX,
} from "../../src/agent/watch-manager";
import { buildWakeOnIdleLogTool } from "../../src/agent/wake-on-idle-log-tool";
import type { EvidenceLogger } from "../../src/evidence/logger";

function noopLogger(): EvidenceLogger {
  return { logEvent: () => {} } as unknown as EvidenceLogger;
}

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "gauntlet-wake-test-"));
}

describe("wake_on_idle_log tool", () => {
  test("returns timeout reason when nothing happens", async () => {
    const m = new WatchManager();
    const tool = buildWakeOnIdleLogTool({ manager: m });
    const result = await tool.execute(
      { idle_ms: 1_000_000, timeout_ms: 200, poll_interval_ms: 25 },
      noopLogger(),
    );
    const payload = JSON.parse(result.text);
    expect(payload.reason).toBe("timeout");
  });

  test("clamps timeout_ms above ceiling, surfaces applied value", async () => {
    const dir = freshDir();
    const m = new WatchManager();
    m.addGlob(join(dir, "*.log"));
    const tool = buildWakeOnIdleLogTool({ manager: m });
    // Trigger an early new_file so we don't wait the (clamped) 240s.
    setTimeout(() => writeFileSync(join(dir, "x.log"), "y\n"), 50);

    const result = await tool.execute(
      { idle_ms: 60_000, timeout_ms: 999_999, poll_interval_ms: 25 },
      noopLogger(),
    );
    const payload = JSON.parse(result.text);
    expect(payload.applied_timeout_ms).toBe(WAKE_TIMEOUT_MS_MAX);
    expect(payload.applied_idle_ms).toBe(60_000);
  });

  test("clamps idle_ms below floor, surfaces applied value", async () => {
    const m = new WatchManager();
    const tool = buildWakeOnIdleLogTool({ manager: m });
    // With idle_ms clamped to WAKE_IDLE_MS_MIN (5s) and timeout_ms 200ms,
    // timeout will win — but applied_idle_ms still reports the clamp.
    const result = await tool.execute(
      { idle_ms: 1, timeout_ms: 200, poll_interval_ms: 25 },
      noopLogger(),
    );
    const payload = JSON.parse(result.text);
    expect(payload.applied_idle_ms).toBe(WAKE_IDLE_MS_MIN);
    expect(payload.applied_timeout_ms).toBe(200);
  });

  test("rejects negative timeout_ms", async () => {
    const m = new WatchManager();
    const tool = buildWakeOnIdleLogTool({ manager: m });
    const result = await tool.execute(
      { idle_ms: 60_000, timeout_ms: -1 },
      noopLogger(),
    );
    const payload = JSON.parse(result.text);
    expect(payload.error).toBeDefined();
  });

  test("rejects non-number idle_ms", async () => {
    const m = new WatchManager();
    const tool = buildWakeOnIdleLogTool({ manager: m });
    const result = await tool.execute(
      { idle_ms: "fast", timeout_ms: 5_000 },
      noopLogger(),
    );
    const payload = JSON.parse(result.text);
    expect(payload.error).toBeDefined();
  });

  test("returns new_file reason when a matching file appears", async () => {
    const dir = freshDir();
    const m = new WatchManager();
    m.addGlob(join(dir, "*.log"));
    const tool = buildWakeOnIdleLogTool({ manager: m });

    setTimeout(() => writeFileSync(join(dir, "wake.log"), "x\n"), 100);

    const result = await tool.execute(
      { idle_ms: 60_000, timeout_ms: 5_000, poll_interval_ms: 50 },
      noopLogger(),
    );
    const payload = JSON.parse(result.text);
    expect(payload.reason).toBe("new_file");
    expect(payload.path).toEqual(join(dir, "wake.log"));
  });

  test("result includes current watching list", async () => {
    const m = new WatchManager();
    m.addGlob("/tmp/x/*.log");
    const tool = buildWakeOnIdleLogTool({ manager: m });
    const result = await tool.execute(
      { idle_ms: 1_000_000, timeout_ms: 50, poll_interval_ms: 10 },
      noopLogger(),
    );
    const payload = JSON.parse(result.text);
    expect(payload.watching).toEqual(["/tmp/x/*.log"]);
  });

  test("declares maxExecutionMs covering the internal ceiling", () => {
    const m = new WatchManager();
    const tool = buildWakeOnIdleLogTool({ manager: m });
    expect(tool.definition.maxExecutionMs).toBeGreaterThanOrEqual(WAKE_TIMEOUT_MS_MAX);
  });
});
