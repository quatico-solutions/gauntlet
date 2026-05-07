import { describe, test, expect } from "bun:test";

// Regression gate for the Myers-algorithm generateHtmlDiff (hand-ported
// from upstream obra/superpowers-chrome 9861d76). The pre-Myers
// implementation was set-based, so reordered identical lines reported
// "(no changes detected)" — masking real DOM changes from
// captureActionWithDiff. Protect that invariant.

describe("generateHtmlDiff (Myers)", () => {
  test("returns '(no changes detected)' for identical input", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createSession } = require("../../../src/adapters/web/lib/chrome-ws-lib");
    const { generateHtmlDiff } = createSession();
    const html = "<div>hello</div>\n<div>world</div>";
    expect(generateHtmlDiff(html, html)).toBe("(no changes detected)");
  });

  test("shows pure additions in ADDED section only", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createSession } = require("../../../src/adapters/web/lib/chrome-ws-lib");
    const { generateHtmlDiff } = createSession();
    const before = "<p>a</p>";
    const after = "<p>a</p>\n<p>b</p>";
    const diff = generateHtmlDiff(before, after);
    expect(diff).toMatch(/=== ADDED ===/);
    expect(diff).toMatch(/\+ <p>b<\/p>/);
    expect(diff).not.toMatch(/=== REMOVED ===/);
  });

  test("shows pure removals in REMOVED section only", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createSession } = require("../../../src/adapters/web/lib/chrome-ws-lib");
    const { generateHtmlDiff } = createSession();
    const before = "<p>a</p>\n<p>b</p>";
    const after = "<p>a</p>";
    const diff = generateHtmlDiff(before, after);
    expect(diff).toMatch(/=== REMOVED ===/);
    expect(diff).toMatch(/- <p>b<\/p>/);
    expect(diff).not.toMatch(/=== ADDED ===/);
  });

  test("detects reorderings of identical lines (the Myers bug-fix case)", () => {
    // The pre-Myers (set-based) logic returned "(no changes detected)" for
    // this — set membership doesn't capture order. Real reorderings (e.g. a
    // list re-sorted by a click) silently looked like no change.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createSession } = require("../../../src/adapters/web/lib/chrome-ws-lib");
    const { generateHtmlDiff } = createSession();
    const before = "<p>first</p>\n<p>second</p>";
    const after = "<p>second</p>\n<p>first</p>";
    const diff = generateHtmlDiff(before, after);
    expect(diff).not.toBe("(no changes detected)");
  });

  test("caps each side at 50 lines with 'and N more' footer", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createSession } = require("../../../src/adapters/web/lib/chrome-ws-lib");
    const { generateHtmlDiff } = createSession();
    const before = "";
    const after = Array.from({ length: 200 }, (_, i) => `<p>line ${i}</p>`).join("\n");
    const diff = generateHtmlDiff(before, after);
    const addedLines = diff.split("\n").filter(l => l.startsWith("+ "));
    expect(addedLines.length).toBe(50);
    expect(diff).toMatch(/and 150 more added lines/);
  });

  test("handles null/empty input", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createSession } = require("../../../src/adapters/web/lib/chrome-ws-lib");
    const { generateHtmlDiff } = createSession();
    expect(generateHtmlDiff(null, null)).toBe("(no changes detected)");
    expect(generateHtmlDiff("", "")).toBe("(no changes detected)");
  });
});
