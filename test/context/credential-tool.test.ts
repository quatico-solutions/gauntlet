import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import {
  runResolver,
  buildFetchCredentialTool,
  FETCH_CREDENTIAL_TOOL_DESCRIPTION,
} from "../../src/context/credential-tool";
import type { CredentialResolverConfig } from "../../src/config";

const FIXTURES = resolve(__dirname, "../fixtures");
const OK = resolve(FIXTURES, "credential-resolver-ok.sh");
const FAIL = resolve(FIXTURES, "credential-resolver-fail.sh");
const SLOW = resolve(FIXTURES, "credential-resolver-slow.sh");
const EMPTY = resolve(FIXTURES, "credential-resolver-empty.sh");
const OVERFLOW = resolve(FIXTURES, "credential-resolver-overflow.sh");
const STDERR_OVERFLOW = resolve(FIXTURES, "credential-resolver-stderr-overflow.sh");

function cfg(path: string, timeoutMs = 5_000): CredentialResolverConfig {
  return { path, timeoutMs, includeInTranscripts: false };
}

describe("runResolver", () => {
  test("success: captures stdout and exits 0", async () => {
    const result = await runResolver(cfg(OK), "alice", "otp");
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.stdout).toBe("ok-for-alice:otp\n");
      expect(result.exitCode).toBe(0);
      expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    }
  });

  test("nonzero exit: stderr captured, kind=nonzero_exit", async () => {
    const result = await runResolver(cfg(FAIL), "alice", "pin");
    expect(result.kind).toBe("nonzero_exit");
    if (result.kind === "nonzero_exit") {
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("no credential 'pin' for entity 'alice'");
    }
  });

  test("empty stdout on success is reported as empty_stdout", async () => {
    // Resolver that exits 0 but prints nothing to stdout.
    const result = await runResolver(cfg(EMPTY), "alice", "otp");
    expect(result.kind).toBe("empty_stdout");
  });

  test("timeout: SIGTERM after timeout, then SIGKILL after grace", async () => {
    const start = Date.now();
    const result = await runResolver(cfg(SLOW, 200), "alice", "otp");
    const elapsed = Date.now() - start;
    expect(result.kind).toBe("timeout");
    // Timeout (200ms) + grace (2000ms) = ~2200ms ceiling; allow slack.
    expect(elapsed).toBeLessThan(3_500);
    if (result.kind === "timeout") {
      expect(result.timeoutMs).toBe(200);
    }
  });

  test("spawn failure: missing binary returns kind=spawn_failed", async () => {
    const result = await runResolver(cfg("/nonexistent/resolver.sh"), "alice", "otp");
    expect(result.kind).toBe("spawn_failed");
    if (result.kind === "spawn_failed") {
      expect(result.error).toMatch(/ENOENT|no such file/i);
    }
  });

  test("stdout overflow: resolver writes > 64 KiB returns kind=stdout_overflow", async () => {
    // Resolver that prints 100 KiB. The kernel chunks the pipe write into
    // some number of `data` events; the first chunk that pushes the
    // running total past 64 KiB trips the overflow guard, regardless of
    // chunk boundaries. So this is robust to Bun's stream buffering.
    const result = await runResolver(cfg(OVERFLOW), "alice", "otp");
    expect(result.kind).toBe("stdout_overflow");
  });
});

interface RecordedEvent { name: string; payload: Record<string, unknown>; }

function makeLogger(): { events: RecordedEvent[]; logger: { logEvent(name: string, payload: Record<string, unknown>): void } } {
  const events: RecordedEvent[] = [];
  return {
    events,
    logger: { logEvent(name, payload) { events.push({ name, payload }); } },
  };
}

async function withPopulatedContextRoot<T>(
  fn: (root: string) => T | Promise<T>,
): Promise<T> {
  // Async so callers can `await` work inside `fn` before the temp dir
  // is deleted. A sync `try/finally` would `rmSync` the dir the
  // instant `fn` returned its Promise, racing against any unresolved
  // awaits inside.
  const tmp = mkdtempSync(join(tmpdir(), "gauntlet-credtool-"));
  writeFileSync(join(tmp, "marker.md"), "anything");
  try { return await fn(tmp); } finally { rmSync(tmp, { recursive: true, force: true }); }
}

describe("buildFetchCredentialTool", () => {
  test("returns null when contextRoot is empty (no files)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "gauntlet-credtool-empty-"));
    try {
      const tool = buildFetchCredentialTool(tmp, cfg(OK));
      expect(tool).toBeNull();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("returns null when resolverConfig is undefined", async () => {
    await withPopulatedContextRoot((root) => {
      const tool = buildFetchCredentialTool(root, undefined);
      expect(tool).toBeNull();
    });
  });

  test("registers as `fetch_credential` with entity + key string params", async () => {
    await withPopulatedContextRoot((root) => {
      const tool = buildFetchCredentialTool(root, cfg(OK));
      expect(tool).not.toBeNull();
      expect(tool!.definition.name).toBe("fetch_credential");
      const params = tool!.definition.parameters as {
        properties: { entity: { type: string }; key: { type: string } };
        required: string[];
      };
      expect(params.properties.entity.type).toBe("string");
      expect(params.properties.key.type).toBe("string");
      expect(params.required).toEqual(["entity", "key"]);
    });
  });

  test("tool description matches exported constant", async () => {
    await withPopulatedContextRoot((root) => {
      const tool = buildFetchCredentialTool(root, cfg(OK));
      expect(tool!.definition.description).toBe(FETCH_CREDENTIAL_TOOL_DESCRIPTION);
    });
  });

  test("execute success returns resolver stdout verbatim and logs ok event", async () => {
    await withPopulatedContextRoot(async (root) => {
      const { events, logger } = makeLogger();
      const tool = buildFetchCredentialTool(root, cfg(OK))!;
      const result = await tool.execute({ entity: "alice", key: "otp" }, logger);
      expect(result.text).toBe("ok-for-alice:otp\n");
      expect(events).toHaveLength(1);
      expect(events[0]?.name).toBe("fetch_credential_ok");
      expect(events[0]?.payload).toMatchObject({
        entity: "alice",
        key: "otp",
        exitCode: 0,
        stdoutLength: "ok-for-alice:otp\n".length,
      });
    });
  });

  test("execute nonzero exit returns error markdown and logs failed event", async () => {
    await withPopulatedContextRoot(async (root) => {
      const { events, logger } = makeLogger();
      const tool = buildFetchCredentialTool(root, cfg(FAIL))!;
      const result = await tool.execute({ entity: "alice", key: "pin" }, logger);
      expect(result.text).toMatch(/Error: fetch_credential resolver exited 2 for alice:pin/);
      expect(result.text).toContain("no credential 'pin' for entity 'alice'");
      expect(events[0]?.name).toBe("fetch_credential_failed");
      expect(events[0]?.payload).toMatchObject({
        entity: "alice",
        key: "pin",
        step: "nonzero_exit",
      });
    });
  });

  test("execute timeout returns timeout error markdown and logs timeout event", async () => {
    await withPopulatedContextRoot(async (root) => {
      const { events, logger } = makeLogger();
      const tool = buildFetchCredentialTool(root, cfg(SLOW, 200))!;
      const result = await tool.execute({ entity: "alice", key: "otp" }, logger);
      expect(result.text).toMatch(/Error: fetch_credential resolver timed out after 200ms for alice:otp/);
      expect(events[0]?.name).toBe("fetch_credential_failed");
      expect(events[0]?.payload).toMatchObject({
        entity: "alice",
        key: "otp",
        step: "timeout",
        timeoutMs: 200,
      });
    });
  });

  test("execute empty stdout returns empty-success error and logs empty_stdout event", async () => {
    await withPopulatedContextRoot(async (root) => {
      const { events, logger } = makeLogger();
      const tool = buildFetchCredentialTool(root, cfg(EMPTY))!;
      const result = await tool.execute({ entity: "alice", key: "otp" }, logger);
      expect(result.text).toMatch(/Error: fetch_credential resolver returned empty success for alice:otp/);
      expect(events[0]?.name).toBe("fetch_credential_failed");
      expect(events[0]?.payload?.step).toBe("empty_stdout");
    });
  });

  test("execute stdout overflow returns overflow error and logs stdout_overflow event", async () => {
    await withPopulatedContextRoot(async (root) => {
      const { events, logger } = makeLogger();
      const tool = buildFetchCredentialTool(root, cfg(OVERFLOW))!;
      const result = await tool.execute({ entity: "alice", key: "otp" }, logger);
      expect(result.text).toMatch(/Error: fetch_credential resolver stdout exceeded 64 KiB for alice:otp/);
      expect(events[0]?.name).toBe("fetch_credential_failed");
      expect(events[0]?.payload?.step).toBe("stdout_overflow");
    });
  });

  test("execute stderr overflow returns stderr-overflow error and logs stderr_overflow event", async () => {
    await withPopulatedContextRoot(async (root) => {
      const { events, logger } = makeLogger();
      const tool = buildFetchCredentialTool(root, cfg(STDERR_OVERFLOW))!;
      const result = await tool.execute({ entity: "alice", key: "otp" }, logger);
      expect(result.text).toMatch(/Error: fetch_credential resolver stderr exceeded 8 KiB for alice:otp/);
      expect(events[0]?.name).toBe("fetch_credential_failed");
      expect(events[0]?.payload?.step).toBe("stderr_overflow");
    });
  });

  test("execute spawn failure returns spawn error and logs spawn event", async () => {
    await withPopulatedContextRoot(async (root) => {
      const { events, logger } = makeLogger();
      const missing: CredentialResolverConfig = { path: "/nonexistent/resolver.sh", timeoutMs: 5000, includeInTranscripts: false };
      const tool = buildFetchCredentialTool(root, missing)!;
      const result = await tool.execute({ entity: "alice", key: "otp" }, logger);
      expect(result.text).toMatch(/Error: fetch_credential resolver failed to spawn/);
      expect(events[0]?.name).toBe("fetch_credential_failed");
      expect(events[0]?.payload?.step).toBe("spawn");
    });
  });

  test("execute rejects entity with path traversal", async () => {
    await withPopulatedContextRoot(async (root) => {
      const { events, logger } = makeLogger();
      const tool = buildFetchCredentialTool(root, cfg(OK))!;
      const result = await tool.execute({ entity: "../escape", key: "otp" }, logger);
      expect(result.text).toMatch(/Error: fetch_credential argument "entity" rejected/);
      expect(events[0]?.payload?.step).toBe("validate_args");
    });
  });

  test("execute rejects entity with backslash", async () => {
    await withPopulatedContextRoot(async (root) => {
      const tool = buildFetchCredentialTool(root, cfg(OK))!;
      const result = await tool.execute({ entity: "alice\\nope", key: "otp" });
      expect(result.text).toMatch(/Error: fetch_credential argument "entity" rejected/);
    });
  });

  test("execute rejects entity with leading dot", async () => {
    await withPopulatedContextRoot(async (root) => {
      const tool = buildFetchCredentialTool(root, cfg(OK))!;
      const result = await tool.execute({ entity: ".hidden", key: "otp" });
      expect(result.text).toMatch(/Error: fetch_credential argument "entity" rejected/);
    });
  });

  test("execute rejects empty entity", async () => {
    await withPopulatedContextRoot(async (root) => {
      const tool = buildFetchCredentialTool(root, cfg(OK))!;
      const result = await tool.execute({ entity: "", key: "otp" });
      expect(result.text).toMatch(/Error: fetch_credential argument "entity" rejected/);
    });
  });

  test("execute rejects entity longer than 256 chars", async () => {
    await withPopulatedContextRoot(async (root) => {
      const tool = buildFetchCredentialTool(root, cfg(OK))!;
      const result = await tool.execute({ entity: "a".repeat(257), key: "otp" });
      expect(result.text).toMatch(/Error: fetch_credential argument "entity" rejected/);
    });
  });

  test("execute rejects key with disallowed chars (e.g. dot)", async () => {
    await withPopulatedContextRoot(async (root) => {
      const tool = buildFetchCredentialTool(root, cfg(OK))!;
      const result = await tool.execute({ entity: "alice", key: "ot.p" });
      expect(result.text).toMatch(/Error: fetch_credential argument "key" rejected/);
    });
  });

  test("execute rejects empty key", async () => {
    await withPopulatedContextRoot(async (root) => {
      const tool = buildFetchCredentialTool(root, cfg(OK))!;
      const result = await tool.execute({ entity: "alice", key: "" });
      expect(result.text).toMatch(/Error: fetch_credential argument "key" rejected/);
    });
  });

  test("execute accepts email-shaped entity", async () => {
    await withPopulatedContextRoot(async (root) => {
      const tool = buildFetchCredentialTool(root, cfg(OK))!;
      const result = await tool.execute({ entity: "alice@example.com", key: "otp" });
      expect(result.text).toBe("ok-for-alice@example.com:otp\n");
    });
  });

  test("success returns redacted transcriptText by default", async () => {
    await withPopulatedContextRoot(async (root) => {
      const tool = buildFetchCredentialTool(root, cfg(OK))!;
      const result = await tool.execute({ entity: "alice", key: "otp" });
      expect(result.text).toBe("ok-for-alice:otp\n");
      // Length matches the stdout returned to the agent.
      expect((result as { transcriptText?: string }).transcriptText).toBe(
        `<credential redacted: entity=alice key=otp len=${"ok-for-alice:otp\n".length}>`,
      );
    });
  });

  test("success omits transcriptText when includeInTranscripts is true", async () => {
    await withPopulatedContextRoot(async (root) => {
      const reveal: CredentialResolverConfig = {
        path: OK,
        timeoutMs: 5_000,
        includeInTranscripts: true,
      };
      const tool = buildFetchCredentialTool(root, reveal)!;
      const result = await tool.execute({ entity: "alice", key: "otp" });
      expect(result.text).toBe("ok-for-alice:otp\n");
      expect((result as { transcriptText?: string }).transcriptText).toBeUndefined();
    });
  });
});
