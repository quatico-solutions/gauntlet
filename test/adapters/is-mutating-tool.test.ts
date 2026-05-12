import { describe, test, expect } from "bun:test";
import { WebAdapter } from "../../src/adapters/web/adapter";
import { TUIAdapter } from "../../src/adapters/tui/adapter";
import { CLIAdapter } from "../../src/adapters/cli/adapter";

// We don't start() any adapter — isMutatingTool is a pure classification
// over tool names and must work without a live target.

describe("WebAdapter.isMutatingTool", () => {
  const web = new WebAdapter({ viewport: { width: 1024, height: 768 } });

  const mutating = [
    "click", "type", "press", "hover", "double_click", "right_click",
    "drag", "mouse_move", "scroll", "file_upload", "navigate", "eval",
    "new_tab", "close_tab",
  ];
  const informational = ["screenshot", "extract", "wait_for"];

  for (const name of mutating) {
    test(`${name} is mutating`, () => {
      expect(web.isMutatingTool(name)).toBe(true);
    });
  }
  for (const name of informational) {
    test(`${name} is informational`, () => {
      expect(web.isMutatingTool(name)).toBe(false);
    });
  }

  test("unknown tool defaults to false (informational)", () => {
    // Conservative default: if we don't recognize it, treat it as a
    // read-only tool so the trace stays focused on known mutations.
    expect(web.isMutatingTool("totally_made_up_tool")).toBe(false);
  });
});

describe("TUIAdapter.isMutatingTool", () => {
  const tui = new TUIAdapter();

  test("type is mutating", () => {
    expect(tui.isMutatingTool("type")).toBe(true);
  });
  test("press is mutating", () => {
    expect(tui.isMutatingTool("press")).toBe(true);
  });
  test("read_screen is informational", () => {
    expect(tui.isMutatingTool("read_screen")).toBe(false);
  });
});

describe("CLIAdapter.isMutatingTool", () => {
  const cli = new CLIAdapter();

  test("type is mutating", () => {
    expect(cli.isMutatingTool("type")).toBe(true);
  });
  test("press is mutating", () => {
    expect(cli.isMutatingTool("press")).toBe(true);
  });
  test("read_output is informational", () => {
    expect(cli.isMutatingTool("read_output")).toBe(false);
  });
});
