import { describe, test, expect } from "bun:test";
import { buildFanoutPrompt } from "../../src/fanout/generator";
import type { StoryCard } from "../../src/format/story-card";

describe("buildFanoutPrompt", () => {
  test("includes parent story content", () => {
    const card: StoryCard = {
      id: "story-001",
      title: "User can add a todo",
      status: "ready",
      tags: ["core"],
      description: "As a user I want to add a todo",
      acceptanceCriteria: ["Item appears in list"],
      raw: "",
    };

    const prompt = buildFanoutPrompt(card);
    expect(prompt).toContain("story-001");
    expect(prompt).toContain("User can add a todo");
    expect(prompt).toContain("Item appears in list");
  });

  test("instructs generation of variations", () => {
    const card: StoryCard = {
      id: "story-001",
      title: "Test",
      status: "ready",
      tags: [],
      description: "Test",
      acceptanceCriteria: [],
      raw: "",
    };

    const prompt = buildFanoutPrompt(card);
    expect(prompt).toContain("edge case");
    expect(prompt).toContain("parent: story-001");
  });
});
