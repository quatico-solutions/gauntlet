import { describe, test, expect } from "bun:test";
import { WatchManager } from "../../src/agent/watch-manager";
import { buildWatchLogsTool } from "../../src/agent/watch-logs-tool";
import type { EvidenceLogger } from "../../src/evidence/logger";

function noopLogger(): EvidenceLogger {
  return { logEvent: () => {} } as unknown as EvidenceLogger;
}

describe("watch_logs tool", () => {
  test("definition declares name and required glob param", () => {
    const m = new WatchManager();
    const tool = buildWatchLogsTool({ manager: m });
    expect(tool.definition.name).toBe("watch_logs");
    const params = tool.definition.parameters as Record<string, unknown>;
    expect((params.properties as Record<string, unknown>).glob).toBeDefined();
    expect((params.required as string[])).toContain("glob");
  });

  test("registers a glob and returns watching list", async () => {
    const m = new WatchManager();
    const tool = buildWatchLogsTool({ manager: m });
    const result = await tool.execute({ glob: "/tmp/foo/*.log" }, noopLogger());
    const payload = JSON.parse(result.text);
    expect(payload.watching).toEqual(["/tmp/foo/*.log"]);
  });

  test("repeat call accumulates and is idempotent", async () => {
    const m = new WatchManager();
    const tool = buildWatchLogsTool({ manager: m });
    await tool.execute({ glob: "/tmp/a/*.log" }, noopLogger());
    await tool.execute({ glob: "/tmp/b/*.log" }, noopLogger());
    await tool.execute({ glob: "/tmp/a/*.log" }, noopLogger());
    const result = await tool.execute({ glob: "/tmp/b/*.log" }, noopLogger());
    const payload = JSON.parse(result.text);
    expect(payload.watching).toEqual(["/tmp/a/*.log", "/tmp/b/*.log"]);
  });

  test("missing glob returns error", async () => {
    const m = new WatchManager();
    const tool = buildWatchLogsTool({ manager: m });
    const result = await tool.execute({}, noopLogger());
    const payload = JSON.parse(result.text);
    expect(payload.error).toBeDefined();
  });
});
