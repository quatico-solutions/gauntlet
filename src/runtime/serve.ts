/**
 * Cross-runtime HTTP + WebSocket server.
 *
 * On Bun: a single `Bun.serve` handles both HTTP and WS upgrades.
 *
 * On Node: `@hono/node-server` provides the HTTP layer (it accepts a
 * standard `Request → Response` fetch callback) and the `ws` library
 * handles the upgrade. The two are stitched together via the underlying
 * `http.Server`'s `upgrade` event.
 *
 * The two implementations expose the same `serve()` surface so callers
 * never branch on runtime.
 */
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { serve as honoServe } from "@hono/node-server";
import { WebSocketServer } from "ws";

const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";

export interface WsLike {
  send(data: string): void;
  readyState: number;
  close(code?: number, reason?: string): void;
}

export interface WebsocketHooks<T> {
  /**
   * Decide whether an incoming request should upgrade to a WebSocket.
   * Return upgrade data to upgrade, or null to fall through to `fetch`.
   */
  upgrade(url: URL): T | null;
  open(ws: WsLike, data: T): void;
  close(ws: WsLike, data: T): void;
}

export interface ServeOptions<T = unknown> {
  port: number;
  /** Bun-only; ignored on Node. Seconds before idle connections close. */
  idleTimeout?: number;
  fetch(req: Request): Response | Promise<Response>;
  websocket?: WebsocketHooks<T>;
}

export interface RunningServer {
  stop(): Promise<void>;
}

export function serve<T extends object>(opts: ServeOptions<T>): RunningServer {
  return isBun ? serveViaBun(opts) : serveViaNode(opts);
}

function serveViaBun<T extends object>(opts: ServeOptions<T>): RunningServer {
  const Bun = (globalThis as { Bun: typeof globalThis.Bun }).Bun;
  const { fetch: appFetch, websocket, port, idleTimeout } = opts;

  if (!websocket) {
    const server = Bun.serve({
      port,
      idleTimeout,
      fetch: (req) => appFetch(req),
    });
    return { stop: async () => { server.stop(); } };
  }

  const server = Bun.serve<T>({
    port,
    idleTimeout,
    fetch(req, server) {
      const url = new URL(req.url);
      const data = websocket.upgrade(url);
      if (data !== null) {
        // Bun's upgrade overload widens to `[T] extends [undefined]`,
        // which `tsc` can't narrow even with `T extends object` here.
        const upgraded = (server.upgrade as (req: Request, opts: { data: T }) => boolean)(req, { data });
        if (upgraded) return undefined;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }
      return appFetch(req);
    },
    websocket: {
      open(ws) { websocket.open(ws as unknown as WsLike, ws.data); },
      close(ws) { websocket.close(ws as unknown as WsLike, ws.data); },
      message() {},
    },
  });
  return { stop: async () => { server.stop(); } };
}

function serveViaNode<T>(opts: ServeOptions<T>): RunningServer {
  const httpServer = honoServe({
    port: opts.port,
    fetch: (req) => opts.fetch(req as Request) as Response | Promise<Response>,
  });

  if (opts.websocket) {
    const hooks = opts.websocket;
    const wss = new WebSocketServer({ noServer: true });
    httpServer.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const data = hooks.upgrade(url);
      if (data === null) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        const wsLike = ws as unknown as WsLike;
        hooks.open(wsLike, data);
        ws.on("close", () => { hooks.close(wsLike, data); });
      });
    });
  }

  return {
    stop: () =>
      new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
