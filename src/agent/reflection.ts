// Reflection checkpoint helpers: render a literal trace of recent
// mutating tool calls and wrap it in a <SYSTEM-REMINDER> block to be
// injected as a user-message text block at periodic checkpoints. The
// trace is the persuasive material; the reminder framing is the
// give-up permission slip. See docs/reflection-checkpoints-spec.md.

export const MAX_TRACE_ENTRIES = 8;
export const MAX_ARG_VALUE_LEN = 120;

export interface ReflectableToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

function renderValue(value: unknown): string {
  if (typeof value === "string") {
    const truncated = value.length > MAX_ARG_VALUE_LEN
      ? value.slice(0, MAX_ARG_VALUE_LEN) + "…"
      : value;
    return JSON.stringify(truncated);
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  // Arrays and objects: render compactly. Truncate the whole JSON blob
  // on length so a giant array doesn't blow out the trace.
  let rendered: string;
  try {
    rendered = JSON.stringify(value);
  } catch {
    rendered = "<unserializable>";
  }
  if (rendered.length > MAX_ARG_VALUE_LEN) {
    rendered = rendered.slice(0, MAX_ARG_VALUE_LEN) + "…";
  }
  return rendered;
}

export function formatToolCall(call: ReflectableToolCall): string {
  const entries = Object.entries(call.arguments);
  if (entries.length === 0) return `${call.name}()`;
  const parts = entries.map(([k, v]) => `${k}=${renderValue(v)}`);
  return `${call.name}(${parts.join(", ")})`;
}

export function renderTrace(calls: ReflectableToolCall[]): string {
  if (calls.length === 0) return "  (no state-changing actions taken yet)";
  const window = calls.slice(-MAX_TRACE_ENTRIES);
  return window
    .map((c, i) => `  ${i + 1}. ${formatToolCall(c)}`)
    .join("\n");
}

// Single reminder text used at every checkpoint. The text is intentionally
// constant across firings — the embedded {TRACE} is the only variable —
// so the agent's own action history is what does the persuading rather
// than tonal escalation. See spec §"Reminder text" for rationale.
export function buildReflectionReminder(traceText: string): string {
  return (
    `<SYSTEM-REMINDER>\n` +
    `Reflection checkpoint.\n` +
    `\n` +
    `Here are the actions you've taken that changed application state:\n` +
    `\n` +
    `${traceText}\n` +
    `\n` +
    `Look at that list. Are you converging on the goal, or circling it?\n` +
    `\n` +
    `Not all stories can be accomplished. Stories can be wrong. Fixtures ` +
    `can be wrong. Systems can be wrong. If the most likely explanation ` +
    `for what you're seeing is that the target is broken rather than that ` +
    `you haven't found the right incantation, call report_result with ` +
    `status=investigate and say so.\n` +
    `\n` +
    `A clear "stuck on X" report — naming what you tried, what you ` +
    `observed, and your best guess about what's wrong (target, fixture, ` +
    `story, or your own approach) — is more valuable than burning budget ` +
    `on more variations.\n` +
    `</SYSTEM-REMINDER>`
  );
}
