import { describe, test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildSharedTools } from "../../src/agent/shared-tools";

function emptyContextRoot(): string {
  return mkdtempSync(join(tmpdir(), "gauntlet-shared-ctx-"));
}

function populatedContextRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "gauntlet-shared-ctx-"));
  mkdirSync(join(root, "users"), { recursive: true });
  writeFileSync(join(root, "users", "alice.md"), "# Alice");
  return root;
}

describe("buildSharedTools", () => {
  test("mounts read when context root populated", () => {
    const bundle = buildSharedTools({ contextRoot: populatedContextRoot() });
    const names = bundle.definitions().map((d) => d.name);
    expect(names).toContain("read");
    expect(bundle.canExecute("read")).toBe(true);
  });

  test("does not mount read when context root empty", () => {
    const bundle = buildSharedTools({ contextRoot: emptyContextRoot() });
    expect(bundle.definitions().map((d) => d.name)).not.toContain("read");
  });

  test("does not mount read when no context root provided", () => {
    const bundle = buildSharedTools({});
    expect(bundle.canExecute("read")).toBe(false);
  });
});
