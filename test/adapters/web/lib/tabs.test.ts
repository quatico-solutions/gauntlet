import { describe, test, expect, beforeAll, afterAll } from "bun:test";

const { createSession } = require("../../../../src/adapters/web/lib/chrome-ws-lib");

describe("tabs.js page-session integration", () => {
  let session: any;

  beforeAll(async () => {
    session = createSession();
    await session.startChrome(true, "tabs-pagesess-test");
  });

  afterAll(async () => {
    if (session) await session.killChrome();
  });

  test("getTabs returns tabs with a getPageSession() thunk", async () => {
    const tabs = await session.getTabs();
    expect(tabs.length).toBeGreaterThan(0);
    expect(typeof tabs[0].getPageSession).toBe("function");

    const ps = await tabs[0].getPageSession();
    expect(ps.sessionId).toBeDefined();
    expect(ps.targetId).toBe(tabs[0].id);

    // Memoization: a second call returns the same session.
    const ps2 = await tabs[0].getPageSession();
    expect(ps2.sessionId).toBe(ps.sessionId);

    await ps.detach();
  });

  test("newTab returns a tab handle with a getPageSession() thunk", async () => {
    const tab = await session.newTab("about:blank");
    expect(typeof tab.getPageSession).toBe("function");

    const ps = await tab.getPageSession();
    expect(ps.sessionId).toBeDefined();
    expect(ps.targetId).toBe(tab.id);

    await ps.detach();
    await session.closeTab(tab.webSocketDebuggerUrl);
  });
});
