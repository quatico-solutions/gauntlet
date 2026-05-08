import { describe, test, expect, beforeAll, afterAll } from "bun:test";

const { createSession } = require("../../../../src/adapters/web/lib/chrome-ws-lib");

// Inline shim — mirrors what chromeHttp does inside chrome-ws-lib.js, but
// without depending on the closure-internal helper or expanding the
// public API.
function makeChromeHttp(host: string, port: number) {
  return async (path: string) => {
    const res = await fetch(`http://${host}:${port}${path}`);
    if (!res.ok) throw new Error(`chromeHttp ${path} -> ${res.status}`);
    const text = await res.text();
    try { return JSON.parse(text); } catch { return text; }
  };
}

describe("browser-session", () => {
  let session: any;

  beforeAll(async () => {
    session = createSession();
    await session.startChrome(true, "browser-session-test");
  });

  afterAll(async () => {
    if (session) await session.killChrome();
  });

  test("Browser.getVersion round-trips through the browser-level WS", async () => {
    const { createBrowserSession } = require("../../../../src/adapters/web/lib/browser-session");
    const port = session.getActivePort();
    const browser = createBrowserSession({
      host: "127.0.0.1",
      port,
      rewriteWsUrl: (u: string) => u,
      chromeHttp: makeChromeHttp("127.0.0.1", port),
    });
    const result = await browser.send("Browser.getVersion", {});
    expect(result).toBeDefined();
    expect(typeof result.product).toBe("string");
    expect(result.product.length).toBeGreaterThan(0);
    await browser.close();
  });

  test("onEvent receives Target.targetCreated after setDiscoverTargets", async () => {
    const { createBrowserSession } = require("../../../../src/adapters/web/lib/browser-session");
    const port = session.getActivePort();
    const browser = createBrowserSession({
      host: "127.0.0.1",
      port,
      rewriteWsUrl: (u: string) => u,
      chromeHttp: makeChromeHttp("127.0.0.1", port),
    });
    const seen: any[] = [];
    browser.onEvent((msg: any) => {
      if (msg.method === "Target.targetCreated") seen.push(msg.params);
    });
    await browser.send("Target.setDiscoverTargets", { discover: true });
    // Already-existing about:blank target is replayed on subscribe.
    await new Promise((r) => setTimeout(r, 200));
    expect(seen.length).toBeGreaterThan(0);
    await browser.close();
  });

  test("close() rejects pending requests with 'Browser session closed'", async () => {
    const { createBrowserSession } = require("../../../../src/adapters/web/lib/browser-session");
    const port = session.getActivePort();
    const browser = createBrowserSession({
      host: "127.0.0.1",
      port,
      rewriteWsUrl: (u: string) => u,
      chromeHttp: makeChromeHttp("127.0.0.1", port),
    });
    // Trigger a connect, then immediately close — pending request should reject.
    const inflight = browser.send("Browser.getVersion", {}, { timeoutMs: 30000 });
    await browser.close();
    await expect(inflight).rejects.toThrow(/Browser session/i);
  });
});
