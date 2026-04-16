import { isAbsolute, resolve as resolvePath, sep } from "path";

// Shared path guard used by `read` (src/context/read-tool.ts) and
// `install_passkey` (src/adapters/web/passkey.ts). Behavior matches
// Gauntlet v1.5 spec §3.1 verbatim:
//
// - reject `..` segments in the input
// - reject absolute paths
// - resolve the path against `root` using Node's `path.resolve`
// - reject any result whose absolute form does not live under `root`
//
// Returns the resolved absolute path on success. Throws on failure.
// The caller is responsible for converting the throw into a
// tool-result error.
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
  if (resolved !== rootAbs && !resolved.startsWith(rootAbs + sep)) {
    throw new Error(`path "${rel}" escapes the context root`);
  }
  return resolved;
}
