import { describe, test, expect } from "bun:test";
import { parseArgs } from "../../src/cli/args";

describe("parseArgs render", () => {
  test("parses a run-id positional", () => {
    const parsed = parseArgs(["bun", "index.ts", "render", "01-add-one_20260514T220510Z_u116"]);
    expect(parsed.command).toBe("render");
    if (parsed.command !== "render") throw new Error("unreachable");
    expect(parsed.runIdOrPath).toBe("01-add-one_20260514T220510Z_u116");
  });

  test("accepts --state-dir and --project-dir flags", () => {
    const parsed = parseArgs([
      "bun", "index.ts",
      "render",
      "/abs/path/to/run-dir",
      "--state-dir", ".my-state",
      "--project-dir", "/proj",
    ]);
    if (parsed.command !== "render") throw new Error("unreachable");
    expect(parsed.runIdOrPath).toBe("/abs/path/to/run-dir");
    expect(parsed.cli.stateDirName).toBe(".my-state");
    expect(parsed.cli.projectRoot).toBe("/proj");
  });

  test("rejects unknown flags", () => {
    expect(() => parseArgs(["bun", "index.ts", "render", "some-id", "--unknown", "x"]))
      .toThrow(/unknown flag/i);
  });

  test("missing positional throws usage error", () => {
    expect(() => parseArgs(["bun", "index.ts", "render"])).toThrow(/usage/i);
  });
});
