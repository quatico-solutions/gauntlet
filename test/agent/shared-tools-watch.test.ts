import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildSharedTools } from "../../src/agent/shared-tools";
import type { EvidenceLogger } from "../../src/evidence/logger";

function noopLogger(): EvidenceLogger {
  return { logEvent: () => {} } as unknown as EvidenceLogger;
}

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "gauntlet-shared-watch-"));
}

describe("buildSharedTools exposes watch_logs + wake_on_idle_log", () => {
  test("definitions include watch_logs and wake_on_idle_log", () => {
    const shared = buildSharedTools({ cwd: freshDir() });
    const names = shared.definitions().map((d) => d.name);
    expect(names).toContain("watch_logs");
    expect(names).toContain("wake_on_idle_log");
  });

  test("canExecute returns true for both", () => {
    const shared = buildSharedTools({ cwd: freshDir() });
    expect(shared.canExecute("watch_logs")).toBe(true);
    expect(shared.canExecute("wake_on_idle_log")).toBe(true);
  });

  test("execute routes watch_logs and wake_on_idle_log end-to-end", async () => {
    const dir = freshDir();
    const shared = buildSharedTools({ cwd: dir });
    const wlog = await shared.execute(
      "watch_logs",
      { glob: join(dir, "*.log") },
      noopLogger(),
    );
    expect(JSON.parse(wlog.text).watching).toEqual([join(dir, "*.log")]);

    setTimeout(() => writeFileSync(join(dir, "x.log"), "y\n"), 50);
    const wake = await shared.execute(
      "wake_on_idle_log",
      { idle_ms: 60_000, timeout_ms: 2_000, poll_interval_ms: 25 },
      noopLogger(),
    );
    expect(JSON.parse(wake.text).reason).toBe("new_file");
  });

  test("watch_logs registration is visible to wake_on_idle_log", async () => {
    const shared = buildSharedTools({ cwd: freshDir() });
    await shared.execute("watch_logs", { glob: "/tmp/shared-state-test/*.log" }, noopLogger());
    const wake = await shared.execute(
      "wake_on_idle_log",
      { idle_ms: 1_000_000, timeout_ms: 100, poll_interval_ms: 25 },
      noopLogger(),
    );
    expect(JSON.parse(wake.text).watching).toEqual(["/tmp/shared-state-test/*.log"]);
  });
});
