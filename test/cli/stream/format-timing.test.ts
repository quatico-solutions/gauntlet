import { describe, test, expect } from "bun:test";
import { formatTiming } from "../../../src/cli/stream/format-timing";

describe("formatTiming", () => {
  describe("success path", () => {
    test("hides sub-50ms timings", () => {
      expect(formatTiming(0, false)).toBeNull();
      expect(formatTiming(1, false)).toBeNull();
      expect(formatTiming(49, false)).toBeNull();
    });

    test("renders 50–999ms as Nms (not slow)", () => {
      expect(formatTiming(50, false)).toEqual({ text: "50ms", slow: false });
      expect(formatTiming(309, false)).toEqual({ text: "309ms", slow: false });
      expect(formatTiming(999, false)).toEqual({ text: "999ms", slow: false });
    });

    test("renders ≥1s as 1.2s and marks slow", () => {
      expect(formatTiming(1000, false)).toEqual({ text: "1.0s", slow: true });
      expect(formatTiming(2401, false)).toEqual({ text: "2.4s", slow: true });
      expect(formatTiming(30000, false)).toEqual({ text: "30.0s", slow: true });
    });

    test("rounds fractional ms", () => {
      expect(formatTiming(50.4, false)).toEqual({ text: "50ms", slow: false });
      expect(formatTiming(50.6, false)).toEqual({ text: "51ms", slow: false });
    });
  });

  describe("error path", () => {
    test("always renders timing, even when sub-50ms", () => {
      expect(formatTiming(5, true)).toEqual({ text: "5ms", slow: true });
    });

    test("renders ≥1s in seconds, marks slow", () => {
      expect(formatTiming(30003, true)).toEqual({ text: "30.0s", slow: true });
    });
  });
});
