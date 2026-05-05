/**
 * Per-tool-family pretty-printer for tool call arguments.
 *
 * Default rendering passes raw `JSON.stringify(args)`, which is wide,
 * escape-laden, and hard to scan — especially for selectors with quotes
 * (`{"selector":"input[value=\"friends\"]","return_screenshot":true}`).
 *
 * This module returns a {body, marker} pair per tool. The body replaces
 * the JSON args; the marker is a small glyph appended after the call
 * (e.g. 📷 for tools that return a screenshot). Unknown tools fall back
 * to the raw JSON form so the renderer never loses information.
 *
 * Each humanizer is intentionally narrow — it inspects only the keys it
 * knows about and treats unexpected inputs as "unknown", returning the
 * fallback. That keeps the surface predictable as the tool catalogue
 * grows.
 */

export interface FormattedArgs {
  /** Inline body, e.g. `profiles/fred/profile.md` or `textarea ← "hello"`. */
  body: string;
  /** Trailing marker glyph (e.g. `📷` for screenshot-returning calls). */
  marker?: string;
}

interface StringRecord {
  [key: string]: unknown;
}

function asString(args: StringRecord, key: string): string | null {
  const v = args[key];
  return typeof v === "string" ? v : null;
}

function asBool(args: StringRecord, key: string): boolean {
  return args[key] === true;
}

/**
 * Truncate a long inline value (a typed string, a URL) so a single
 * call line stays readable. The cap is generous because the call
 * header still has its own column budget; we only chop at extreme
 * lengths.
 */
function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(8, max - 1)) + "…";
}

function jsonFallback(args: StringRecord): FormattedArgs {
  const body = JSON.stringify(args);
  return { body: body === "{}" ? "" : body };
}

/**
 * `read` — context file read. Body is the path; nothing else.
 */
function formatRead(args: StringRecord): FormattedArgs {
  const path = asString(args, "path");
  if (!path) return jsonFallback(args);
  return { body: path };
}

/**
 * `read_output` — CLI/TUI buffer drain. No args; produce empty body.
 */
function formatReadOutput(args: StringRecord): FormattedArgs {
  if (Object.keys(args).length === 0) return { body: "" };
  return jsonFallback(args);
}

/**
 * `type`. CLI shape: { text }. Web shape: { selector, text } (and
 * optionally return_screenshot). Render as `text "..."` or
 * `<selector> ← "..."`.
 */
function formatType(args: StringRecord): FormattedArgs {
  const text = asString(args, "text");
  const selector = asString(args, "selector");
  if (text === null) return jsonFallback(args);
  const clipped = clip(text, 80);
  const body = selector
    ? `${selector} ← "${clipped}"`
    : `"${clipped}"`;
  const marker = asBool(args, "return_screenshot") ? "📷" : undefined;
  return { body, marker };
}

/**
 * `press` — single keystroke. The `key` is the entire body, no quoting.
 */
function formatPress(args: StringRecord): FormattedArgs {
  const key = asString(args, "key");
  if (!key) return jsonFallback(args);
  return { body: key };
}

/**
 * `click` — selector-driven. Optional return_screenshot marker.
 */
function formatClick(args: StringRecord): FormattedArgs {
  const selector = asString(args, "selector");
  if (!selector) return jsonFallback(args);
  const marker = asBool(args, "return_screenshot") ? "📷" : undefined;
  return { body: selector, marker };
}

/**
 * `navigate` — body is the URL, marker for screenshot.
 */
function formatNavigate(args: StringRecord): FormattedArgs {
  const url = asString(args, "url");
  if (!url) return jsonFallback(args);
  const marker = asBool(args, "return_screenshot") ? "📷" : undefined;
  return { body: clip(url, 80), marker };
}

/**
 * `install_cookies` / `install_storage` — body is the path.
 */
function formatPathOnly(args: StringRecord): FormattedArgs {
  const path = asString(args, "path");
  if (!path) return jsonFallback(args);
  return { body: path };
}

/**
 * `screenshot` — no args, but emit a marker so the call line still
 * advertises that an image is coming.
 */
function formatScreenshot(args: StringRecord): FormattedArgs {
  if (Object.keys(args).length === 0) return { body: "", marker: "📷" };
  return jsonFallback(args);
}

/**
 * `wait_for` / `wait_for_selector` — selector- or text-driven wait.
 */
function formatWaitFor(args: StringRecord): FormattedArgs {
  const selector = asString(args, "selector");
  const text = asString(args, "text");
  if (selector) return { body: selector };
  if (text) return { body: `"${clip(text, 80)}"` };
  return jsonFallback(args);
}

const HUMANIZERS: Record<string, (args: StringRecord) => FormattedArgs> = {
  read: formatRead,
  read_output: formatReadOutput,
  read_screen: formatScreenshot, // no args; emit a marker
  type: formatType,
  press: formatPress,
  click: formatClick,
  navigate: formatNavigate,
  screenshot: formatScreenshot,
  wait_for: formatWaitFor,
  wait_for_selector: formatWaitFor,
  install_cookies: formatPathOnly,
  install_storage: formatPathOnly,
};

/**
 * Format the arguments of a tool call. Falls back to a JSON dump
 * (truncated by the caller) for unknown tool names or unrecognised
 * argument shapes — we never want to silently elide information.
 */
export function formatToolArgs(
  toolName: string,
  args: Record<string, unknown> | undefined,
): FormattedArgs {
  const fn = HUMANIZERS[toolName];
  const safe = (args ?? {}) as StringRecord;
  if (!fn) return jsonFallback(safe);
  return fn(safe);
}
