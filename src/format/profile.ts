// Profile reader — deprecated, scheduled for Phase 3 deletion (see
// docs/plans/2026-04-15-gauntlet-v1.5-spec.md §10). Passkey parsing
// has moved to src/adapters/web/passkey.ts as of Phase 1 (WP1.5);
// `listProfiles` / `readProfile` remain in this module until Phase 3
// closes out the v1 profiles surface.

import { readdirSync, readFileSync, statSync } from "fs";
import { join, resolve as resolvePath } from "path";

export function listProfiles(dir: string): string[] {
  try {
    const stat = statSync(dir);
    if (!stat.isDirectory()) return [];
  } catch {
    return [];
  }

  return readdirSync(dir)
    .filter((entry) => entry.endsWith(".md") && !entry.startsWith("."))
    .map((entry) => entry.slice(0, -3))
    .filter((name) => name.length > 0)
    .sort();
}

export function readProfile(dir: string, name: string): string {
  if (!name || name.includes("/") || name.includes("\\") || name.startsWith(".")) {
    throw new Error(`profile "${name}" not found`);
  }
  const filePath = join(dir, `${name}.md`);
  const dirAbs = resolvePath(dir);
  const fileAbs = resolvePath(filePath);
  if (fileAbs !== dirAbs && !fileAbs.startsWith(dirAbs + "/")) {
    throw new Error(`profile "${name}" not found`);
  }
  return readFileSync(filePath, "utf-8");
}
