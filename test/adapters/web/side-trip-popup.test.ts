import { describe, test, expect, beforeAll, afterAll } from "bun:test";

const { createSession } = require("../../../src/adapters/web/lib/chrome-ws-lib");

describe("PRI-1439 side-trip popup regression (PRI-1535 capability)", () => {
  let session: any;

  beforeAll(async () => {
    session = createSession();
    await session.startChrome(true, "side-trip-test");
  });

  afterAll(async () => {
    if (session) await session.killChrome();
  });

  test("a page-spawned window.open popup is observable via targets.waitForNew within 1s", async () => {
    const ctx = await session.createBrowserContext();
    const parent = await ctx.createPage("about:blank");

    const start = Date.now();
    const popupP = session.targets.waitForNew(
      (t: any) => t.openerId === parent.targetId && t.type === "page",
      { timeoutMs: 1000 }
    );

    // userGesture: true is required for window.open to actually spawn a tab.
    const ps = await session.attachPageSession(parent.targetId);
    await ps.send("Runtime.evaluate", {
      expression: "window.open('about:blank', '_blank')",
      userGesture: true,
    });

    const popup = await popupP;
    const elapsed = Date.now() - start;
    expect(popup).toBeDefined();
    expect(popup.openerId).toBe(parent.targetId);
    expect(elapsed).toBeLessThan(1000);

    await ps.detach();
    await ctx.dispose();
  });
});
