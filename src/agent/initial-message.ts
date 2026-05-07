export interface AdapterTargetDescriber {
  describeTarget(target: string): string;
}

/**
 * Build the agent's first user message. Extracted from runAgent so that
 * --show-prompt-and-exit can render the exact same string without
 * spinning up the agent loop.
 */
export function buildInitialUserMessage(
  adapter: AdapterTargetDescriber,
  target: string | undefined,
): string {
  let msg = "Begin testing. Use the available tools to interact with the application.";
  if (target) {
    msg += `\n\n${adapter.describeTarget(target)}`;
  }
  return msg;
}
