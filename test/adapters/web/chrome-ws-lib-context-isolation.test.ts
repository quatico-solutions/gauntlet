import { describe, test, expect, beforeEach, afterEach } from "bun:test";

const { createSession } = require("../../../src/adapters/web/lib/chrome-ws-lib");

describe("BrowserContext isolation across parallel adapter sessions (PRI-1535)", () => {
  let sessionA: any;
  let sessionB: any;

  beforeEach(async () => {
    sessionA = createSession();
    sessionB = createSession();
    await sessionA.startChrome(true, "ctx-isolation-A");
    await sessionB.startChrome(true, "ctx-isolation-B");
  });

  afterEach(async () => {
    if (sessionA) await sessionA.killChrome();
    if (sessionB) await sessionB.killChrome();
  });

  test("two sessions running concurrent BrowserContexts don't see each other's cookies", async () => {
    const ctxA = await sessionA.createBrowserContext();
    const ctxB = await sessionB.createBrowserContext();
    const pageA = await ctxA.createPage("about:blank");
    const pageB = await ctxB.createPage("about:blank");

    // Page sessions over the browser-WS, one per BrowserContext, prove
    // cookie isolation across contexts.
    const psA = await sessionA.attachPageSession(pageA.targetId);
    const psB = await sessionB.attachPageSession(pageB.targetId);

    await psA.send("Network.setCookie", {
      url: "https://example.test/",
      name: "across-sessions-A",
      value: "1",
    });

    const bCookies = await psB.send("Network.getCookies", {
      urls: ["https://example.test/"],
    });
    expect((bCookies.cookies || []).find((c: any) => c.name === "across-sessions-A")).toBeUndefined();

    await psA.detach();
    await psB.detach();
    await ctxA.dispose();
    await ctxB.dispose();
  });

  test("dispose-and-recreate within one session does not leak to a parallel session", async () => {
    const ctxA1 = await sessionA.createBrowserContext();
    const pageA1 = await ctxA1.createPage("about:blank");
    const psA1 = await sessionA.attachPageSession(pageA1.targetId);
    await psA1.send("Network.setCookie", {
      url: "https://example.test/",
      name: "before-dispose",
      value: "1",
    });
    await psA1.detach();
    await ctxA1.dispose();

    // Recreate
    const ctxA2 = await sessionA.createBrowserContext();
    const pageA2 = await ctxA2.createPage("about:blank");
    const psA2 = await sessionA.attachPageSession(pageA2.targetId);
    const a2Cookies = await psA2.send("Network.getCookies", {
      urls: ["https://example.test/"],
    });
    // The dispose should have cleared the cookie.
    expect((a2Cookies.cookies || []).find((c: any) => c.name === "before-dispose")).toBeUndefined();

    // And session B (with its own context) sees nothing either.
    const ctxB = await sessionB.createBrowserContext();
    const pageB = await ctxB.createPage("about:blank");
    const psB = await sessionB.attachPageSession(pageB.targetId);
    const bCookies = await psB.send("Network.getCookies", {
      urls: ["https://example.test/"],
    });
    expect((bCookies.cookies || []).find((c: any) => c.name === "before-dispose")).toBeUndefined();

    await psA2.detach();
    await psB.detach();
    await ctxA2.dispose();
    await ctxB.dispose();
  });
});
