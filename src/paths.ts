// The one and only path-safety guard for Gauntlet. All containment checks go through this.

import { isAbsolute, join, resolve as resolvePath, sep } from "path";
import { realpathSync } from "fs";

export const GAUNTLET_DIRNAME = ".gauntlet";

/**
 * Compose a path under the project's `.gauntlet/` state directory.
 * Centralizes the `.gauntlet/` convention so no call site hardcodes it.
 *
 *   gauntletPath(root, "stories")              → <root>/.gauntlet/stories
 *   gauntletPath(root, "results", runId)       → <root>/.gauntlet/results/<runId>
 *   gauntletPath(root, "context", user, "foo") → <root>/.gauntlet/context/<user>/foo
 */
export function gauntletPath(projectRoot: string, ...sub: string[]): string {
  return join(projectRoot, GAUNTLET_DIRNAME, ...sub);
}

// Canonicalize a path to its realpath if it exists; otherwise walk up
// to the nearest existing ancestor, realpath *that*, and re-append the
// missing tail. This gives us symlink-aware containment where the
// target exists on disk, while still producing a canonical absolute
// form for callers that validate paths before the leaf is created —
// route handlers routinely validate a runId before the run directory
// exists, and on macOS the tmpdir() path is itself a symlink
// (`/var` → `/private/var`), so a naive `realpathSync` on the base
// plus a `resolvePath` on a non-existent target would produce
// incomparable strings.
function canonicalize(p: string): string {
  const resolved = resolvePath(p);
  const segments: string[] = [];
  let current = resolved;
  // Walk up until we find an ancestor that exists (realpathSync succeeds)
  // or until we exhaust the path.
  while (true) {
    try {
      const real = realpathSync(current);
      return segments.length === 0 ? real : join(real, ...segments);
    } catch {
      const parent = resolvePath(current, "..");
      if (parent === current) {
        // Reached the filesystem root and still no existing ancestor;
        // return the lexically-resolved form.
        return resolved;
      }
      // Prepend the trailing segment we just stripped.
      segments.unshift(current.slice(parent === sep ? parent.length : parent.length + 1));
      current = parent;
    }
  }
}

/**
 * Returns true iff `target` (after canonicalization) is contained in `base`.
 * Both arguments are treated as already-absolute-or-resolvable paths — no
 * `..` reasoning, no relative-path composition. Use `resolveInside` when
 * you need to compose a user-supplied relative path against a root and
 * enforce containment in one step.
 *
 * Canonicalizes via `realpathSync` when the path exists, so a symlink
 * *inside* `base` that points outside is correctly rejected. When the
 * path does not exist, falls back to `path.resolve` — this means a
 * validation-before-existence caller (e.g., a route validating a runId
 * before a directory is created) still gets a meaningful answer.
 *
 * Known limitation: if `base` does not exist and lies under a symlink
 * whose target differs from the lexical path, the containment check
 * operates on the lexical form. In practice, every caller in this
 * codebase passes a base that exists (resultsDir, storiesDir, uiDir,
 * contextRoot), so this degenerate case is not reachable.
 */
export function isSafePath(base: string, target: string): boolean {
  if (typeof base !== "string" || typeof target !== "string") return false;
  if (base.length === 0 || target.length === 0) return false;
  const rb = canonicalize(base);
  const rt = canonicalize(target);
  return rt === rb || rt.startsWith(rb + sep);
}

/**
 * Compose `rel` against `root` and enforce containment. Behavior matches
 * Gauntlet v1.5 spec §3.1:
 *
 * - reject non-string or empty `rel`
 * - reject absolute `rel`
 * - reject `..` segments anywhere in `rel` (split on both `/` and `\`)
 * - resolve `rel` against `root` and verify the result lives under `root`
 *   via `isSafePath`
 *
 * Returns the resolved absolute path on success; throws on failure.
 * The caller is responsible for converting the throw into a
 * tool-result error.
 */
export function resolveInside(root: string, rel: string): string {
  if (typeof rel !== "string" || rel.length === 0) {
    throw new Error("path must be a non-empty string");
  }
  if (isAbsolute(rel)) {
    throw new Error(`path "${rel}" must be relative to the context root`);
  }
  // Reject `..` anywhere in the input. Split on both `/` and `\` so
  // Windows-style separators don't slip past a POSIX-only splitter.
  const segments = rel.split(/[\\/]/);
  for (const segment of segments) {
    if (segment === "..") {
      throw new Error(`path "${rel}" must not contain ".." segments`);
    }
  }
  const rootAbs = resolvePath(root);
  const resolved = resolvePath(rootAbs, rel);
  if (!isSafePath(rootAbs, resolved)) {
    throw new Error(`path "${rel}" escapes the context root`);
  }
  return resolved;
}
