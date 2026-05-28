import { textResult, type ToolDefinition, type ToolResult } from "../models/provider";
import type { EvidenceLogger } from "../evidence/logger";
import {
  WAKE_IDLE_MS_DEFAULT,
  WAKE_IDLE_MS_MIN,
  WAKE_TIMEOUT_MS_DEFAULT,
  WAKE_TIMEOUT_MS_MAX,
  type WatchManager,
} from "./watch-manager";

const WAKE_ON_IDLE_LOG_DESCRIPTION =
  "Block one inference turn until watched logs have been quiet for " +
  "idle_ms, a new file matches a watched glob, or timeout_ms elapses. " +
  "Prefer this over sleep-based polling when waiting on external work to " +
  "progress or complete. Keep timeout_ms ≤ 240000 (4 minutes) — longer " +
  "waits lose the model context cache.";

export interface WakeOnIdleLogTool {
  definition: ToolDefinition;
  execute(args: Record<string, unknown>, logger: EvidenceLogger): Promise<ToolResult>;
}

interface ParsedArgs {
  idleMs: number;
  timeoutMs: number;
  pollIntervalMs?: number;
}

function parseArgs(args: Record<string, unknown>): ParsedArgs | { error: string } {
  const rawIdle = args.idle_ms;
  const rawTimeout = args.timeout_ms;
  const rawPoll = args.poll_interval_ms;

  let idleMs = WAKE_IDLE_MS_DEFAULT;
  let timeoutMs = WAKE_TIMEOUT_MS_DEFAULT;

  if (rawIdle !== undefined) {
    if (typeof rawIdle !== "number" || !Number.isFinite(rawIdle) || rawIdle <= 0) {
      return { error: "idle_ms must be a positive number" };
    }
    idleMs = rawIdle;
  }
  if (rawTimeout !== undefined) {
    if (typeof rawTimeout !== "number" || !Number.isFinite(rawTimeout) || rawTimeout <= 0) {
      return { error: "timeout_ms must be a positive number" };
    }
    timeoutMs = rawTimeout;
  }

  if (idleMs < WAKE_IDLE_MS_MIN) idleMs = WAKE_IDLE_MS_MIN;
  if (timeoutMs > WAKE_TIMEOUT_MS_MAX) timeoutMs = WAKE_TIMEOUT_MS_MAX;

  let pollIntervalMs: number | undefined;
  if (rawPoll !== undefined) {
    if (typeof rawPoll !== "number" || !Number.isFinite(rawPoll) || rawPoll <= 0) {
      return { error: "poll_interval_ms must be a positive number" };
    }
    pollIntervalMs = rawPoll;
  }

  return { idleMs, timeoutMs, pollIntervalMs };
}

export function buildWakeOnIdleLogTool(opts: {
  manager: WatchManager;
}): WakeOnIdleLogTool {
  const definition: ToolDefinition = {
    name: "wake_on_idle_log",
    description: WAKE_ON_IDLE_LOG_DESCRIPTION,
    maxExecutionMs: WAKE_TIMEOUT_MS_MAX + 10_000,
    parameters: {
      type: "object",
      properties: {
        idle_ms: {
          type: "number",
          description: `No-activity duration that triggers the idle wake. Default ${WAKE_IDLE_MS_DEFAULT}, minimum ${WAKE_IDLE_MS_MIN}.`,
        },
        timeout_ms: {
          type: "number",
          description: `Absolute deadline. Default ${WAKE_TIMEOUT_MS_DEFAULT}, maximum ${WAKE_TIMEOUT_MS_MAX} (cache TTL).`,
        },
        poll_interval_ms: {
          type: "number",
          description: "Override poll interval. For tests only; omit in normal use.",
        },
      },
      required: [],
    },
  };

  const execute = async (
    args: Record<string, unknown>,
    _logger: EvidenceLogger,
  ): Promise<ToolResult> => {
    const parsed = parseArgs(args);
    if ("error" in parsed) {
      return textResult(JSON.stringify({ error: parsed.error }));
    }
    const wake = await opts.manager.waitForWake({
      idleMs: parsed.idleMs,
      timeoutMs: parsed.timeoutMs,
      pollIntervalMs: parsed.pollIntervalMs,
    });
    const payload: Record<string, unknown> = {
      reason: wake.reason,
      last_activity_ms_ago: wake.lastActivityMsAgo,
      applied_idle_ms: parsed.idleMs,
      applied_timeout_ms: parsed.timeoutMs,
      watching: opts.manager.currentGlobs(),
    };
    if (wake.path !== undefined) payload.path = wake.path;
    return textResult(JSON.stringify(payload));
  };

  return { definition, execute };
}
