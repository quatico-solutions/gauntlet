import type { StoryCard } from "../format/story-card";

// The Context section prose is authoritative from Gauntlet v1.5 spec §4.1.
// DO NOT edit without going through the amendment protocol (spec §13).
// The tests assert this exact string — if a typo sneaks in, the prompts
// test breaks at CI time. The three-paragraph framing is load-bearing:
//
//   - "freeform data store" discourages the agent from assuming schema
//   - "stories refer to users by name" cues the credential-discovery model
//   - "tree is below" tells the agent the tree is ground truth, not a hint
//   - the closing paragraph's "built once at the start of the run and
//     does not change" is the prose face of the immutability invariant
//     (spec §4.2).
const CONTEXT_SECTION_PROSE =
  "## Context\n\n" +
  "The project has a context directory at `.gauntlet/context/`. This is a\n" +
  "freeform data store the story author set up for this project. Read files\n" +
  "with `read` and pull out whatever you need to carry out the story.\n\n" +
  "Stories will often refer to users by name (\"Alice\", \"as bob\") without\n" +
  "spelling out credentials. When that happens, look for a matching path in\n" +
  "the tree below, `read` the relevant files, and use what you find to log\n" +
  "in via the regular browser tools. A profile directory typically contains\n" +
  "an identity file (prose describing the person) and a credentials file;\n" +
  "some also contain `passkey.json` for WebAuthn sign-in via\n" +
  "`install_passkey`.\n\n" +
  "Below is the complete tree of everything available under\n" +
  "`.gauntlet/context/` for this run. File sizes in bytes are shown after\n" +
  "each entry. This listing is the full map: it is built once at the start\n" +
  "of the run and does not change while the run is in flight, so you do not\n" +
  "need to — and cannot — re-list the directory. Every file you might need\n" +
  "is in this tree; if a path is not shown here, it does not exist.\n\n" +
  "### .gauntlet/context/\n" +
  "{{TREE_LISTING}}";

// Exported for tests that want to diff the prose against the spec.
export const CONTEXT_SECTION_TEMPLATE = CONTEXT_SECTION_PROSE;

export function buildSystemPrompt(
  card: StoryCard,
  contextTree?: string,
): string {
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

  // Context section — last block, only when populated. Spec §4.4.
  if (contextTree && contextTree.length > 0) {
    parts.push(
      "\n" + CONTEXT_SECTION_PROSE.replace("{{TREE_LISTING}}", contextTree),
    );
  }

  return parts.join("\n");
}
