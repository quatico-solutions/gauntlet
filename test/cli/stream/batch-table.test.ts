import { describe, test, expect } from "bun:test";
import { BatchTableRenderer } from "../../../src/cli/stream/batch-table";

function collect(): { out: string; write: (s: string) => void } {
  const obj = { out: "", write(s: string) { obj.out += s; } };
  return obj;
}

const NON_TTY = {
  isTTY: false,
  color: false,
  columns: 100,
  target: "",
  resultsRoot: "/tmp/.gauntlet/results",
};

const TTY = {
  isTTY: true,
  color: false,
  columns: 100,
  target: "https://app.local",
  resultsRoot: "/tmp/.gauntlet/results",
};

describe("BatchTableRenderer (append mode)", () => {
  test("emits one append line per state change", () => {
    const sink = collect();
    const r = new BatchTableRenderer(sink, NON_TTY);
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
    const r = new BatchTableRenderer(sink, NON_TTY);
    r.setQueued("story-x");
    r.setErrored("story-x", null, "card path missing");
    r.finalize();
    expect(sink.out).toContain("story-x: errored before start");
  });

  test("finalize emits a results line pointing to resultsRoot", () => {
    const sink = collect();
    const r = new BatchTableRenderer(sink, { ...NON_TTY, resultsRoot: "/some/proj/.gauntlet/results" });
    r.setQueued("story-a");
    r.setDone("story-a", "pass", 3);
    r.finalize();
    expect(sink.out).toContain("results: /some/proj/.gauntlet/results");
  });
});

describe("BatchTableRenderer (attemptNumber)", () => {
  test("attemptNumber defaults to 1, behavior unchanged", () => {
    const sink = collect();
    const r = new BatchTableRenderer(sink, NON_TTY);
    r.setQueued("story-a");
    r.setRunning("story-a", "story-a_t1_x", 50);
    r.onTurn("story-a", 1);
    r.setDone("story-a", "pass", 5);
    r.finalize();
    expect(sink.out).toContain("story-a");
    expect(sink.out).toContain("pass");
  });

  test("two attempts of same card render distinct rows", () => {
    const sink = collect();
    const r = new BatchTableRenderer(sink, NON_TTY);
    r.setQueued("story-a", 1);
    r.setQueued("story-a", 2);
    r.setRunning("story-a", "story-a_t1_x", 50, 1);
    r.setDone("story-a", "pass", 5, 1);
    r.setRunning("story-a", "story-a_t2_y", 50, 2);
    r.setDone("story-a", "fail", 7, 2);
    r.finalize();
    // Both attempts represented in non-TTY append output:
    expect(sink.out.match(/story-a.*pass/)).toBeTruthy();
    expect(sink.out.match(/story-a.*fail/)).toBeTruthy();
  });
});

describe("BatchTableRenderer (TTY mode — Mock B ticker)", () => {
  test("setQueued does not emit anything (queued cards are tracked silently)", () => {
    const sink = collect();
    const r = new BatchTableRenderer(sink, TTY);
    r.setQueued("a");
    r.setQueued("b");
    expect(sink.out).toBe("");
    r.finalize();
  });

  test("first setRunning writes the header and a single-line spinner", () => {
    const sink = collect();
    const r = new BatchTableRenderer(sink, TTY);
    r.setQueued("a");
    r.setQueued("b");
    r.setRunning("a", "run-a-1", 10);
    expect(sink.out).toContain("Gauntlet");
    expect(sink.out).toContain("2 cards");
    expect(sink.out).toContain("https://app.local");
    expect(sink.out).toContain("[1/2]");
    expect(sink.out).toContain("a");
    // Spinner uses single-line redraw — no full-screen cursor walk.
    expect(sink.out).toMatch(/\r\x1b\[2K/);
    expect(sink.out).not.toMatch(/\x1b\[\d+A\x1b\[0J/);
    r.finalize();
  });

  test("setDone commits a result line with the VetStatus and the result-dir path", () => {
    const sink = collect();
    const r = new BatchTableRenderer(sink, TTY);
    r.setQueued("a");
    r.setRunning("a", "run-a-1", 10);
    r.onTurn("a", 5);
    r.setDone("a", "investigate", 7);
    r.finalize();
    expect(sink.out).toContain("!"); // investigate glyph
    expect(sink.out).toContain("investigate");
    expect(sink.out).toContain("7 turns");
    expect(sink.out).toContain("/tmp/.gauntlet/results/run-a-1/");
  });

  test("setErrored before start commits a flush result line under the header", () => {
    const sink = collect();
    const r = new BatchTableRenderer(sink, TTY);
    r.setQueued("a");
    r.setErrored("a", null, "card path missing");
    r.finalize();
    expect(sink.out).toContain("Gauntlet");
    expect(sink.out).toContain("✗");
    expect(sink.out).toContain("error");
    expect(sink.out).toContain("before start");
    expect(sink.out).toContain("card path missing");
  });

  test("two cards: pass + errored, final summary correct", () => {
    const sink = collect();
    const r = new BatchTableRenderer(sink, TTY);
    r.setQueued("a");
    r.setQueued("b");
    r.setRunning("a", "run-a-1", 10);
    r.setDone("a", "pass", 3);
    r.setRunning("b", "run-b-1", 10);
    r.setErrored("b", 2, "timeout");
    r.finalize();

    expect(sink.out).toContain("✓");
    expect(sink.out).toContain("✗");
    expect(sink.out).toContain("pass");
    expect(sink.out).toContain("timeout");
    expect(sink.out).toContain("batch: 1 pass · 0 fail · 0 investigate · 1 errored");
    expect(sink.out).toContain("results: /tmp/.gauntlet/results");
  });
});
