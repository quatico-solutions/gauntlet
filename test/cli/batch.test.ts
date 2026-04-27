import { describe, test, expect } from "bun:test";
import type { EvidenceLogger, EventObserver } from "../../src/evidence/logger";
import { runBatch } from "../../src/cli/batch";
import type { AppConfig } from "../../src/config";

function makeConfig(): AppConfig {
  return {
    projectRoot: "/tmp/x",
    port: 4400,
    defaultChrome: { host: "127.0.0.1", port: 9222 },
    defaultTurns: 5,
    defaultViewport: { width: 1440, height: 900 },
    saveScreencast: false,
    models: { agent: "claude-sonnet-4-6", fanout: undefined },
    sources: { defaultChrome: "default" },
  } as any;
}

function collectSink() {
  const obj = { out: "", write(s: string) { obj.out += s; } };
  return obj;
}

describe("runBatch", () => {
  test("serial loop calls runOne for each card and produces a final summary", async () => {
    const sink = collectSink();
    const calls: string[] = [];

    const stubRunOne = async (opts: { scenarioPath: string; onLogger?: any }) => {
      calls.push(opts.scenarioPath);
      // Drive the observer with a minimal happy-path event sequence.
      let observer: EventObserver | null = null;
      const fakeLog: any = {
        addEventObserver(fn: EventObserver) { observer = fn; return () => {}; },
        logEvent: () => {},
      };
      const detach = opts.onLogger?.(fakeLog) ?? (() => {});
      observer?.({ type: "run_start", runId: `run-${opts.scenarioPath}`, cardId: opts.scenarioPath, maxTurns: 20 } as any);
      observer?.({ type: "llm_response", turn: 3, stopReason: "end_turn" } as any);
      observer?.({ type: "run_end", status: "pass", durationMs: 1000, usage: { turns: 4 } } as any);
      detach();
      return {
        runId: `run-${opts.scenarioPath}`,
        outDir: `/tmp/${opts.scenarioPath}`,
        result: { status: "pass" } as any,
      };
    };

    const exitCode = await runBatch(
      {
        scenarioPaths: ["a.md", "b.md"],
        target: "http://localhost",
        adapterType: "cli",
        config: makeConfig(),
        silent: false,
        format: undefined,
        noColor: true,
        sink,
        isTTY: false,
      },
      stubRunOne as any,
    );

    expect(calls).toEqual(["a.md", "b.md"]);
    expect(exitCode).toBe(0);
    // Table key is basename(path, extname(path)) = "a", "b" — not "a.md" / "b.md".
    expect(sink.out).toContain("a: queued");
    expect(sink.out).toContain("b: queued");
    expect(sink.out).toContain("a: done (pass)");
    expect(sink.out).toContain("b: done (pass)");
    expect(sink.out).toContain("batch: 2 pass · 0 fail · 0 investigate · 0 errored");
  });
});
