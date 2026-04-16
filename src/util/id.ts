/**
 * Short opaque run id: Unix-ms + 4 random alphanumerics.
 *
 * Used by the CLI/API entry points to tag per-run Chrome profile
 * directories (see spec §5.1). The shape is deliberately filesystem-safe
 * (lowercase alphanumerics, no separators beyond the inner hyphen) so it
 * composes into `gauntlet-run-<runId>-<cardId>` without further cleanup.
 */
export function makeRunId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6).padEnd(4, "0");
  return `${ts}${rand}`;
}

/**
 * Sanitize an arbitrary string for use as (part of) a Chrome profile
 * name. `chrome-ws-lib.setProfileName` enforces
 * `/^[a-zA-Z0-9_-]+$/`; replace anything outside that set with `-`.
 */
export function sanitizeProfileSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "-");
}
