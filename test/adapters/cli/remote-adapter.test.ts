import { describe, test, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { RemoteCLIAdapter } from "../../../src/adapters/cli/remote-adapter";
import {
  createServer,
  type ServerHandle,
} from "../../../cli-runner/src/server";
import type { EvidenceLogger } from "../../../src/evidence/logger";

const TOKEN = "test-token-remote-adapter";

let relay: ServerHandle;
let baseUrl = "";

beforeAll(async () => {
  relay = await createServer({
    port: 0,
    bind: "127.0.0.1",
    token: TOKEN,
    sessionTimeoutSec: 60,
    maxBodyBytes: 8 * 1024 * 1024,
  });
  baseUrl = `http://127.0.0.1:${relay.port}`;
});

afterAll(async () => {
  await relay.stop();
});

function fakeLogger(): EvidenceLogger {
  return { logAction: () => {} } as unknown as EvidenceLogger;
}

async function settle(ms = 500) {
  await new Promise((r) => setTimeout(r, ms));
}

describe("RemoteCLIAdapter", () => {
  let adapter: RemoteCLIAdapter | null = null;

  afterEach(async () => {
    if (adapter) await adapter.close();
    adapter = null;
  });

  test("starts a shell and reads output via the relay", async () => {
    adapter = new RemoteCLIAdapter({ baseUrl, token: TOKEN });
    await adapter.start("echo 'hello remote'");
    await settle();
    const output = adapter.readOutput();
    expect(output).toContain("hello remote");
  });

  test("sends input and reads response over the relay", async () => {
    adapter = new RemoteCLIAdapter({ baseUrl, token: TOKEN });
    await adapter.start("cat");
    await adapter.type("ping\n");
    await settle();
    const output = adapter.readOutput();
    expect(output).toContain("ping");
  });

  test("press maps special keys to control bytes", async () => {
    adapter = new RemoteCLIAdapter({ baseUrl, token: TOKEN });
    await adapter.start("cat");
    await adapter.type("hello");
    await adapter.press("Enter");
    await settle();
    const output = adapter.readOutput();
    expect(output).toContain("hello");
  });

  test("readOutput drains buffer — second read returns empty", async () => {
    adapter = new RemoteCLIAdapter({ baseUrl, token: TOKEN });
    await adapter.start("echo drain-me");
    await settle();
    const a = adapter.readOutput();
    expect(a).toContain("drain-me");
    const b = adapter.readOutput();
    expect(b).toBe("");
  });

  test("close terminates the remote session", async () => {
    adapter = new RemoteCLIAdapter({ baseUrl, token: TOKEN });
    await adapter.start("sleep 30");
    const t0 = Date.now();
    await adapter.close();
    expect(Date.now() - t0).toBeLessThan(2000);
    adapter = null;
  });

  test("exposes the same tool definitions as CLIAdapter", () => {
    adapter = new RemoteCLIAdapter({ baseUrl, token: TOKEN });
    const names = adapter.toolDefinitions().map((t) => t.name);
    expect(names).toContain("type");
    expect(names).toContain("press");
    expect(names).toContain("read_output");
  });

  test("executeTool routes type/press/read_output", async () => {
    adapter = new RemoteCLIAdapter({ baseUrl, token: TOKEN });
    await adapter.start("cat");
    const logger = fakeLogger();
    await adapter.executeTool("type", { text: "exec-me" }, logger);
    await adapter.executeTool("press", { key: "Enter" }, logger);
    await settle();
    const res = await adapter.executeTool("read_output", {}, logger);
    expect(res.text).toContain("exec-me");
  });

  test("type before start throws", async () => {
    adapter = new RemoteCLIAdapter({ baseUrl, token: TOKEN });
    await expect(adapter.type("x")).rejects.toThrow();
  });

  test("press rejects unknown keys", async () => {
    adapter = new RemoteCLIAdapter({ baseUrl, token: TOKEN });
    await adapter.start("cat");
    await expect(adapter.press("Banana")).rejects.toThrow();
  });

  test("bad token yields a clear error on start", async () => {
    adapter = new RemoteCLIAdapter({ baseUrl, token: "wrong" });
    await expect(adapter.start("echo hi")).rejects.toThrow(/unauthorized|401/i);
    adapter = null;
  });

  test("close after natural exit is a no-op", async () => {
    adapter = new RemoteCLIAdapter({ baseUrl, token: TOKEN });
    await adapter.start("echo done");
    await settle(300);
    // First close (may actually drive POST /close, may be no-op).
    await adapter.close();
    // Second close must not throw.
    await adapter.close();
    adapter = null;
  });

  test("collects output arriving after start (polling loop)", async () => {
    adapter = new RemoteCLIAdapter({ baseUrl, token: TOKEN });
    await adapter.start("sh -c 'sleep 0.2; echo late-one; sleep 0.2; echo late-two'");
    // Readings taken at intervals should eventually see both lines.
    await settle(1000);
    const out = adapter.readOutput();
    expect(out).toContain("late-one");
    expect(out).toContain("late-two");
  });
});
