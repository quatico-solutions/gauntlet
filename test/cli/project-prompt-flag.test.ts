import { describe, test, expect } from "bun:test";
import { parseArgs } from "../../src/cli/args";

describe("--project-prompt flag", () => {
  test("parses --project-prompt with positional card path before flags", () => {
    const args = parseArgs(["bun", "gauntlet", "run", "./card.md", "--target", "http://x", "--project-prompt", "./extra.md"]);
    expect(args.command).toBe("run");
    if (args.command === "run") {
      expect(args.scenarioPath).toBe("./card.md");
      expect(args.projectPromptPath).toBe("./extra.md");
    }
  });

  test("parses --project-prompt before positional", () => {
    const args = parseArgs(["bun", "gauntlet", "run", "--target", "http://x", "--project-prompt", "./extra.md", "./card.md"]);
    expect(args.command).toBe("run");
    if (args.command === "run") {
      expect(args.scenarioPath).toBe("./card.md");
      expect(args.projectPromptPath).toBe("./extra.md");
    }
  });

  test("omitting --project-prompt yields undefined", () => {
    const args = parseArgs(["bun", "gauntlet", "run", "./card.md", "--target", "http://x"]);
    expect(args.command).toBe("run");
    if (args.command === "run") {
      expect(args.projectPromptPath).toBeUndefined();
    }
  });

  test("rejects --project-prompt for batch (batch will get this in a future task)", () => {
    expect(() =>
      parseArgs(["bun", "gauntlet", "batch", "./card.md", "--target", "http://x", "--project-prompt", "./extra.md"])
    ).toThrow(/Unknown flag/);
  });
});

describe("--show-prompt-and-exit flag", () => {
  test("bareword flag sets showPromptAndExit=true", () => {
    const args = parseArgs(["bun", "gauntlet", "run", "./card.md", "--target", "http://x", "--show-prompt-and-exit"]);
    expect(args.command).toBe("run");
    if (args.command === "run") {
      expect(args.showPromptAndExit).toBe(true);
    }
  });

  test("absent flag yields false", () => {
    const args = parseArgs(["bun", "gauntlet", "run", "./card.md", "--target", "http://x"]);
    expect(args.command).toBe("run");
    if (args.command === "run") {
      expect(args.showPromptAndExit).toBe(false);
    }
  });

  test("rejected for batch", () => {
    expect(() =>
      parseArgs(["bun", "gauntlet", "batch", "./card.md", "--target", "http://x", "--show-prompt-and-exit"])
    ).toThrow(/Unknown flag/);
  });
});
