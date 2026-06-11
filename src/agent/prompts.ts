import type { StoryCard } from "../format/story-card";
import { loadPromptFile } from "./prompts/loader";
import { isAdapterType } from "../adapters/adapter";

/**
 * Build the Scenario blocks (Story Card + Acceptance Criteria) for a card.
 * Returned as an ordered array of strings where each entry is a `\n\n`-
 * separable block, matching the joiner contract in `buildSystemPrompt`.
 *
 * Exported so the introspect renderer (`--show-prompt-and-exit`) emits
 * the EXACT same Scenario text the agent sees, with no drift.
 */
export function buildScenarioBlocks(card: StoryCard): string[] {
  const blocks: string[] = [];

  // Story Card block — header, identifying lines, and description are
  // one block (sub-lines joined by \n; the description is offset by a
  // blank line within the block).
  const storyLines: string[] = [`## Story Card`, ``, `**ID:** ${card.id}`, `**Title:** ${card.title}`];
  if (card.stakeholder) storyLines.push(`**Stakeholder:** ${card.stakeholder}`);
  storyLines.push(``, card.description);
  blocks.push(storyLines.join("\n"));

  if (card.acceptanceCriteria.length > 0) {
    // Acceptance Criteria block — header, numbered items (adjacent),
    // then the "Evaluate..." closer offset by a blank line. Single block
    // so the joiner doesn't insert blanks between items. Numbered, not
    // bulleted, because report_result's criteria entries map to these by
    // position (PRI-2160).
    const critLines: string[] = [`## Acceptance Criteria`];
    card.acceptanceCriteria.forEach((criterion, i) => {
      critLines.push(`${i + 1}. ${criterion}`);
    });
    critLines.push(
      ``,
      `Evaluate each criterion based on what you observe. Use your judgment. ` +
        `When you call report_result, its \`criteria\` array must contain one entry ` +
        `per criterion above, in the same order, each with your verdict and the ` +
        `evidence you observed.`,
    );
    blocks.push(critLines.join("\n"));
  } else {
    blocks.push(
      `This story has no explicit acceptance criteria. You should explore the application freely and report what you find. Judge whether the story's intent is satisfied.`
    );
  }

  return blocks;
}

export function buildSystemPrompt(
  card: StoryCard,
  contextTree: string | undefined,
  adapterName: string | undefined,
  projectPrompt: string | undefined,
): string {
  const parts: string[] = [];

  parts.push(loadPromptFile("persona"));

  for (const block of buildScenarioBlocks(card)) {
    parts.push(block);
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

  // Project — caller-supplied augmentation. See spec
  // 2026-05-06-prompt-extraction-and-introspection-design.md.
  if (projectPrompt && projectPrompt.length > 0) {
    parts.push(projectPrompt);
  }

  // Context section — only when populated. Spec §4.4.
  if (contextTree && contextTree.length > 0) {
    parts.push(
      loadPromptFile("context").replace("{{TREE_LISTING}}", contextTree),
    );
  }

  // Shell access section — always emitted; bash tool is always mounted.
  parts.push(loadPromptFile("shell-access"));

  return parts.join("\n\n");
}
