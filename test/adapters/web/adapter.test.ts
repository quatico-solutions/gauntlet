import { describe, test, expect } from "bun:test";
import { WebAdapter } from "../../../src/adapters/web/adapter";

describe("WebAdapter", () => {
  test("exposes tool definitions for the agent", () => {
    const adapter = new WebAdapter();
    const tools = adapter.toolDefinitions();
    const names = tools.map((t) => t.name);
    expect(names).toContain("screenshot");
    expect(names).toContain("click");
    expect(names).toContain("type");
    expect(names).toContain("press");
    expect(names).toContain("navigate");
    expect(names).toContain("extract");
    expect(names).toContain("wait_for");
  });

  test("has correct parameter schemas", () => {
    const adapter = new WebAdapter();
    const tools = adapter.toolDefinitions();
    const clickTool = tools.find((t) => t.name === "click");
    expect(clickTool).toBeDefined();
    expect(clickTool!.parameters).toHaveProperty("properties");
  });

  test("action tools have return_screenshot parameter", () => {
    const adapter = new WebAdapter();
    const tools = adapter.toolDefinitions();
    const toolsWithReturnScreenshot = ["click", "type", "press", "navigate", "eval", "wait_for"];
    for (const name of toolsWithReturnScreenshot) {
      const tool = tools.find((t) => t.name === name);
      expect(tool).toBeDefined();
      const props = (tool!.parameters as any).properties;
      expect(props.return_screenshot).toBeDefined();
      expect(props.return_screenshot.type).toBe("boolean");
    }
  });

  test("screenshot tool does not have return_screenshot parameter", () => {
    const adapter = new WebAdapter();
    const tools = adapter.toolDefinitions();
    const screenshotTool = tools.find((t) => t.name === "screenshot");
    const props = (screenshotTool!.parameters as any).properties;
    expect(props.return_screenshot).toBeUndefined();
  });
});
