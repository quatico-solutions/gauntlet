import { createServer } from "net";

/**
 * Picks a free TCP port by binding to 0 on localhost, reading the
 * assigned port, and releasing. Subject to TOCTOU — another process
 * could grab it between release and re-bind — so callers that spawn a
 * server should retry once on EADDRINUSE if they see it. In practice
 * the window is tiny and retrying rarely triggers.
 */
export function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close();
        reject(new Error("unexpected address shape"));
      }
    });
  });
}
