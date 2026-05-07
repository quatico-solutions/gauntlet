import type { StoryCard } from "../format/story-card";
import { loadPromptFile } from "./prompts/loader";

// Exported for tests that want to diff the prose against the spec.
export function getContextSectionTemplate(): string {
  return loadPromptFile("context");
}
export const CONTEXT_SECTION_TEMPLATE = getContextSectionTemplate();

// PRI-1439: side-trip tab guidance for the web adapter. Surfaces the
// new_tab/close_tab tool pair as the right answer for the OTP /
// password-manager / 2FA-portal case, and explicitly steers off
// `navigate`, which would trash the original page's state.
const WEB_SIDE_TRIP_GUIDANCE =
  "\n## Side trips for sign-in flows\n\n" +
  "If a sign-in asks you to fetch a code from email, retrieve a password " +
  "from a password manager, or visit another site for a verification " +
  "step, use `new_tab(url)` to open that site in a side tab. Work there " +
  "as you normally would. When done, call `close_tab` to return to the " +
  "original page — its form values, cookies, and scroll position will " +
  "be intact. Do NOT use `navigate` for side trips: it resets the " +
  "original page state and you will have to start the sign-in over.";

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

  parts.push(`\n## Reporting

When you are done testing, call the \`report_result\` tool with your findings.

Your verdict should be:
- **pass** — the story's intent is satisfied, acceptance criteria met
- **fail** — something is clearly broken or criteria are not met
- **investigate** — you're unsure, something seems off but you can't confirm

Include ALL observations, not just those related to the acceptance criteria.`);

  // PRI-1439: web-only side-trip guidance. Other adapters (cli, tui)
  // don't have new_tab/close_tab and should not be told to use them.
  if (adapterName === "web") {
    parts.push(WEB_SIDE_TRIP_GUIDANCE);
  }

  // Context section — last block, only when populated. Spec §4.4.
  if (contextTree && contextTree.length > 0) {
    parts.push(
      "\n" + loadPromptFile("context").replace("{{TREE_LISTING}}", contextTree),
    );
  }

  return parts.join("\n");
}
