import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { listProfiles, readProfile } from "../../src/format/profile";

// Passkey tests (readPasskey, listPasskeyProfiles) moved to
// test/adapters/web/passkey.test.ts in Gauntlet v1.5 WP1.5 — the passkey
// code now lives alongside the web adapter that owns it.

describe("listProfiles", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "gauntlet-profiles-test-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("returns [] when directory is missing", () => {
    expect(listProfiles(join(tmp, "nonexistent"))).toEqual([]);
  });

  test("returns [] when directory is empty", () => {
    const dir = join(tmp, ".gauntlet", "context");
    mkdirSync(dir, { recursive: true });
    expect(listProfiles(dir)).toEqual([]);
  });

  test("returns [] when path is a file, not a directory", () => {
    const p = join(tmp, "notadir");
    writeFileSync(p, "x");
    expect(listProfiles(p)).toEqual([]);
  });

  test("returns sorted aliases, stripping .md extension", () => {
    const dir = join(tmp, ".gauntlet", "context");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "bob.md"), "");
    writeFileSync(join(dir, "alice.md"), "");
    writeFileSync(join(dir, "power-user.md"), "");
    expect(listProfiles(dir)).toEqual(["alice", "bob", "power-user"]);
  });

  test("ignores non-markdown and hidden files", () => {
    const dir = join(tmp, ".gauntlet", "context");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "alice.md"), "");
    writeFileSync(join(dir, "README.txt"), "");
    writeFileSync(join(dir, ".gitignore"), "*.log");
    writeFileSync(join(dir, ".hidden.md"), "");
    expect(listProfiles(dir)).toEqual(["alice"]);
  });
});

describe("readProfile", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "gauntlet-profiles-read-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("returns the file contents verbatim", () => {
    const dir = join(tmp, ".gauntlet", "context");
    mkdirSync(dir, { recursive: true });
    const body = `---\ndisplay_name: Alice\n---\n\n## Credentials\n\n- Username: alice@example.com\n- Password: hunter2\n`;
    writeFileSync(join(dir, "alice.md"), body);
    const contents = readProfile(dir, "alice");
    expect(contents).toBe(body);
  });

  test("throws when the named profile does not exist", () => {
    const dir = join(tmp, ".gauntlet", "context");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "alice.md"), "A");
    expect(() => readProfile(dir, "bob")).toThrow();
  });

  test("rejects names that would escape the profiles directory", () => {
    const dir = join(tmp, ".gauntlet", "context");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(tmp, "secret.md"), "nope");
    expect(() => readProfile(dir, "../secret")).toThrow();
  });

  test("rejects names with path separators", () => {
    const dir = join(tmp, ".gauntlet", "context");
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "alice.md"), "inner");
    expect(() => readProfile(dir, "sub/alice")).toThrow();
  });
});
