import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render } from "../../src/cli/render";
import type { AppConfig } from "../../src/config";

function makeRun(): { projectRoot: string; runId: string } {
  const projectRoot = mkdtempSync(join(tmpdir(), "gauntlet-render-cmd-"));
  const stateDir = join(projectRoot, ".gauntlet");
  const runId = "card_2026T000000Z_zzzz";
  const runDir = join(stateDir, "results", runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "result.json"), JSON.stringify({
    schemaVersion: 5, runId, scenario: "card", status: "pass",
    summary: "ok", reasoning: "r", observations: [],
    evidence: { screenshots: [], log: "run.jsonl" }, duration_ms: 1,
  }));
  writeFileSync(join(runDir, "run.jsonl"),
    JSON.stringify({ eventId: "e1", type: "run_start" }) + "\n");
  return { projectRoot, runId };
}

describe("render command", () => {
  test("resolves run-id under state-dir and emits index.html", async () => {
    const { projectRoot, runId } = makeRun();
    const config = { projectRoot, stateDirName: ".gauntlet" } as AppConfig;
    const logs: string[] = [];
    await render({ command: "render", runIdOrPath: runId, cli: {} as any }, config, { log: (m) => logs.push(m) });
    expect(logs.length).toBe(1);
    expect(logs[0]).toMatch(/index\.html$/);
  });

  test("accepts an absolute path to a run-dir directly", async () => {
    const { projectRoot, runId } = makeRun();
    const runDir = join(projectRoot, ".gauntlet", "results", runId);
    const config = { projectRoot, stateDirName: ".gauntlet" } as AppConfig;
    const logs: string[] = [];
    await render({ command: "render", runIdOrPath: runDir, cli: {} as any }, config, { log: (m) => logs.push(m) });
    expect(logs[0]).toBe(runDir + "/index.html");
  });

  test("throws when the run-id can't be resolved", async () => {
    const { projectRoot } = makeRun();
    const config = { projectRoot, stateDirName: ".gauntlet" } as AppConfig;
    await expect(
      render({ command: "render", runIdOrPath: "nonexistent-run", cli: {} as any }, config)
    ).rejects.toThrow(/Run dir not found/);
  });
});
