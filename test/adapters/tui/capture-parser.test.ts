import { describe, test, expect } from "bun:test";
import { XtermCaptureParser } from "../../../src/adapters/tui/capture-parser";

describe("XtermCaptureParser", () => {
  test("parses plain text into the correct cells", async () => {
    const parser = new XtermCaptureParser();
    const capture = await parser.parse("hello\r\n", 10, 2);
    expect(capture.cols).toBe(10);
    expect(capture.rows).toBe(2);
    expect(capture.cells).toHaveLength(2);
    expect(capture.cells[0]).toHaveLength(10);
    expect(capture.cells[0][0].ch).toBe("h");
    expect(capture.cells[0][4].ch).toBe("o");
    // Remaining cells on row 0 are blank.
    expect(capture.cells[0][5].ch).toBe(" ");
    // Row 1 is entirely blank.
    expect(capture.cells[1].every((c) => c.ch === " ")).toBe(true);
  });

  test("captures ANSI foreground colors", async () => {
    const parser = new XtermCaptureParser();
    // \x1b[31m = red fg, \x1b[32m = green fg, \x1b[0m = reset.
    const ansi = "\x1b[31mR\x1b[32mG\x1b[0mn";
    const capture = await parser.parse(ansi, 10, 1);
    const row = capture.cells[0];
    expect(row[0].ch).toBe("R");
    expect(row[0].fg).toBeDefined();
    expect(row[1].ch).toBe("G");
    expect(row[1].fg).toBeDefined();
    // Different colors translate to different fg strings.
    expect(row[0].fg).not.toBe(row[1].fg);
    // The reset character has no fg attribute.
    expect(row[2].ch).toBe("n");
    expect(row[2].fg).toBeUndefined();
  });

  test("captures bold attribute", async () => {
    const parser = new XtermCaptureParser();
    const ansi = "\x1b[1mB\x1b[0m";
    const capture = await parser.parse(ansi, 5, 1);
    expect(capture.cells[0][0].bold).toBe(true);
  });

  test("fills full grid even when ansi is empty", async () => {
    const parser = new XtermCaptureParser();
    const capture = await parser.parse("", 4, 3);
    expect(capture.cells).toHaveLength(3);
    for (const row of capture.cells) {
      expect(row).toHaveLength(4);
      expect(row.every((c) => c.ch === " ")).toBe(true);
    }
  });

  test("handles wide characters — leading cell has width 2, trailer is empty", async () => {
    const parser = new XtermCaptureParser();
    // Japanese "a" (half-width isn't wide; use a CJK glyph instead).
    // 漢 is East Asian Wide.
    const capture = await parser.parse("漢", 6, 1);
    const row = capture.cells[0];
    expect(row[0].ch).toBe("漢");
    expect(row[0].width).toBe(2);
    expect(row[1].ch).toBe("");
    expect(row[1].width).toBe(1);
  });

  test("maps 256-color palette indices to hex — cube and grayscale", async () => {
    const parser = new XtermCaptureParser();
    // \x1b[38;5;<n>m selects palette index n as foreground.
    //   n=202 → RGB cube: idx=186, r=5 g=1 b=0 → (255, 95, 0) = #ff5f00
    //   n=240 → grayscale: gray = 8 + (240-232)*10 = 88 → #585858
    //   n=15  → base palette bright white → #ffffff
    //   n=1   → base palette red → #cd3131
    const ansi =
      "\x1b[38;5;202mA" +
      "\x1b[38;5;240mB" +
      "\x1b[38;5;15mC" +
      "\x1b[38;5;1mD" +
      "\x1b[0m";
    const capture = await parser.parse(ansi, 8, 1);
    const row = capture.cells[0];
    expect(row[0].fg).toBe("#ff5f00");
    expect(row[1].fg).toBe("#585858");
    expect(row[2].fg).toBe("#ffffff");
    expect(row[3].fg).toBe("#cd3131");
    // All palette paths now emit "#rrggbb"; no "p<NNN>" sentinels leak
    // out of the parser into on-disk JSON.
    for (const cell of row.slice(0, 4)) {
      expect(cell.fg?.startsWith("#")).toBe(true);
    }
  });
});
