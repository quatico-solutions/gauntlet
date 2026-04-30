import { describe, test, expect } from "bun:test";
import type { RunSetCtx, SetBucket } from "../../src/runs/run-set-types";

describe("RunSetCtx", () => {
  test("type compiles with valid shape", () => {
    const ctx: RunSetCtx = {
      runSetId: "single_20260430T000000Z_abcd",
      kind: "single",
      passes: 3,
      cards: ["login-ok"],
      cardIndex: 0,
      attemptNumber: 2,
    };
    expect(ctx.attemptNumber).toBe(2);
  });

  test("SetBucket admits all six values", () => {
    const buckets: SetBucket[] = [
      "consistent_pass",
      "consistent_investigate",
      "consistent_fail",
      "mixed",
      "mixed_with_errors",
      "errored",
    ];
    expect(buckets).toHaveLength(6);
  });
});
