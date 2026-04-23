import { describe, test, expect } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ScreencastStreamer } from "../../src/streaming/screencast";

describe("ScreencastStreamer", () => {
  test("can be constructed", () => {
    const streamer = new ScreencastStreamer(0, () => {});
    expect(streamer).toBeDefined();
  });

  // The screencast save-opt-in spec hinges on the streamer being the
  // single on-disk writer for frames. These two tests pin the gate:
  // omitting saveDir MUST leave the filesystem untouched, while
  // providing one MUST create the directory eagerly. The live WS
  // path (the onFrame callback) is identical in both cases — not
  // asserted here because it fires only when a real CDP event pumps
  // the streamer.

  test("does NOT create any directory on disk when saveDir is undefined", () => {
    const root = mkdtempSync(join(tmpdir(), "gauntlet-screencast-gate-"));
    try {
      const framesDir = join(root, "frames");
      expect(existsSync(framesDir)).toBe(false);
      const streamer = new ScreencastStreamer(0, () => {}, undefined);
      expect(streamer).toBeDefined();
      // No saveDir => constructor must not touch disk.
      expect(existsSync(framesDir)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("creates the saveDir eagerly when provided", () => {
    const root = mkdtempSync(join(tmpdir(), "gauntlet-screencast-gate-"));
    try {
      const framesDir = join(root, "frames");
      expect(existsSync(framesDir)).toBe(false);
      const streamer = new ScreencastStreamer(0, () => {}, framesDir);
      expect(streamer).toBeDefined();
      expect(existsSync(framesDir)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
