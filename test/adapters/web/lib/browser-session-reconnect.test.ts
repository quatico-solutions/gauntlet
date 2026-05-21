import { describe, test, expect } from "bun:test";

const { createBrowserSession } = require("../../../../src/adapters/web/lib/browser-session");

// Spin up a tiny Bun WS server that speaks just enough CDP for the
// test — Browser.getVersion + on-demand close. Used to simulate Chrome's
// browser-WS dropping mid-session without needing a real Chrome process.
function startMockChromeWS(): Promise<{
  port: number;
  chromeHttp: (path: string) => Promise<unknown>;
  rewriteWsUrl: (url: string) => string;
  closeNextSocket: () => void;
  shutdown: () => Promise<void>;
}> {
  return new Promise((resolve) => {
    let openSocket: any = null;
    let shouldCloseOnNextMessage = false;

    const server = Bun.serve({
      port: 0,
      fetch(req, server) {
        const url = new URL(req.url);
        if (url.pathname === "/json/version") {
          return Response.json({
            webSocketDebuggerUrl: `ws://127.0.0.1:${server.port}/devtools/browser/test`,
          });
        }
        if (server.upgrade(req)) return undefined;
        return new Response("not found", { status: 404 });
      },
      websocket: {
        open(ws) {
          openSocket = ws;
        },
        message(ws, raw) {
          if (shouldCloseOnNextMessage) {
            shouldCloseOnNextMessage = false;
            ws.close();
            return;
          }
          const msg = JSON.parse(String(raw));
          // Echo a successful response for Browser.getVersion only.
          if (msg.method === "Browser.getVersion") {
            ws.send(JSON.stringify({ id: msg.id, result: { product: "MockChrome/0" } }));
          } else {
            ws.send(JSON.stringify({ id: msg.id, error: { message: `unhandled: ${msg.method}` } }));
          }
        },
        close() {
          openSocket = null;
        },
      },
    });

    const port = server.port;
    resolve({
      port,
      chromeHttp: async (path: string) => {
        const res = await fetch(`http://127.0.0.1:${port}${path}`);
        return res.json();
      },
      rewriteWsUrl: (u: string) => u,
      // Tells the next inbound WS message to be answered with a close
      // instead of a normal response — simulates Chrome shutting the
      // socket on us.
      closeNextSocket: () => {
        shouldCloseOnNextMessage = true;
      },
      shutdown: async () => {
        server.stop(true);
      },
    });
  });
}

describe("browser-session reconnect after WS close", () => {
  test("a send() after the WS drops lazy-reconnects instead of failing forever", async () => {
    const mock = await startMockChromeWS();
    const browser = createBrowserSession({
      host: "127.0.0.1",
      port: mock.port,
      rewriteWsUrl: mock.rewriteWsUrl,
      chromeHttp: mock.chromeHttp,
    });

    // First send: lazy-opens the WS, gets a normal response.
    const first = await browser.send("Browser.getVersion", {});
    expect(first.product).toBe("MockChrome/0");

    // Next send the server will drop the connection in response to,
    // simulating Chrome closing the browser-WS mid-session.
    mock.closeNextSocket();
    await expect(
      browser.send("Browser.getVersion", {}, { timeoutMs: 1000 }),
    ).rejects.toThrow();

    // Give the close handler a tick to settle.
    await new Promise((r) => setTimeout(r, 50));

    // The next send MUST lazy-reconnect rather than fail forever with
    // "WebSocket not connected". This is the PRI-1690 bug: the resolved
    // connectPromise short-circuits ensureConnected() so the new
    // connect never runs.
    const recovered = await browser.send("Browser.getVersion", {}, { timeoutMs: 2000 });
    expect(recovered.product).toBe("MockChrome/0");

    await browser.close();
    await mock.shutdown();
  });
});
