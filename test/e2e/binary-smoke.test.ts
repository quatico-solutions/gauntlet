import { describe, test, expect } from "bun:test";
import { spawnSync } from "child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const REPO_ROOT = join(import.meta.dir, "..", "..");

// This test compiles a real binary and runs it from a foreign cwd. It catches
// asset-bundling regressions (e.g., import.meta.dir vs. text-imports for the
// .md prompt files) that bun run alone cannot. ~1s warm, ~5s cold — cheap
// enough to be ungated. If CI ever has a reason to skip, gate it there.
describe("compiled binary --show-prompt-and-exit", () => {
  test("works from a directory outside the build tree", () => {
    const buildDir = mkdtempSync(join(tmpdir(), "gauntlet-bin-build-"));
    const runDir = mkdtempSync(join(tmpdir(), "gauntlet-bin-run-"));
    try {
      const binPath = join(buildDir, "gauntlet");
      const compile = spawnSync("bun", ["build", "--compile", "./src/index.ts", "--outfile", binPath], {
        cwd: REPO_ROOT,
        encoding: "utf-8",
      });
      expect(compile.status).toBe(0);
      expect(existsSync(binPath)).toBe(true);

      // Set up a fresh project in runDir
      mkdirSync(join(runDir, ".gauntlet", "context"), { recursive: true });
      writeFileSync(join(runDir, ".gauntlet", "context", "x.md"), "x", "utf-8");
      const cardPath = join(runDir, "card.md");
      writeFileSync(cardPath, "---\nid: bs-001\ntitle: Smoke\n---\n\n## Acceptance Criteria\n- ok\n", "utf-8");

      const r = spawnSync(binPath, [
        "run", cardPath,
        "--target", "http://x",
        "--project-dir", runDir,
        "--show-prompt-and-exit",
      ], { cwd: runDir, encoding: "utf-8" });

      expect(r.status).toBe(0);
      expect(r.stdout).toContain("You are an auditor");  // Persona body
      expect(r.stdout).toContain("Side trips for sign-in flows");  // Adapter web body
    } finally {
      rmSync(buildDir, { recursive: true, force: true });
      rmSync(runDir, { recursive: true, force: true });
    }
  }, 120_000);  // compilation can take ~30s on cold cache
});
