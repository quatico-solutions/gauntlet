import { existsSync, statSync } from "node:fs";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { timingSafeEqual } from "node:crypto";

export const VERSION = "0.1.0";

export interface ServerOptions {
  port: number;
  bind: string;
  token: string;
  sessionTimeoutSec: number;
  maxBodyBytes: number;
  allowCommand?: RegExp;
}

export interface ServerHandle {
  port: number;
  stop(): Promise<void>;
}

const VALID_SIGNALS = new Set(["SIGTERM", "SIGINT", "SIGKILL", "SIGHUP"]);

type Waiter = () => void;

interface Session {
  id: string;
  child: ChildProcessWithoutNullStreams;
  buffer: Buffer[];
  bufferLen: number;
  exited: boolean;
  drainedAfterExit: boolean;
  exitCode: number | null;
  waiters: Waiter[];
  stdinClosed: boolean;
  gcTimer: ReturnType<typeof setTimeout> | null;
  lastActivity: number;
}

export async function createServer(opts: ServerOptions): Promise<ServerHandle> {
  const sessions = new Map<string, Session>();
  const tokenBuf = Buffer.from(opts.token);

  function checkAuth(req: Request): boolean {
    const h = req.headers.get("authorization") ?? "";
    const m = /^Bearer (.+)$/.exec(h);
    if (!m) return false;
    const got = Buffer.from(m[1]!);
    if (got.length !== tokenBuf.length) return false;
    return timingSafeEqual(got, tokenBuf);
  }

  function scheduleGc(s: Session) {
    if (s.gcTimer) clearTimeout(s.gcTimer);
    s.gcTimer = setTimeout(() => {
      sessions.delete(s.id);
    }, opts.sessionTimeoutSec * 1000);
  }

  function notify(s: Session) {
    const ws = s.waiters.splice(0);
    for (const w of ws) w();
  }

  function attachChild(s: Session) {
    const onData = (chunk: Buffer) => {
      s.buffer.push(chunk);
      s.bufferLen += chunk.length;
      notify(s);
    };
    s.child.stdout.on("data", onData);
    s.child.stderr.on("data", onData);
    s.child.on("exit", (code, signal) => {
      s.exited = true;
      s.exitCode = code ?? (signal ? -1 : null);
      notify(s);
      scheduleGc(s);
    });
    s.child.stdin.on("error", () => {
      s.stdinClosed = true;
    });
  }

  async function readBody(req: Request): Promise<
    | { ok: true; value: unknown }
    | { ok: false; status: number; error: string; message: string }
  > {
    const cl = req.headers.get("content-length");
    if (cl !== null) {
      const n = Number(cl);
      if (Number.isFinite(n) && n > opts.maxBodyBytes) {
        return { ok: false, status: 413, error: "payload_too_large", message: "body too large" };
      }
    }
    const buf = Buffer.from(await req.arrayBuffer());
    if (buf.length > opts.maxBodyBytes) {
      return { ok: false, status: 413, error: "payload_too_large", message: "body too large" };
    }
    if (buf.length === 0) return { ok: true, value: {} };
    try {
      return { ok: true, value: JSON.parse(buf.toString("utf8")) };
    } catch {
      return { ok: false, status: 400, error: "bad_request", message: "invalid JSON" };
    }
  }

  async function handleStart(req: Request): Promise<Response> {
    const parsed = await readBody(req);
    if (!parsed.ok) return errorJson(parsed.status, parsed.error, parsed.message);
    const body = parsed.value as Record<string, unknown>;
    const session = body.session;
    const command = body.command;
    const cwd = body.cwd;
    const env = body.env;

    if (typeof session !== "string" || !session) {
      return errorJson(400, "bad_request", "session required");
    }
    if (typeof command !== "string" || !command) {
      return errorJson(400, "bad_request", "command required");
    }
    if (cwd !== undefined && typeof cwd !== "string") {
      return errorJson(400, "bad_request", "cwd must be string");
    }
    if (env !== undefined && (env === null || typeof env !== "object" || Array.isArray(env))) {
      return errorJson(400, "bad_request", "env must be object");
    }
    if (opts.allowCommand && !opts.allowCommand.test(command)) {
      return errorJson(403, "command_not_allowed", "command blocked by allowlist");
    }
    if (sessions.has(session)) {
      return errorJson(409, "session_exists", `session ${session} already exists`);
    }
    if (cwd !== undefined) {
      try {
        if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
          return errorJson(400, "bad_cwd", `cwd not a directory: ${cwd}`);
        }
      } catch {
        return errorJson(400, "bad_cwd", `cwd not accessible: ${cwd}`);
      }
    }
    const childEnv = { ...process.env, ...(env as Record<string, string> | undefined) };
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn("sh", ["-c", command], {
        cwd: cwd as string | undefined,
        env: childEnv,
        stdio: ["pipe", "pipe", "pipe"],
        detached: true,
      }) as ChildProcessWithoutNullStreams;
    } catch (e) {
      return errorJson(500, "spawn_failed", String(e));
    }
    const s: Session = {
      id: session,
      child,
      buffer: [],
      bufferLen: 0,
      exited: false,
      drainedAfterExit: false,
      exitCode: null,
      waiters: [],
      stdinClosed: false,
      gcTimer: null,
      lastActivity: Date.now(),
    };
    attachChild(s);
    sessions.set(session, s);
    return okJson({ ok: true, pid: child.pid });
  }

  async function handleStdin(req: Request): Promise<Response> {
    const parsed = await readBody(req);
    if (!parsed.ok) return errorJson(parsed.status, parsed.error, parsed.message);
    const body = parsed.value as Record<string, unknown>;
    const sid = body.session;
    const data = body.data;
    if (typeof sid !== "string") return errorJson(400, "bad_request", "session required");
    if (typeof data !== "string") return errorJson(400, "bad_request", "data required");
    const s = sessions.get(sid);
    if (!s) return errorJson(410, "session_gone", "unknown session");
    if (s.exited || s.stdinClosed || !s.child.stdin.writable) {
      return errorJson(410, "session_gone", "stdin closed");
    }
    const bytes = Buffer.from(data, "base64");
    if (bytes.length === 0) return okJson({ ok: true, bytes_written: 0 });
    await new Promise<void>((resolve, reject) => {
      s.child.stdin.write(bytes, (err) => (err ? reject(err) : resolve()));
    });
    return okJson({ ok: true, bytes_written: bytes.length });
  }

  async function handleOutput(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const sid = url.searchParams.get("session");
    if (!sid) return errorJson(400, "bad_request", "session required");
    const waitMs = Math.max(0, Math.min(30000, Number(url.searchParams.get("wait_ms") ?? 0) || 0));
    const maxBytes = Math.max(
      1,
      Number(url.searchParams.get("max_bytes") ?? 1048576) || 1048576,
    );
    const s = sessions.get(sid);
    if (!s) return errorJson(410, "session_gone", "unknown session");

    if (s.bufferLen === 0 && !s.exited && waitMs > 0) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          const idx = s.waiters.indexOf(w);
          if (idx >= 0) s.waiters.splice(idx, 1);
          resolve();
        }, waitMs);
        const w: Waiter = () => {
          clearTimeout(timer);
          resolve();
        };
        s.waiters.push(w);
      });
    }

    const joined = Buffer.concat(s.buffer, s.bufferLen);
    s.buffer = [];
    s.bufferLen = 0;
    let out: Buffer;
    let truncated = false;
    if (joined.length > maxBytes) {
      out = joined.subarray(0, maxBytes);
      const remainder = joined.subarray(maxBytes);
      s.buffer = [remainder];
      s.bufferLen = remainder.length;
      truncated = true;
    } else {
      out = joined;
    }
    const exitedNow = s.exited && s.bufferLen === 0;
    return okJson({
      data: out.toString("base64"),
      exited: exitedNow,
      exit_code: exitedNow ? s.exitCode : null,
      truncated,
    });
  }

  async function handleClose(req: Request): Promise<Response> {
    const parsed = await readBody(req);
    if (!parsed.ok) return errorJson(parsed.status, parsed.error, parsed.message);
    const body = parsed.value as Record<string, unknown>;
    const sid = body.session;
    const signal = (body.signal as string | undefined) ?? "SIGTERM";
    const graceRaw = body.grace_ms;
    const graceMs = Math.max(
      0,
      Math.min(30000, typeof graceRaw === "number" ? graceRaw : 2000),
    );
    if (typeof sid !== "string") return errorJson(400, "bad_request", "session required");
    if (!VALID_SIGNALS.has(signal)) {
      return errorJson(400, "bad_request", `invalid signal: ${signal}`);
    }
    const s = sessions.get(sid);
    if (!s) return errorJson(410, "session_gone", "unknown session");
    if (s.exited) {
      return okJson({ ok: true, exit_code: s.exitCode });
    }
    signalSession(s, signal);
    const waited = await waitForExit(s, graceMs);
    if (!waited) {
      signalSession(s, "SIGKILL");
      await waitForExit(s, 2000);
    }
    return okJson({ ok: true, exit_code: s.exitCode });
  }

  function signalSession(s: Session, signal: string) {
    const pid = s.child.pid;
    if (!pid) return;
    try {
      process.kill(-pid, signal as NodeJS.Signals);
    } catch {
      try {
        s.child.kill(signal as NodeJS.Signals);
      } catch {
        // ignore
      }
    }
  }

  function waitForExit(s: Session, timeoutMs: number): Promise<boolean> {
    if (s.exited) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      s.child.once("exit", () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  const server = Bun.serve({
    port: opts.port,
    hostname: opts.bind,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "GET" && url.pathname === "/health") {
        return okJson({ ok: true, version: VERSION });
      }
      if (!checkAuth(req)) return errorJson(401, "unauthorized", "bad or missing token");
      if (req.method === "POST" && url.pathname === "/start") return handleStart(req);
      if (req.method === "POST" && url.pathname === "/stdin") return handleStdin(req);
      if (req.method === "GET" && url.pathname === "/output") return handleOutput(req);
      if (req.method === "POST" && url.pathname === "/close") return handleClose(req);
      return errorJson(404, "not_found", "no such endpoint");
    },
  });
  return {
    port: server.port,
    async stop() {
      for (const s of sessions.values()) {
        if (!s.exited) {
          try {
            s.child.kill("SIGKILL");
          } catch {
            // ignore
          }
        }
        if (s.gcTimer) clearTimeout(s.gcTimer);
      }
      sessions.clear();
      server.stop(true);
    },
  };
}

function okJson(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function errorJson(status: number, error: string, message: string) {
  return new Response(JSON.stringify({ error, message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
