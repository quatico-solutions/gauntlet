import type { StoryCard } from "../format/story-card";
import type { LLMClient } from "../models/provider";

export function buildFanoutPrompt(card: StoryCard): string {
  return `You are a QA test designer. Given a story card, generate variation scenarios that test edge cases, error paths, alternate personas, and boundary conditions.

Each variation is a story card in the same format. Each MUST include:
- A unique id (use the parent id with a suffix, e.g., story-001-a, story-001-b)
- parent: ${card.id}
- A clear title describing the variation
- A description explaining what this variation tests
- Acceptance criteria (at least one)

## Parent Story Card

**ID:** ${card.id}
**Title:** ${card.title}
${card.stakeholder ? `**Stakeholder:** ${card.stakeholder}` : ""}

${card.description}

${card.acceptanceCriteria.length > 0 ? "## Acceptance Criteria\n" + card.acceptanceCriteria.map((c) => `- ${c}`).join("\n") : ""}

## Generate Variations

Think about:
- Edge cases (empty input, very long input, special characters)
- Error paths (network failure, invalid state, permission denied)
- Alternate personas (new user, power user, admin, mobile user)
- Boundary conditions (first item, last item, maximum items)
- Negative testing (what should NOT happen)

Generate 3-5 variations. Output each as a complete story card in markdown format with YAML frontmatter, separated by "---CARD---" markers.`;
}

export async function generateFanout(
  card: StoryCard,
  client: LLMClient
): Promise<string[]> {
  const prompt = buildFanoutPrompt(card);
  const response = await client.chat(
    [{ role: "user", content: prompt }],
    [],
    "You are a QA test designer. Output story cards in markdown format."
  );

  return response.text
    .split("---CARD---")
    .map((s) => s.trim())
    .filter(Boolean);
}
