import { describe, test, expect, beforeAll, afterAll } from "bun:test";

const { createSession } = require("../../../../src/adapters/web/lib/chrome-ws-lib");
const { createBrowserSession } = require("../../../../src/adapters/web/lib/browser-session");
const { attachBrowserBridge } = require("../../../../src/adapters/web/lib/browser-bridge");

function makeChromeHttp(host: string, port: number) {
  return async (path: string) => {
    const res = await fetch(`http://${host}:${port}${path}`);
    if (!res.ok) throw new Error(`chromeHttp ${path} -> ${res.status}`);
    const text = await res.text();
    try { return JSON.parse(text); } catch { return text; }
  };
}

let session: any;
let browser: any;
let port: number;

beforeAll(async () => {
  session = createSession();
  await session.startChrome(true, "targets-test");
  port = session.getActivePort();
  browser = createBrowserSession({
    host: "127.0.0.1",
    port,
    rewriteWsUrl: (u: string) => u,
    chromeHttp: makeChromeHttp("127.0.0.1", port),
  });
});

afterAll(async () => {
  if (browser) await browser.close();
  if (session) await session.killChrome();
});

describe("targets API", () => {
  test("list() returns at least the about:blank page target after attach", async () => {
    const tc = await attachBrowserBridge({
      browser,
      host: "127.0.0.1",
      port,
      rewriteWsUrl: (u: string) => u,
    });
    const targets = tc.targets.list();
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.some((t: any) => t.type === "page")).toBe(true);
  });

  test("onCreated fires for a HTTP-created tab", async () => {
    const tc = await attachBrowserBridge({
      browser,
      host: "127.0.0.1",
      port,
      rewriteWsUrl: (u: string) => u,
    });
    const seen: any[] = [];
    const unsub = tc.targets.onCreated((t: any) => seen.push(t));
    // session.newTab uses /json/new (HTTP), unrelated to the browser-WS,
    // so it's a clean trigger that we'll observe via events.
    const newTabInfo = await session.newTab("about:blank");
    await new Promise((r) => setTimeout(r, 300));
    expect(seen.some((t) => t.type === "page")).toBe(true);
    unsub();
    if (newTabInfo) await session.closeTab(newTabInfo.webSocketDebuggerUrl);
  });

  test("waitForNew resolves for a window.open-spawned page (PRI-1439 capability)", async () => {
    const tc = await attachBrowserBridge({
      browser,
      host: "127.0.0.1",
      port,
      rewriteWsUrl: (u: string) => u,
    });
    // Set up a tab and prime it (Runtime context warm-up).
    const tab = await session.newTab("about:blank");
    await session.evaluate(tab.webSocketDebuggerUrl, "1+1");

    const popupPromise = tc.targets.waitForNew(
      (t: any) => t.openerId === tab.id && t.type === "page",
      { timeoutMs: 5000 }
    );

    // Use a page session over the browser-WS to drive window.open with
    // userGesture. session.evaluate doesn't expose userGesture, so go
    // through ps.send directly.
    const ps = await session.attachPageSession(tab.id);
    await ps.send("Runtime.evaluate", {
      expression: "window.open('about:blank', '_blank')",
      userGesture: true,
    });

    const popup = await popupPromise;
    expect(popup).toBeDefined();
    expect(popup.openerId).toBe(tab.id);

    await ps.detach();
    await session.closeTab(tab.webSocketDebuggerUrl);
  });

  test("waitForNew rejects on timeout when nothing matches", async () => {
    const tc = await attachBrowserBridge({
      browser,
      host: "127.0.0.1",
      port,
      rewriteWsUrl: (u: string) => u,
    });
    await expect(
      tc.targets.waitForNew(() => false, { timeoutMs: 200 })
    ).rejects.toThrow(/timed out/i);
  });
});

describe("BrowserContext", () => {
  test("two contexts isolate cookies", async () => {
    const tc = await attachBrowserBridge({
      browser,
      host: "127.0.0.1",
      port,
      rewriteWsUrl: (u: string) => u,
    });
    const ctxA = await tc.createBrowserContext();
    const ctxB = await tc.createBrowserContext();
    const pageA = await ctxA.createPage("about:blank");
    const pageB = await ctxB.createPage("about:blank");

    // about:blank can't own cookies, so use Network.setCookie via CDP
    // on the context's page through a page session.
    const psA = await session.attachPageSession(pageA.targetId);
    const psB = await session.attachPageSession(pageB.targetId);

    await psA.send("Network.setCookie", {
      url: "https://example.test/",
      name: "ctxA",
      value: "1",
    });

    // Read on B's page session — should NOT see ctxA.
    const bCookies = await psB.send("Network.getCookies", {
      urls: ["https://example.test/"],
    });
    expect((bCookies.cookies || []).find((c: any) => c.name === "ctxA")).toBeUndefined();

    await psA.detach();
    await psB.detach();
    await ctxA.dispose();
    await ctxB.dispose();
  });

  test("dispose() makes subsequent createPage throw", async () => {
    const tc = await attachBrowserBridge({
      browser,
      host: "127.0.0.1",
      port,
      rewriteWsUrl: (u: string) => u,
    });
    const ctx = await tc.createBrowserContext();
    await ctx.dispose();
    await expect(ctx.createPage("about:blank")).rejects.toThrow();
  });
});
