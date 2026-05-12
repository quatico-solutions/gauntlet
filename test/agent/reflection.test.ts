import { describe, test, expect } from "bun:test";
import {
  formatToolCall,
  renderTrace,
  buildReflectionReminder,
  MAX_TRACE_ENTRIES,
  MAX_ARG_VALUE_LEN,
} from "../../src/agent/reflection";

describe("formatToolCall", () => {
  test("renders name with key=value args", () => {
    expect(formatToolCall({ name: "click", arguments: { selector: "#login" } })).toBe(
      'click(selector="#login")',
    );
  });

  test("renders multiple args in input order", () => {
    expect(
      formatToolCall({
        name: "type",
        arguments: { selector: "input[name=username]", text: "deborah" },
      }),
    ).toBe('type(selector="input[name=username]", text="deborah")');
  });

  test("renders a name-only call as bare name with empty parens", () => {
    expect(formatToolCall({ name: "screenshot", arguments: {} })).toBe("screenshot()");
  });

  test("renders non-string args without quotes", () => {
    expect(
      formatToolCall({
        name: "scroll",
        arguments: { direction: "down", amount: 300, return_screenshot: true },
      }),
    ).toBe('scroll(direction="down", amount=300, return_screenshot=true)');
  });

  test("truncates long string values with ellipsis", () => {
    const long = "x".repeat(MAX_ARG_VALUE_LEN + 50);
    const out = formatToolCall({ name: "eval", arguments: { expression: long } });
    // Should not contain the full string
    expect(out.length).toBeLessThan(long.length);
    expect(out).toContain("…");
    expect(out.startsWith('eval(expression="')).toBe(true);
  });

  test("renders array values inline", () => {
    expect(
      formatToolCall({
        name: "file_upload",
        arguments: { selector: "#f", file_paths: ["/a", "/b"] },
      }),
    ).toBe('file_upload(selector="#f", file_paths=["/a","/b"])');
  });
});

describe("renderTrace", () => {
  test("renders calls as a numbered list", () => {
    const text = renderTrace([
      { name: "click", arguments: { selector: "#a" } },
      { name: "type", arguments: { selector: "input", text: "hi" } },
    ]);
    expect(text).toBe(
      '  1. click(selector="#a")\n' +
      '  2. type(selector="input", text="hi")',
    );
  });

  test("returns explicit empty-list marker when no calls", () => {
    expect(renderTrace([])).toBe("  (no state-changing actions taken yet)");
  });

  test("only renders the last MAX_TRACE_ENTRIES calls", () => {
    const calls = Array.from({ length: MAX_TRACE_ENTRIES + 4 }, (_, i) => ({
      name: "click",
      arguments: { selector: `#a${i}` },
    }));
    const text = renderTrace(calls);
    const lines = text.split("\n");
    expect(lines).toHaveLength(MAX_TRACE_ENTRIES);
    // First rendered line should be the (entries+4 - MAX_TRACE_ENTRIES)th call.
    expect(lines[0]).toContain(`#a${calls.length - MAX_TRACE_ENTRIES}`);
    // Last rendered line is the most recent call.
    expect(lines[MAX_TRACE_ENTRIES - 1]).toContain(`#a${calls.length - 1}`);
    // Numbering restarts at 1 within the rendered window.
    expect(lines[0]).toMatch(/^ {2}1\./);
  });
});

describe("buildReflectionReminder", () => {
  test("wraps the trace in a <SYSTEM-REMINDER> block with the give-up framing", () => {
    const out = buildReflectionReminder("  1. click(selector=\"#login\")");
    expect(out).toContain("<SYSTEM-REMINDER>");
    expect(out).toContain("</SYSTEM-REMINDER>");
    expect(out).toContain("Reflection checkpoint");
    expect(out).toContain("Stories can be wrong");
    expect(out).toContain("Fixtures can be wrong");
    expect(out).toContain("Systems can be wrong");
    expect(out).toContain("report_result");
    expect(out).toContain('  1. click(selector="#login")');
  });

  test("reminder text is identical across firings (trace is the only variable)", () => {
    const a = buildReflectionReminder("  1. click(selector=\"#a\")");
    const b = buildReflectionReminder("  1. click(selector=\"#b\")");
    // Strip the trace and verify the rest is byte-equal.
    const stripA = a.replace('  1. click(selector="#a")', "<TRACE>");
    const stripB = b.replace('  1. click(selector="#b")', "<TRACE>");
    expect(stripA).toBe(stripB);
  });
});
