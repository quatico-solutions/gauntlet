import { describe, test, expect } from "bun:test";
import { ScreencastStreamer } from "../../src/streaming/screencast";

describe("ScreencastStreamer", () => {
  test("can be constructed", () => {
    const streamer = new ScreencastStreamer(0, () => {});
    expect(streamer).toBeDefined();
  });
});
