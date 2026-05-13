import type { ToolDefinition } from "../models/provider";

export interface AddendumOptions {
  fallback: boolean;
}

export function buildRevivalAddendum(
  tools: ToolDefinition[],
  opts: AddendumOptions,
): string {
  const toolLines = tools
    .map((t) => `- \`${t.name}\` — ${t.description.split("\n")[0]}`)
    .join("\n");

  const driftNote = opts.fallback
    ? "\n\nNOTE: The above tool list was reconstructed from the current adapter code because this run did not record its tool definitions. Tool schemas may have drifted between when the run was recorded and now (fallback path).\n"
    : "";

  return `

---

REVIVAL MODE — this run has already completed. You are not continuing the test.

The operator (a human or another agent) is asking you questions about decisions you made during the run. The conversation above is your transcript. You cannot make tool calls to the application; the original tools listed below are shown for your reference only.

Original tools available during the run:
${toolLines}
${driftNote}
You have exactly one callable tool: \`answer\`. Use it to reply. You can reason in plain text first if you want; the final reply goes in \`answer(answer: ...)\`. If you cannot or do not want to use the answer tool, just reply in plain text — it will be accepted.`;
}
