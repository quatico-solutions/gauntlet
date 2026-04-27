import { describe, test, expect } from "bun:test";
import { BatchTableRenderer } from "../../../src/cli/stream/batch-table";

function collect(): { out: string; write: (s: string) => void } {
  const obj = { out: "", write(s: string) { obj.out += s; } };
  return obj;
}

describe("BatchTableRenderer (append mode)", () => {
  test("emits one append line per state change", () => {
    const sink = collect();
    const r = new BatchTableRenderer(sink, { isTTY: false, color: false, columns: 100 });
    r.setQueued("story-a");
    r.setQueued("story-b");
    r.setRunning("story-a", "run-a-1", 20);
    r.onTurn("story-a", 7);
    r.setDone("story-a", "investigate", 8);
    r.setRunning("story-b", "run-b-1", 20);
    r.setErrored("story-b", 3, "boom");
    r.finalize();

    const lines = sink.out.split("\n").filter(Boolean);
    expect(lines).toContain("story-a: queued");
    expect(lines).toContain("story-b: queued");
    expect(lines).toContain("story-a: running turn 0 / 20");
    expect(lines).toContain("story-a: running turn 7 / 20");
    expect(lines).toContain("story-a: done (investigate) on turn 8");
    expect(lines).toContain("story-b: errored on turn 3");
    expect(sink.out).toContain("batch: 0 pass · 0 fail · 1 investigate · 1 errored");
  });

  test("setErrored before start renders without a turn number", () => {
    const sink = collect();
    const r = new BatchTableRenderer(sink, { isTTY: false, color: false, columns: 100 });
    r.setQueued("story-x");
    r.setErrored("story-x", null, "card path missing");
    r.finalize();
    expect(sink.out).toContain("story-x: errored before start");
  });
});
