import { describe, test, expect } from "bun:test";

const { WebSocketClient } = require("../../../../src/adapters/web/lib/websocket-client");

// Use Bun.serve to capture the WebSocket upgrade request's headers in the
// fetch handler, then complete the upgrade so the client connects. We don't
// need a real CDP server — we only care about the upgrade headers.
async function captureUpgradeHeaders(): Promise<{
  port: number;
  awaitHeaders: () => Promise<Headers>;
  shutdown: () => Promise<void>;
}> {
  let resolveHeaders: (h: Headers) => void;
  const headersPromise = new Promise<Headers>((r) => {
    resolveHeaders = r;
  });

  const server = Bun.serve({
    port: 0,
    fetch(req, srv) {
      resolveHeaders(req.headers);
      if (srv.upgrade(req)) return undefined;
      return new Response("expected websocket", { status: 400 });
    },
    websocket: {
      open() {
        /* no-op */
      },
      message() {
        /* no-op */
      },
      close() {
        /* no-op */
      },
    },
  });

  return {
    port: server.port,
    awaitHeaders: () => headersPromise,
    shutdown: async () => {
      server.stop(true);
    },
  };
}

describe("websocket-client compression negotiation", () => {
  test("does not advertise permessage-deflate in the upgrade handshake", async () => {
    const srv = await captureUpgradeHeaders();
    try {
      const ws = new WebSocketClient(`ws://127.0.0.1:${srv.port}/test`);
      // Don't await connect — we only want the upgrade headers, and
      // closing afterwards keeps the test fast.
      ws.connect().catch(() => {});

      const headers = await srv.awaitHeaders();
      const ext = headers.get("sec-websocket-extensions") ?? "";

      // PRI-1690: Bun's global WebSocket negotiates permessage-deflate
      // by default, and Chrome's CDP sometimes sends frames Bun can't
      // decompress (code=1002, "Invalid compressed data") — slamming
      // the connection mid-run. The fix is to opt out of compression
      // entirely; this test pins that decision.
      expect(ext).not.toMatch(/permessage-deflate/i);

      try {
        ws.close();
      } catch {
        /* best-effort */
      }
    } finally {
      await srv.shutdown();
    }
  });
});
