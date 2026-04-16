import { describe, test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { renderContextTree } from "../../src/context/tree";

describe("renderContextTree", () => {
  test("returns empty string when root does not exist", () => {
    expect(renderContextTree("/nonexistent/path/does/not/exist")).toBe("");
  });

  test("returns empty string when root is a file, not a dir", () => {
    const tmp = mkdtempSync(join(tmpdir(), "gauntlet-tree-"));
    try {
      const f = join(tmp, "foo");
      writeFileSync(f, "x");
      expect(renderContextTree(f)).toBe("");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("returns empty string when root is empty", () => {
    const tmp = mkdtempSync(join(tmpdir(), "gauntlet-tree-"));
    try {
      expect(renderContextTree(tmp)).toBe("");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("renders a single file", () => {
    const tmp = mkdtempSync(join(tmpdir(), "gauntlet-tree-"));
    try {
      writeFileSync(join(tmp, "alice.md"), "hello");
      const tree = renderContextTree(tmp);
      expect(tree).toBe("  alice.md  (5 bytes)");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("renders the anchor Alice-and-Bob layout from spec §4.3", () => {
    const tmp = mkdtempSync(join(tmpdir(), "gauntlet-tree-"));
    try {
      mkdirSync(join(tmp, "alice"));
      mkdirSync(join(tmp, "bob"));
      // Byte counts chosen to match the spec's example rendering.
      writeFileSync(join(tmp, "alice", "credentials.md"), "x".repeat(52));
      writeFileSync(join(tmp, "alice", "identity.md"), "x".repeat(188));
      writeFileSync(join(tmp, "alice", "passkey.json"), "x".repeat(312));
      writeFileSync(join(tmp, "bob", "credentials.md"), "x".repeat(52));
      writeFileSync(join(tmp, "bob", "identity.md"), "x".repeat(74));

      const tree = renderContextTree(tmp);
      const expected = [
        "  alice/",
        "    credentials.md  (52 bytes)",
        "    identity.md  (188 bytes)",
        "    passkey.json  (312 bytes)",
        "  bob/",
        "    credentials.md  (52 bytes)",
        "    identity.md  (74 bytes)",
      ].join("\n");
      expect(tree).toBe(expected);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("directories come before files at each level", () => {
    const tmp = mkdtempSync(join(tmpdir(), "gauntlet-tree-"));
    try {
      writeFileSync(join(tmp, "aaa.md"), "x");
      mkdirSync(join(tmp, "zzz"));
      writeFileSync(join(tmp, "zzz", "inner.md"), "x");
      const tree = renderContextTree(tmp);
      const lines = tree.split("\n");
      expect(lines[0]).toBe("  zzz/");
      expect(lines[1]).toBe("    inner.md  (1 bytes)");
      expect(lines[2]).toBe("  aaa.md  (1 bytes)");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("alphabetical ordering is case-insensitive", () => {
    const tmp = mkdtempSync(join(tmpdir(), "gauntlet-tree-"));
    try {
      writeFileSync(join(tmp, "BOB.md"), "x");
      writeFileSync(join(tmp, "alice.md"), "x");
      writeFileSync(join(tmp, "Carol.md"), "x");
      const tree = renderContextTree(tmp);
      const lines = tree.split("\n").map((line) => line.trim().split(" ")[0]);
      expect(lines).toEqual(["alice.md", "BOB.md", "Carol.md"]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("hidden entries (starting with dot) are skipped", () => {
    const tmp = mkdtempSync(join(tmpdir(), "gauntlet-tree-"));
    try {
      writeFileSync(join(tmp, "alice.md"), "x");
      writeFileSync(join(tmp, ".hidden"), "x");
      mkdirSync(join(tmp, ".git"));
      writeFileSync(join(tmp, ".git", "HEAD"), "x");
      const tree = renderContextTree(tmp);
      expect(tree).toBe("  alice.md  (1 bytes)");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("indentation is two spaces per depth level", () => {
    const tmp = mkdtempSync(join(tmpdir(), "gauntlet-tree-"));
    try {
      mkdirSync(join(tmp, "a", "b", "c"), { recursive: true });
      writeFileSync(join(tmp, "a", "b", "c", "deep.md"), "x");
      const tree = renderContextTree(tmp);
      const lines = tree.split("\n");
      expect(lines[0]).toBe("  a/");
      expect(lines[1]).toBe("    b/");
      expect(lines[2]).toBe("      c/");
      expect(lines[3]).toBe("        deep.md  (1 bytes)");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("entries-budget truncation emits the truncation line with the spec wording", () => {
    const tmp = mkdtempSync(join(tmpdir(), "gauntlet-tree-"));
    try {
      for (let i = 0; i < 10; i++) {
        writeFileSync(join(tmp, `file-${i}.md`), "x");
      }
      const tree = renderContextTree(tmp, { maxEntries: 3 });
      const lines = tree.split("\n");
      // 3 rendered entries + 1 truncation line.
      expect(lines.length).toBe(4);
      expect(lines[3]).toBe(
        "... (truncated: 7 more entries not shown — this run cannot see them)",
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("byte-budget truncation fires before entry budget when smaller", () => {
    const tmp = mkdtempSync(join(tmpdir(), "gauntlet-tree-"));
    try {
      for (let i = 0; i < 10; i++) {
        writeFileSync(join(tmp, `file-${i}.md`), "x");
      }
      // Each line is roughly "  file-N.md  (1 bytes)" ~= 24 chars; use a
      // tiny budget so we overflow after 2 lines.
      const tree = renderContextTree(tmp, { maxBytes: 50 });
      expect(tree).toContain("truncated:");
      expect(tree).toContain("more entries not shown");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
