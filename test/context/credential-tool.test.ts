import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { runResolver } from "../../src/context/credential-tool";
import type { CredentialResolverConfig } from "../../src/config";

const FIXTURES = resolve(__dirname, "../fixtures");
const OK = resolve(FIXTURES, "credential-resolver-ok.sh");
const FAIL = resolve(FIXTURES, "credential-resolver-fail.sh");
const SLOW = resolve(FIXTURES, "credential-resolver-slow.sh");

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
    const empty = resolve(FIXTURES, "credential-resolver-empty.sh");
    const { writeFileSync, chmodSync, unlinkSync } = require("fs");
    writeFileSync(empty, "#!/usr/bin/env bash\nexit 0\n");
    chmodSync(empty, 0o755);
    try {
      const result = await runResolver(cfg(empty), "alice", "otp");
      expect(result.kind).toBe("empty_stdout");
    } finally {
      try { unlinkSync(empty); } catch {}
    }
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
    const overflow = resolve(FIXTURES, "credential-resolver-overflow.sh");
    const { writeFileSync, chmodSync, unlinkSync } = require("fs");
    writeFileSync(
      overflow,
      "#!/usr/bin/env bash\nhead -c 102400 /dev/zero | tr '\\0' 'x'\n",
    );
    chmodSync(overflow, 0o755);
    try {
      const result = await runResolver(cfg(overflow), "alice", "otp");
      expect(result.kind).toBe("stdout_overflow");
    } finally {
      try { unlinkSync(overflow); } catch {}
    }
  });
});
