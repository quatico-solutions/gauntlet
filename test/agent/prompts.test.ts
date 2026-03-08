import { describe, test, expect } from "bun:test";
import { buildSystemPrompt } from "../../src/agent/prompts";
import type { StoryCard } from "../../src/format/story-card";

describe("buildSystemPrompt", () => {
  test("includes story card content", () => {
    const card: StoryCard = {
      id: "story-001",
      title: "User can add a todo",
      status: "ready",
      tags: ["core"],
      description: "As a user I want to add a todo",
      acceptanceCriteria: ["Item appears in list", "Count updates"],
      raw: "",
    };

    const prompt = buildSystemPrompt(card);
    expect(prompt).toContain("story-001");
    expect(prompt).toContain("User can add a todo");
    expect(prompt).toContain("Item appears in list");
    expect(prompt).toContain("Count updates");
  });

  test("instructs agent to report observations", () => {
    const card: StoryCard = {
      id: "story-001",
      title: "Test",
      status: "ready",
      tags: [],
      description: "Test story",
      acceptanceCriteria: [],
      raw: "",
    };

    const prompt = buildSystemPrompt(card);
    expect(prompt).toContain("observation");
  });

  test("instructs autonomous exploration when no criteria", () => {
    const card: StoryCard = {
      id: "story-001",
      title: "Test",
      status: "ready",
      tags: [],
      description: "Explore the app",
      acceptanceCriteria: [],
      raw: "",
    };

    const prompt = buildSystemPrompt(card);
    expect(prompt).toContain("explore");
  });
});
