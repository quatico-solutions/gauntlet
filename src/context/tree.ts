import { readdirSync, statSync } from "fs";
import { join } from "path";

// Compact tree renderer for the system prompt's Context section.
// Format is authoritative prose from Gauntlet v1.5 spec §4.3:
//
//   1. Depth-first, alphabetical (case-insensitive). Directories first.
//   2. Two spaces of indent per depth level.
//   3. Files:       `name  (N bytes)`
//      Directories: `name/`
//   4. Hidden entries (name starts with `.`) are skipped.
//   5. Budget: 64 KB total and 400 entries total, whichever comes first.
//      On overflow, truncate depth-first and append:
//      `... (truncated: N more entries not shown — this run cannot see them)`
//
// Immutability invariant (spec §4.2): the tree is built **once per run,
// at turn 0**, baked into the system prompt, and never rebuilt. This
// function is pure (filesystem at call time only) and callers must not
// invoke it more than once per run. See src/cli/run.ts and
// src/api/routes/run.ts for the single call sites.

export interface RenderContextTreeOptions {
  /** Byte budget for the rendered tree. Defaults to 64 KB. */
  maxBytes?: number;
  /** Maximum number of rendered entries. Defaults to 400. */
  maxEntries?: number;
}

const DEFAULT_MAX_BYTES = 64 * 1024;
const DEFAULT_MAX_ENTRIES = 400;

interface DirEntryInfo {
  name: string;
  isDirectory: boolean;
  size: number;
}

function listVisibleEntries(dir: string): DirEntryInfo[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const entries: DirEntryInfo[] = [];
  for (const name of names) {
    if (name.startsWith(".")) continue;
    let stat;
    try {
      stat = statSync(join(dir, name));
    } catch {
      continue;
    }
    entries.push({
      name,
      isDirectory: stat.isDirectory(),
      size: stat.isFile() ? stat.size : 0,
    });
  }
  // Directories first, then alphabetical case-insensitive within each group.
  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
  return entries;
}

/**
 * Returns a rendered tree suitable for embedding in the system prompt's
 * Context section. Returns an empty string when the root is absent,
 * inaccessible, or contains no visible entries.
 */
export function renderContextTree(
  contextRoot: string,
  options?: RenderContextTreeOptions,
): string {
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES;

  // Verify the root exists and is a directory. If not, return "".
  try {
    const stat = statSync(contextRoot);
    if (!stat.isDirectory()) return "";
  } catch {
    return "";
  }

  const lines: string[] = [];
  let bytesUsed = 0;
  let entriesUsed = 0;
  let remaining = 0;
  let truncated = false;

  // Depth-first walk with two budgets enforced inline. When either
  // budget is exceeded, we stop emitting lines but keep walking to count
  // the number of entries that would have been shown (`remaining`), so
  // the truncation line can name an exact number.
  const walk = (dir: string, depth: number): void => {
    const entries = listVisibleEntries(dir);
    for (const entry of entries) {
      const indent = "  ".repeat(depth + 1);
      const line = entry.isDirectory
        ? `${indent}${entry.name}/`
        : `${indent}${entry.name}  (${entry.size} bytes)`;

      if (truncated) {
        // Already over budget — count the rest and do not emit.
        remaining++;
      } else {
        // +1 for the newline that will separate this line from the next.
        const candidateBytes = bytesUsed + line.length + 1;
        if (
          entriesUsed + 1 > maxEntries ||
          candidateBytes > maxBytes
        ) {
          truncated = true;
          remaining++;
        } else {
          lines.push(line);
          bytesUsed = candidateBytes;
          entriesUsed++;
        }
      }

      if (entry.isDirectory) {
        walk(join(dir, entry.name), depth + 1);
      }
    }
  };

  walk(contextRoot, 0);

  if (lines.length === 0 && !truncated) return "";

  if (truncated) {
    lines.push(
      `... (truncated: ${remaining} more entries not shown — this run cannot see them)`,
    );
  }

  return lines.join("\n");
}
