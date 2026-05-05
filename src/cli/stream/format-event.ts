/**
 * Compact renderer for `event` (anomaly) lines in the streaming output.
 *
 * Today the renderer dumps every event as `name k=v k=v …`. That
 * collapses for events with simple scalar fields, but for events that
 * carry structured payloads (e.g. `install_cookies_ok` with a
 * `cookies=[…]` array of objects) the line blows past terminal width
 * and is unreadable.
 *
 * Per-event-family compact summarisers below produce a tight one-line
 * synopsis. Events without a registered summariser fall back to a
 * scalar-only k=v rendering — list and object values are summarised as
 * `[N items]` / `{N keys}` so the line stays bounded.
 */

interface EventFields {
  // Reserved keys already excluded by the caller (eventId, type, ts, etc.)
  [key: string]: unknown;
}

export interface FormattedEvent {
  /** The event's name, unchanged. */
  name: string;
  /** Body string ready to print after the name. May be empty. */
  body: string;
}

function compactValue(v: unknown): string {
  if (v === null || v === undefined) return String(v);
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `[${v.length} item${v.length === 1 ? "" : "s"}]`;
  if (typeof v === "object") return `{${Object.keys(v).length} keys}`;
  return String(v);
}

function formatInstallCookiesOk(fields: EventFields): string {
  const accepted = fields.accepted;
  const rejected = fields.rejected;
  const cookies = Array.isArray(fields.cookies) ? fields.cookies : [];
  const names = cookies
    .map((c) => (typeof c === "object" && c && "name" in c ? String((c as Record<string, unknown>).name) : null))
    .filter((n): n is string => !!n);
  const namesStr = names.length > 0 ? names.join(", ") : "—";
  return `accepted ${accepted ?? 0} · rejected ${rejected ?? 0} · ${namesStr}`;
}

function formatToolResultTextOversize(fields: EventFields): string {
  const tool = fields.toolName ?? "?";
  const bytes = fields.bytes ?? 0;
  const artifact = fields.artifact ?? "?";
  const kb = typeof bytes === "number" ? `${(bytes / 1024).toFixed(1)}kB` : String(bytes);
  return `${tool} · ${kb} · ${artifact}`;
}

const SUMMARIZERS: Record<string, (f: EventFields) => string> = {
  install_cookies_ok: formatInstallCookiesOk,
  tool_result_text_oversize: formatToolResultTextOversize,
};

/**
 * Pull the event's payload (everything except the envelope keys) and
 * return a compact body string. The caller owns the leading `· name `
 * prefix and any color decoration.
 */
export function formatAnomalyEvent(event: Record<string, unknown>): FormattedEvent {
  const name = String(event.name ?? "event");
  const fields: EventFields = {};
  for (const [k, v] of Object.entries(event)) {
    if (k === "type" || k === "name" || k === "eventId" || k === "parentEventId" || k === "ts") continue;
    if (v === undefined || v === null) continue;
    fields[k] = v;
  }

  const summariser = SUMMARIZERS[name];
  if (summariser) {
    return { name, body: summariser(fields) };
  }

  // Fallback: scalar-only k=v line. List/object values are abbreviated
  // so the line stays one terminal-width-friendly chunk.
  const parts = Object.entries(fields).map(([k, v]) => `${k}=${compactValue(v)}`);
  return { name, body: parts.join(" ") };
}
