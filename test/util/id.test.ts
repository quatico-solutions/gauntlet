import { describe, test, expect } from "bun:test";
import { makeRunId, sanitizeProfileSegment } from "../../src/util/id";

describe("makeRunId", () => {
  test("returns a non-empty string", () => {
    const id = makeRunId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  test("matches the Chrome profile-name regex (alphanumeric, hyphen, underscore)", () => {
    // chrome-ws-lib's setProfileName enforces /^[a-zA-Z0-9_-]+$/.
    // The runId is composed into `gauntlet-run-<runId>-<cardId>` without
    // intermediate cleanup, so it must be safe on its own.
    for (let i = 0; i < 50; i++) {
      expect(makeRunId()).toMatch(/^[a-zA-Z0-9_-]+$/);
    }
  });

  test("returns distinct ids for successive calls", () => {
    // A loose uniqueness guarantee: ms-resolution timestamp + 4 random
    // chars. Two back-to-back calls should not collide in practice.
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      ids.add(makeRunId());
    }
    expect(ids.size).toBeGreaterThan(1);
  });
});

describe("sanitizeProfileSegment", () => {
  test("passes through already-safe segments", () => {
    expect(sanitizeProfileSegment("alice")).toBe("alice");
    expect(sanitizeProfileSegment("card-001_v2")).toBe("card-001_v2");
  });

  test("replaces unsafe characters with hyphens", () => {
    expect(sanitizeProfileSegment("foo/bar")).toBe("foo-bar");
    expect(sanitizeProfileSegment("foo.bar")).toBe("foo-bar");
    expect(sanitizeProfileSegment("a b c")).toBe("a-b-c");
    expect(sanitizeProfileSegment("weird$name!")).toBe("weird-name-");
  });

  test("produces output matching the chrome-ws-lib regex", () => {
    const samples = ["alice", "card-001", "weird$name!", "foo/bar", "tab\ttab"];
    for (const s of samples) {
      expect(sanitizeProfileSegment(s)).toMatch(/^[a-zA-Z0-9_-]+$/);
    }
  });
});
