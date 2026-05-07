import type { StoryCard } from "../format/story-card";
import { loadPromptFile } from "./prompts/loader";
import { isAdapterType } from "../adapters/adapter";

// Exported for tests that want to diff the prose against the spec.
export function getContextSectionTemplate(): string {
  return loadPromptFile("context");
}
export const CONTEXT_SECTION_TEMPLATE = getContextSectionTemplate();

export function buildSystemPrompt(
  card: StoryCard,
  contextTree?: string,
  adapterName?: string,
): string {
  const parts: string[] = [];

  parts.push(loadPromptFile("persona"));

  parts.push(`\n## Story Card\n`);
  parts.push(`**ID:** ${card.id}`);
  parts.push(`**Title:** ${card.title}`);
  if (card.stakeholder) parts.push(`**Stakeholder:** ${card.stakeholder}`);
  parts.push(`\n${card.description}`);

  if (card.acceptanceCriteria.length > 0) {
    parts.push(`\n## Acceptance Criteria`);
    for (const criterion of card.acceptanceCriteria) {
      parts.push(`- ${criterion}`);
    }
    parts.push(
      `\nEvaluate each criterion based on what you observe. Use your judgment.`
    );
  } else {
    parts.push(
      `\nThis story has no explicit acceptance criteria. You should explore the application freely and report what you find. Judge whether the story's intent is satisfied.`
    );
  }

  parts.push(loadPromptFile("evaluation"));

  // Per-adapter overlay (e.g. web side-trip guidance). Whitelisted to
  // the known adapter types so a missing adapter-{name}.md for a real
  // adapter is a hard error (per spec), while test-fake adapter names
  // (e.g. "test" in event-stream tests) silently contribute nothing.
  if (adapterName && isAdapterType(adapterName)) {
    const adapterPrompt = loadPromptFile(`adapter-${adapterName}`);
    if (adapterPrompt.length > 0) {
      parts.push(adapterPrompt);
    }
  }

  // Context section — last block, only when populated. Spec §4.4.
  if (contextTree && contextTree.length > 0) {
    parts.push(
      "\n" + loadPromptFile("context").replace("{{TREE_LISTING}}", contextTree),
    );
  }

  return parts.join("\n");
}
