import { createServer, type ServerHandle, type ServerOptions } from "../src/server.ts";

export const TOKEN = "test-token-xyz";

export async function withServer(
  opts: Partial<ServerOptions>,
  fn: (base: string, handle: ServerHandle) => Promise<void>,
) {
  const handle = await createServer({
    port: 0,
    bind: "127.0.0.1",
    token: TOKEN,
    sessionTimeoutSec: 300,
    maxBodyBytes: 8 * 1024 * 1024,
    ...opts,
  });
  try {
    await fn(`http://127.0.0.1:${handle.port}`, handle);
  } finally {
    await handle.stop();
  }
}

export function auth(extra: Record<string, string> = {}): HeadersInit {
  return { Authorization: `Bearer ${TOKEN}`, ...extra };
}

export function b64(s: string) {
  return Buffer.from(s).toString("base64");
}

export function unb64(s: string) {
  return Buffer.from(s, "base64").toString("utf8");
}
