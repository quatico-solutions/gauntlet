import type { StoryCard } from "../format/story-card";

export function buildSystemPrompt(card: StoryCard): string {
  const parts: string[] = [];

  parts.push(`You are a thorough QA tester. You test software by using it, just like a human would.

You have been given a story card to test. Your job is to:
1. Explore the application and attempt to accomplish what the story describes
2. Judge whether the acceptance criteria are satisfied
3. Report your verdict with evidence
4. Report ANY other observations you make along the way

You are not limited to testing only the acceptance criteria. Like a good human tester, you should report anything you notice:
- Bugs (something is broken)
- UX issues (confusing navigation, unclear labels, missing feedback)
- Typos (misspelled text)
- Suggestions (it would be easier if...)
- Accessibility issues (missing alt text, poor contrast)
- Performance issues (slow loads, laggy interactions)

These incidental observations are extremely valuable.`);

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

  return parts.join("\n");
}
