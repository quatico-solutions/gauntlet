import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { PrettyRenderer } from "../../../src/cli/stream/pretty";
import type { StreamEvent } from "../../../src/cli/stream/renderer";

function loadFixture(name: string): { events: StreamEvent[]; expected: string } {
  const jsonl = readFileSync(join(import.meta.dir, `fixtures/${name}.jsonl`), "utf8");
  const expected = readFileSync(join(import.meta.dir, `fixtures/${name}.pretty.txt`), "utf8");
  const events = jsonl.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { events, expected };
}

function collect(): { out: string; write: (s: string) => void } {
  const obj = { out: "", write(s: string) { obj.out += s; } };
  return obj;
}

describe("PrettyRenderer", () => {
  test("renders full happy fixture", () => {
    const { events, expected } = loadFixture("happy");
    const sink = collect();
    const r = new PrettyRenderer(sink, { color: false, columns: 100 });
    for (const e of events) r.handle(e);
    r.close();
    expect(sink.out).toBe(expected);
  });

  test("renders failing tool call with error + hint lines", () => {
    const { events, expected } = loadFixture("failing-tool");
    const sink = collect();
    const r = new PrettyRenderer(sink, { color: false, columns: 100 });
    for (const e of events) r.handle(e);
    r.close();
    expect(sink.out).toBe(expected);
  });

  test("renders event (meta) line and run_error fatal panel", () => {
    const { events, expected } = loadFixture("fatal");
    const sink = collect();
    const r = new PrettyRenderer(sink, { color: false, columns: 100 });
    for (const e of events) r.handle(e);
    r.close();
    expect(sink.out).toBe(expected);
  });

  test("inline-rewrite mode emits a pending call line, then CR+erase + final line (TTY/color on)", () => {
    const events = [
      { eventId: 1, parentEventId: 0, ts: "t", type: "tool_call", turn: 1, toolUseId: "t1", name: "click", arguments: { selector: ".x" } },
      { eventId: 2, parentEventId: 1, ts: "t", type: "tool_result", turn: 1, toolUseId: "t1", name: "click", durationMs: 420, text: "", error: false },
    ];
    const sink = collect();
    const r = new PrettyRenderer(sink, { color: true, columns: 100 });
    for (const e of events) r.handle(e as any);
    r.close();
    // Expect a pending ellipsis, then the ANSI cursor-up + erase sequence, then the final line
    expect(sink.out).toContain("⋯");
    expect(sink.out).toContain("\x1b[1A\x1b[2K");
    expect(sink.out).toContain("✓");
    expect(sink.out).toContain("420ms");
  });
});
