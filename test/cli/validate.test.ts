import { describe, test, expect } from "bun:test";
import { validateScenario } from "../../src/cli/validate";
import { join } from "path";

const fixtureDir = join(__dirname, "../fixtures");

describe("validateScenario", () => {
  test("valid story card passes", () => {
    const result = validateScenario(join(fixtureDir, "story-001-add-todo.md"));
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("missing id fails", () => {
    const result = validateScenario(join(fixtureDir, "invalid-no-id.md"));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("id");
  });

  test("nonexistent file fails", () => {
    const result = validateScenario(join(fixtureDir, "does-not-exist.md"));
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
  });
});
