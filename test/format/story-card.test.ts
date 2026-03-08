import { describe, test, expect } from "bun:test";
import { parseStoryCard, type StoryCard } from "../../src/format/story-card";
import { readFileSync } from "fs";
import { join } from "path";

const fixture = (name: string) =>
  readFileSync(join(__dirname, "../fixtures", name), "utf-8");

describe("parseStoryCard", () => {
  test("parses full story card with all fields", () => {
    const card = parseStoryCard(fixture("story-001-add-todo.md"));
    expect(card.id).toBe("story-001");
    expect(card.title).toBe("User can add a todo item");
    expect(card.status).toBe("ready");
    expect(card.tags).toEqual(["onboarding", "core"]);
    expect(card.stakeholder).toBe("new user");
    expect(card.parent).toBeUndefined();
    expect(card.description).toContain("As a new user");
    expect(card.acceptanceCriteria).toHaveLength(3);
    expect(card.acceptanceCriteria[0]).toBe(
      "User can type a todo item and press Enter"
    );
  });

  test("parses minimal story card", () => {
    const card = parseStoryCard(fixture("story-002-minimal.md"));
    expect(card.id).toBe("story-002");
    expect(card.title).toBe("Minimal story");
    expect(card.status).toBe("draft");
    expect(card.tags).toEqual([]);
    expect(card.acceptanceCriteria).toEqual([]);
    expect(card.description).toContain("minimal frontmatter");
  });

  test("parses parent reference", () => {
    const card = parseStoryCard(fixture("story-003-with-parent.md"));
    expect(card.parent).toBe("story-001");
    expect(card.stakeholder).toBe("power user");
  });

  test("throws on missing id", () => {
    expect(() =>
      parseStoryCard("---\ntitle: No ID\n---\nSome body")
    ).toThrow();
  });

  test("throws on missing title", () => {
    expect(() =>
      parseStoryCard("---\nid: story-x\n---\nSome body")
    ).toThrow();
  });
});
