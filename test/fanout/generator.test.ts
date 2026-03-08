import { describe, test, expect } from "bun:test";
import { buildFanoutPrompt, generateFanout } from "../../src/fanout/generator";
import { parseStoryCard } from "../../src/format/story-card";
import type { StoryCard } from "../../src/format/story-card";
import type { LLMClient } from "../../src/models/provider";

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

test("generateFanout splits response into cards", async () => {
  const mockClient: LLMClient = {
    async chat() {
      return {
        text: `---\nid: story-001-a\ntitle: Variation A\nstatus: draft\nparent: story-001\n---\n\n# Variation A\n\nTest edge case.\n\n## Acceptance Criteria\n\n- Shows error\n---CARD---\n---\nid: story-001-b\ntitle: Variation B\nstatus: draft\nparent: story-001\n---\n\n# Variation B\n\nTest boundary.\n\n## Acceptance Criteria\n\n- Handles limit`,
        toolCalls: [],
        stopReason: "end_turn" as const,
        rawAssistantMessage: null,
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
    userMessage(content: string) {
      return { role: "user", content };
    },
    toolResultMessages() {
      return [];
    },
  };

  const card: StoryCard = {
    id: "story-001",
    title: "Test",
    status: "ready",
    tags: [],
    description: "Test",
    acceptanceCriteria: ["Works"],
    raw: "",
  };

  const cards = await generateFanout(card, mockClient);
  expect(cards).toHaveLength(2);
  expect(cards[0]).toContain("story-001-a");
  expect(cards[1]).toContain("story-001-b");
});

test("generateFanout filters out invalid cards", async () => {
  const validCardA = `---\nid: story-001-a\ntitle: Variation A\nstatus: draft\nparent: story-001\n---\n\n# Variation A\n\nTest edge case.\n\n## Acceptance Criteria\n\n- Shows error`;
  const invalidCard = `This is just some text with no frontmatter at all`;
  const validCardB = `---\nid: story-001-b\ntitle: Variation B\nstatus: draft\nparent: story-001\n---\n\n# Variation B\n\nTest boundary.\n\n## Acceptance Criteria\n\n- Handles limit`;

  const mockClient: LLMClient = {
    async chat() {
      return {
        text: [validCardA, invalidCard, validCardB].join("\n---CARD---\n"),
        toolCalls: [],
        stopReason: "end_turn" as const,
        rawAssistantMessage: null,
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
    userMessage(content: string) {
      return { role: "user", content };
    },
    toolResultMessages() {
      return [];
    },
  };

  const card: StoryCard = {
    id: "story-001",
    title: "Test",
    status: "ready",
    tags: [],
    description: "Test",
    acceptanceCriteria: ["Works"],
    raw: "",
  };

  const cards = await generateFanout(card, mockClient);
  expect(cards).toHaveLength(2);
  // Every returned card must be parseable
  for (const raw of cards) {
    expect(() => parseStoryCard(raw)).not.toThrow();
  }
  expect(cards[0]).toContain("story-001-a");
  expect(cards[1]).toContain("story-001-b");
});
