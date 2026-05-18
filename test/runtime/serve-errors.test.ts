import { describe, test, expect } from "bun:test";
import { serve } from "../../src/runtime/serve";
import { pickFreePort } from "../../src/util/pick-free-port";

/**
 * `serve()` is a thin cross-runtime wrapper (Bun.serve / @hono/node-server).
 * It does NOT parse bodies, enforce size limits, or implement per-route
 * validation — those are caller concerns and the route handlers in src/api/
 * already have coverage for their 4xx/413 contracts in test/api/.
 *
 * The audit (item #6) called out "malformed JSON", "oversized payload",
 * and "mid-flight closed connections" as gaps. The first two don't belong
 * to serve.ts at all; the third does. This file pins the third.
 *
 * One other regression risk we considered: "fetch handler throws → server
 * keeps serving". We cannot pin that one in bun:test — Bun's unhandled-
 * error capture treats a server-side handler throw as a test failure
 * even when the underlying server is fine, so the test can't observe
 * the contract. In production, a route handler that throws is already
 * an evidence-bearing event (it shows up in normal `bun test` output);
 * a dedicated test here would be ceremonial.
 */
describe("runtime/serve error paths", () => {
  test("a client abort mid-request does not crash the server", async () => {
    const port = await pickFreePort();
    const server = serve({
      port,
      fetch: async (req) => {
        const url = new URL(req.url);
        if (url.pathname === "/slow") {
          // Long enough to be cancelled before completion.
          await new Promise((r) => setTimeout(r, 1000));
          return new Response("late");
        }
        return new Response("ok");
      },
    });
    try {
      const ac = new AbortController();
      const slowReq = fetch(`http://127.0.0.1:${port}/slow`, {
        signal: ac.signal,
      });
      // Abort after 50ms — well before the handler resolves.
      setTimeout(() => ac.abort(), 50);
      await expect(slowReq).rejects.toThrow();

      // A subsequent normal request must still complete.
      const followup = await fetch(`http://127.0.0.1:${port}/ok`);
      expect(followup.status).toBe(200);
      expect(await followup.text()).toBe("ok");
    } finally {
      await server.stop();
    }
  });
});
