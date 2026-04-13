import { describe, expect, test } from "bun:test";
import { auth, b64, unb64, withServer } from "./helpers.ts";

async function startSession(
  base: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(`${base}/start`, {
    method: "POST",
    headers: { ...auth(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function getOutput(base: string, session: string, waitMs = 0, maxBytes?: number) {
  const qs = new URLSearchParams({ session, wait_ms: String(waitMs) });
  if (maxBytes !== undefined) qs.set("max_bytes", String(maxBytes));
  const r = await fetch(`${base}/output?${qs}`, { headers: auth() });
  return { status: r.status, body: (await r.json()) as any };
}

async function drainUntilExit(
  base: string,
  session: string,
  timeoutMs = 5000,
): Promise<{ data: string; exitCode: number | null }> {
  const deadline = Date.now() + timeoutMs;
  let acc = "";
  while (Date.now() < deadline) {
    const { body } = await getOutput(base, session, 1000);
    if (body.data) acc += unb64(body.data);
    if (body.exited) return { data: acc, exitCode: body.exit_code };
  }
  throw new Error(`timed out; acc=${JSON.stringify(acc)}`);
}

describe("POST /start", () => {
  test("400 on missing session", async () => {
    await withServer({}, async (base) => {
      const r = await startSession(base, { command: "echo hi" });
      expect(r.status).toBe(400);
      expect((await r.json()).error).toBe("bad_request");
    });
  });

  test("400 on missing command", async () => {
    await withServer({}, async (base) => {
      const r = await startSession(base, { session: "s1" });
      expect(r.status).toBe(400);
      expect((await r.json()).error).toBe("bad_request");
    });
  });

  test("400 on bad cwd", async () => {
    await withServer({}, async (base) => {
      const r = await startSession(base, {
        session: "s1",
        command: "echo hi",
        cwd: "/definitely/not/a/real/dir/xyz123",
      });
      expect(r.status).toBe(400);
      expect((await r.json()).error).toBe("bad_cwd");
    });
  });

  test("spawns a subprocess and returns a pid", async () => {
    await withServer({}, async (base) => {
      const r = await startSession(base, {
        session: "s1",
        command: "echo hello",
      });
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.ok).toBe(true);
      expect(typeof body.pid).toBe("number");
      expect(body.pid).toBeGreaterThan(0);
    });
  });

  test("409 on duplicate session id", async () => {
    await withServer({}, async (base) => {
      const a = await startSession(base, { session: "dup", command: "sleep 1" });
      expect(a.status).toBe(200);
      const b = await startSession(base, { session: "dup", command: "echo x" });
      expect(b.status).toBe(409);
      expect((await b.json()).error).toBe("session_exists");
    });
  });

  test("403 when command does not match --allow-command", async () => {
    await withServer({ allowCommand: /^echo / }, async (base) => {
      const r = await startSession(base, { session: "s", command: "ls" });
      expect(r.status).toBe(403);
      expect((await r.json()).error).toBe("command_not_allowed");
    });
  });

  test("allow-command permits matching commands", async () => {
    await withServer({ allowCommand: /^echo / }, async (base) => {
      const r = await startSession(base, { session: "s", command: "echo ok" });
      expect(r.status).toBe(200);
    });
  });

  test("env vars are merged into child environment", async () => {
    await withServer({}, async (base) => {
      await startSession(base, {
        session: "s",
        command: "printf %s \"$FOO\"",
        env: { FOO: "bar42" },
      });
      const { data } = await drainUntilExit(base, "s");
      expect(data).toBe("bar42");
    });
  });
});

describe("GET /output", () => {
  test("collects stdout from child", async () => {
    await withServer({}, async (base) => {
      await startSession(base, { session: "s", command: "echo hello" });
      const { data, exitCode } = await drainUntilExit(base, "s");
      expect(data).toBe("hello\n");
      expect(exitCode).toBe(0);
    });
  });

  test("merges stdout and stderr", async () => {
    await withServer({}, async (base) => {
      await startSession(base, {
        session: "s",
        command: "printf a; printf b 1>&2; printf c",
      });
      const { data } = await drainUntilExit(base, "s");
      expect(data.split("").sort().join("")).toBe("abc");
    });
  });

  test("returns non-zero exit_code", async () => {
    await withServer({}, async (base) => {
      await startSession(base, { session: "s", command: "exit 7" });
      const { exitCode } = await drainUntilExit(base, "s");
      expect(exitCode).toBe(7);
    });
  });

  test("wait_ms=0 returns immediately when buffer empty", async () => {
    await withServer({}, async (base) => {
      await startSession(base, { session: "s", command: "sleep 2" });
      const t0 = Date.now();
      const { body } = await getOutput(base, "s", 0);
      const dt = Date.now() - t0;
      expect(dt).toBeLessThan(500);
      expect(body.exited).toBe(false);
      expect(body.data).toBe("");
    });
  });

  test("wait_ms long-polls for new bytes", async () => {
    await withServer({}, async (base) => {
      await startSession(base, {
        session: "s",
        command: "sleep 0.2; echo late",
      });
      const t0 = Date.now();
      const { body } = await getOutput(base, "s", 2000);
      const dt = Date.now() - t0;
      expect(dt).toBeGreaterThanOrEqual(150);
      expect(dt).toBeLessThan(1800);
      expect(unb64(body.data).length).toBeGreaterThan(0);
    });
  });

  test("max_bytes truncates and marks truncated:true", async () => {
    await withServer({}, async (base) => {
      await startSession(base, { session: "s", command: "printf abcdefghij" });
      // Let it finish.
      await Bun.sleep(100);
      const { body } = await getOutput(base, "s", 0, 4);
      expect(unb64(body.data).length).toBe(4);
      expect(body.truncated).toBe(true);
      const rest = await getOutput(base, "s", 1000);
      expect(unb64(rest.body.data).length).toBe(6);
    });
  });

  test("drained bytes are not returned twice", async () => {
    await withServer({}, async (base) => {
      await startSession(base, { session: "s", command: "echo one" });
      await Bun.sleep(100);
      const a = await getOutput(base, "s", 500);
      expect(unb64(a.body.data)).toBe("one\n");
      const b = await getOutput(base, "s", 0);
      expect(b.body.data).toBe("");
    });
  });

  test("continues returning exited:true after drain until GC", async () => {
    await withServer({}, async (base) => {
      await startSession(base, { session: "s", command: "echo x" });
      await drainUntilExit(base, "s");
      const { body } = await getOutput(base, "s", 0);
      expect(body.exited).toBe(true);
      expect(body.data).toBe("");
    });
  });

  test("410 for unknown session", async () => {
    await withServer({}, async (base) => {
      const { status, body } = await getOutput(base, "never-existed", 0);
      expect(status).toBe(410);
      expect(body.error).toBe("session_gone");
    });
  });
});

describe("POST /stdin", () => {
  test("writes bytes to child's stdin", async () => {
    await withServer({}, async (base) => {
      await startSession(base, {
        session: "s",
        command: "cat",
      });
      const r = await fetch(`${base}/stdin`, {
        method: "POST",
        headers: { ...auth(), "Content-Type": "application/json" },
        body: JSON.stringify({ session: "s", data: b64("hello\n") }),
      });
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.ok).toBe(true);
      expect(body.bytes_written).toBe(6);
      // Close stdin by closing.
      await fetch(`${base}/close`, {
        method: "POST",
        headers: { ...auth(), "Content-Type": "application/json" },
        body: JSON.stringify({ session: "s" }),
      });
    });
  });

  test("empty data is a no-op", async () => {
    await withServer({}, async (base) => {
      await startSession(base, { session: "s", command: "sleep 1" });
      const r = await fetch(`${base}/stdin`, {
        method: "POST",
        headers: { ...auth(), "Content-Type": "application/json" },
        body: JSON.stringify({ session: "s", data: "" }),
      });
      expect(r.status).toBe(200);
      expect((await r.json()).bytes_written).toBe(0);
    });
  });

  test("410 on unknown session", async () => {
    await withServer({}, async (base) => {
      const r = await fetch(`${base}/stdin`, {
        method: "POST",
        headers: { ...auth(), "Content-Type": "application/json" },
        body: JSON.stringify({ session: "ghost", data: "" }),
      });
      expect(r.status).toBe(410);
      expect((await r.json()).error).toBe("session_gone");
    });
  });

  test("end-to-end: stdin + output round-trip", async () => {
    await withServer({}, async (base) => {
      await startSession(base, {
        session: "s",
        // head -c 6 closes the pipe after 6 bytes, making tr emit and exit.
        command: "head -c 6 | tr a-z A-Z",
      });
      await fetch(`${base}/stdin`, {
        method: "POST",
        headers: { ...auth(), "Content-Type": "application/json" },
        body: JSON.stringify({ session: "s", data: b64("hello\n") }),
      });
      const { data } = await drainUntilExit(base, "s");
      expect(data).toContain("HELLO");
    });
  });
});

describe("POST /close", () => {
  test("terminates a running process", async () => {
    await withServer({}, async (base) => {
      await startSession(base, { session: "s", command: "sleep 30" });
      const t0 = Date.now();
      const r = await fetch(`${base}/close`, {
        method: "POST",
        headers: { ...auth(), "Content-Type": "application/json" },
        body: JSON.stringify({ session: "s", signal: "SIGTERM", grace_ms: 500 }),
      });
      expect(r.status).toBe(200);
      expect(Date.now() - t0).toBeLessThan(1500);
    });
  });

  test("idempotent after natural exit", async () => {
    await withServer({}, async (base) => {
      await startSession(base, { session: "s", command: "echo done" });
      await drainUntilExit(base, "s");
      const r = await fetch(`${base}/close`, {
        method: "POST",
        headers: { ...auth(), "Content-Type": "application/json" },
        body: JSON.stringify({ session: "s" }),
      });
      expect(r.status).toBe(200);
      expect((await r.json()).exit_code).toBe(0);
    });
  });

  test("SIGKILL escalation when grace elapses", async () => {
    await withServer({}, async (base) => {
      await startSession(base, {
        session: "s",
        // perl ignores SIGTERM at the process level, forcing SIGKILL escalation.
        command: "perl -e '$SIG{TERM}=\"IGNORE\"; sleep 30'",
      });
      // Give perl time to install its SIGTERM handler.
      await Bun.sleep(200);
      const t0 = Date.now();
      const r = await fetch(`${base}/close`, {
        method: "POST",
        headers: { ...auth(), "Content-Type": "application/json" },
        body: JSON.stringify({ session: "s", grace_ms: 300 }),
      });
      expect(r.status).toBe(200);
      expect(Date.now() - t0).toBeGreaterThanOrEqual(250);
      expect(Date.now() - t0).toBeLessThan(2000);
    });
  });

  test("400 on invalid signal", async () => {
    await withServer({}, async (base) => {
      await startSession(base, { session: "s", command: "sleep 5" });
      const r = await fetch(`${base}/close`, {
        method: "POST",
        headers: { ...auth(), "Content-Type": "application/json" },
        body: JSON.stringify({ session: "s", signal: "SIGBOGUS" }),
      });
      expect(r.status).toBe(400);
    });
  });
});

describe("max body bytes", () => {
  test("413 for oversized bodies", async () => {
    await withServer({ maxBodyBytes: 100 }, async (base) => {
      const big = "x".repeat(500);
      const r = await fetch(`${base}/start`, {
        method: "POST",
        headers: { ...auth(), "Content-Type": "application/json" },
        body: JSON.stringify({ session: "s", command: big }),
      });
      expect(r.status).toBe(413);
    });
  });
});
