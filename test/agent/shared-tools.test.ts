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
    const bundle = buildSharedTools({ contextRoot: populatedContextRoot(), cwd: emptyContextRoot() });
    const names = bundle.definitions().map((d) => d.name);
    expect(names).toContain("read");
    expect(bundle.canExecute("read")).toBe(true);
  });

  test("does not mount read when context root empty", () => {
    const bundle = buildSharedTools({ contextRoot: emptyContextRoot(), cwd: emptyContextRoot() });
    expect(bundle.definitions().map((d) => d.name)).not.toContain("read");
  });

  test("does not mount read when no context root provided", () => {
    const bundle = buildSharedTools({ cwd: emptyContextRoot() });
    expect(bundle.canExecute("read")).toBe(false);
  });

  test("always mounts bash regardless of context", () => {
    const bundle = buildSharedTools({ cwd: emptyContextRoot() });
    const names = bundle.definitions().map((d) => d.name);
    expect(names).toContain("bash");
    expect(bundle.canExecute("bash")).toBe(true);
  });

  test("dispatches bash to the underlying tool", async () => {
    const bundle = buildSharedTools({ cwd: emptyContextRoot() });
    const result = await bundle.execute(
      "bash",
      { command: "echo from-bundle" },
      { logEvent: () => {} } as any,
    );
    expect((result as { text: string }).text).toContain("from-bundle");
  });
});
