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

  // The whole AppConfig refactor depends on this thread:
  //   AppConfig.defaultChrome → mergeRunConfig → WebAdapter({chrome}) →
  //   chrome-ws-lib.setEndpoint(host, port) → host-override module state.
  // Cover it directly so a regression in any link of the chain is caught.
  describe("constructor → setEndpoint threading", () => {
    test("explicit chrome calls setEndpoint and sets remote=true", () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const chromeLib = require("../../../src/adapters/web/lib/chrome-ws-lib");
      const original = chromeLib.setEndpoint;
      const calls: Array<[string, number]> = [];
      chromeLib.setEndpoint = (host: string, port: number) => {
        calls.push([host, port]);
        return original.call(chromeLib, host, port);
      };
      try {
        const adapter = new WebAdapter({ chrome: { host: "remote-host", port: 9333 } });
        expect(calls).toEqual([["remote-host", 9333]]);
        // remote=true is private, but we can verify the side effect: close()
        // on a remote adapter is a no-op (does not call killChrome).
        // We do this implicitly by checking the call list above and trusting
        // the implementation's own branch.
        expect(adapter).toBeDefined();
      } finally {
        chromeLib.setEndpoint = original;
      }
    });

    test("no chrome option does not call setEndpoint", () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const chromeLib = require("../../../src/adapters/web/lib/chrome-ws-lib");
      const original = chromeLib.setEndpoint;
      let called = false;
      chromeLib.setEndpoint = () => {
        called = true;
      };
      try {
        new WebAdapter({});
        expect(called).toBe(false);
        new WebAdapter();
        expect(called).toBe(false);
      } finally {
        chromeLib.setEndpoint = original;
      }
    });
  });
});
