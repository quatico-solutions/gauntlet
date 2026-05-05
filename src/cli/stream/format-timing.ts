/**
 * Display rules for tool_result timings in the streaming CLI output.
 *
 * Most tool calls are sub-10 ms — surfacing those numbers is pure
 * noise. Reserving the timing column for values that actually carry
 * signal (slow calls, errors) makes the real outliers easier to spot.
 *
 * Rules:
 *   - error path: always render the duration with full precision so
 *     the reader sees how long a failure took (e.g. a 30 s timeout)
 *   - success < 50 ms: suppress entirely
 *   - success 50 – 999 ms: render as `Nms`
 *   - success ≥ 1 s: render as `1.2s`, in the warn column
 *
 * Returns a `null` when the timing should be omitted from the line —
 * the caller decides whether to elide its decoration as well.
 */

export interface TimingDisplay {
  text: string;
  /** Whether the timing is "slow" — caller may color it differently. */
  slow: boolean;
}

/**
 * Threshold under which a successful tool call's duration is hidden.
 * Calibrated against typical web/CLI adapter timings (most fall in
 * the 0 – 30 ms band) — anything below this threshold is dominated by
 * IPC and tool-dispatch overhead, not the operation itself.
 */
const HIDE_BELOW_MS = 50;

/**
 * Threshold above which a successful timing is rendered in seconds and
 * marked slow, so the reader's eye lands on it.
 */
const SLOW_AT_MS = 1000;

export function formatTiming(durationMs: number, isError: boolean): TimingDisplay | null {
  const ms = Math.max(0, Math.round(durationMs));
  if (isError) {
    return { text: ms >= SLOW_AT_MS ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`, slow: true };
  }
  if (ms < HIDE_BELOW_MS) return null;
  if (ms >= SLOW_AT_MS) return { text: `${(ms / 1000).toFixed(1)}s`, slow: true };
  return { text: `${ms}ms`, slow: false };
}
