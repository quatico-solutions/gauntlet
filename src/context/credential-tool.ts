// We use `child_process` directly here rather than `src/runtime/spawn.ts`
// because the credential resolver needs a SIGTERM → grace → SIGKILL
// timeout cascade, and the existing seam's `kill()` doesn't take a
// signal. Every other caller in the codebase is fine with the seam;
// this module is the deliberate exception.
import { spawn } from "child_process";
import type { CredentialResolverConfig } from "../config";

export type ResolverResult =
  | { kind: "ok"; stdout: string; stderr: string; exitCode: 0; elapsedMs: number }
  | { kind: "nonzero_exit"; stdout: string; stderr: string; exitCode: number; elapsedMs: number }
  | { kind: "empty_stdout"; stderr: string; exitCode: 0; elapsedMs: number }
  | { kind: "timeout"; stderr: string; timeoutMs: number; elapsedMs: number }
  | { kind: "spawn_failed"; error: string }
  | { kind: "stdout_overflow"; elapsedMs: number }
  | { kind: "stderr_overflow"; elapsedMs: number };

const STDOUT_CAP_BYTES = 64 * 1024;
const STDERR_CAP_BYTES = 8 * 1024;
const KILL_GRACE_MS = 2_000;

export async function runResolver(
  config: CredentialResolverConfig,
  entity: string,
  key: string,
): Promise<ResolverResult> {
  const start = Date.now();
  let child;
  try {
    child = spawn(config.path, [entity, key], {
      detached: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    return { kind: "spawn_failed", error: (err as Error).message };
  }

  return new Promise<ResolverResult>((resolveOutcome) => {
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutOverflow = false;
    let stderrOverflow = false;
    let timedOut = false;
    let settled = false;

    const settle = (result: ResolverResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      clearTimeout(killHandle);
      resolveOutcome(result);
    };

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGTERM"); } catch {}
    }, config.timeoutMs);

    const killHandle = setTimeout(() => {
      if (!settled) {
        try { child.kill("SIGKILL"); } catch {}
      }
    }, config.timeoutMs + KILL_GRACE_MS);

    child.stdout!.on("data", (chunk: Buffer) => {
      if (stdoutOverflow) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > STDOUT_CAP_BYTES) {
        stdoutOverflow = true;
        try { child.kill("SIGKILL"); } catch {}
        settle({ kind: "stdout_overflow", elapsedMs: Date.now() - start });
        return;
      }
      stdoutChunks.push(chunk);
    });

    child.stderr!.on("data", (chunk: Buffer) => {
      if (stderrOverflow) return;
      stderrBytes += chunk.length;
      if (stderrBytes > STDERR_CAP_BYTES) {
        stderrOverflow = true;
        try { child.kill("SIGKILL"); } catch {}
        settle({ kind: "stderr_overflow", elapsedMs: Date.now() - start });
        return;
      }
      stderrChunks.push(chunk);
    });

    child.on("error", (err) => {
      settle({ kind: "spawn_failed", error: err.message });
    });

    child.on("exit", (code) => {
      if (settled) return;
      const elapsedMs = Date.now() - start;
      const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
      const stderr = Buffer.concat(stderrChunks).toString("utf-8");
      if (timedOut) {
        settle({ kind: "timeout", stderr, timeoutMs: config.timeoutMs, elapsedMs });
        return;
      }
      if (code !== 0) {
        settle({ kind: "nonzero_exit", stdout, stderr, exitCode: code ?? -1, elapsedMs });
        return;
      }
      if (stdout.length === 0) {
        settle({ kind: "empty_stdout", stderr, exitCode: 0, elapsedMs });
        return;
      }
      settle({ kind: "ok", stdout, stderr, exitCode: 0, elapsedMs });
    });
  });
}
