import { describe, test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve as resolvePath } from "path";
import { resolveInside } from "../../src/context/path";

describe("resolveInside", () => {
  test("resolves a simple relative path under the root", () => {
    const tmp = mkdtempSync(join(tmpdir(), "gauntlet-path-"));
    try {
      const file = join(tmp, "alice.md");
      writeFileSync(file, "x");
      const resolved = resolveInside(tmp, "alice.md");
      expect(resolved).toBe(resolvePath(file));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("resolves a nested relative path under the root", () => {
    const tmp = mkdtempSync(join(tmpdir(), "gauntlet-path-"));
    try {
      mkdirSync(join(tmp, "alice"), { recursive: true });
      const file = join(tmp, "alice", "credentials.md");
      writeFileSync(file, "x");
      const resolved = resolveInside(tmp, "alice/credentials.md");
      expect(resolved).toBe(resolvePath(file));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("rejects `..` segments", () => {
    const tmp = mkdtempSync(join(tmpdir(), "gauntlet-path-"));
    try {
      expect(() => resolveInside(tmp, "../etc/passwd")).toThrow(/\.\./);
      expect(() => resolveInside(tmp, "alice/../../etc/passwd")).toThrow(/\.\./);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("rejects absolute paths (POSIX style)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "gauntlet-path-"));
    try {
      expect(() => resolveInside(tmp, "/etc/passwd")).toThrow(/relative/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("rejects empty input", () => {
    const tmp = mkdtempSync(join(tmpdir(), "gauntlet-path-"));
    try {
      expect(() => resolveInside(tmp, "")).toThrow();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("rejects escapes via `..` even when target exists", () => {
    const parent = mkdtempSync(join(tmpdir(), "gauntlet-path-parent-"));
    try {
      const root = join(parent, "root");
      mkdirSync(root);
      writeFileSync(join(parent, "outside.txt"), "boo");
      expect(() => resolveInside(root, "../outside.txt")).toThrow();
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  test("allows legitimate nested subdirectories at arbitrary depth", () => {
    const tmp = mkdtempSync(join(tmpdir(), "gauntlet-path-"));
    try {
      mkdirSync(join(tmp, "users", "alice", "secrets"), { recursive: true });
      const file = join(tmp, "users", "alice", "secrets", "key.json");
      writeFileSync(file, "{}");
      const resolved = resolveInside(tmp, "users/alice/secrets/key.json");
      expect(resolved).toBe(resolvePath(file));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
