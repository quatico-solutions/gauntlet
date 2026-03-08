import { parseStoryCard } from "../../src/format/story-card";
import type {
  LLMClient,
  ToolCall,
  ToolResult,
  AgentResponse,
} from "../../src/models/provider";
import { join } from "path";
import { readFileSync } from "fs";

const STORIES_DIR = join(import.meta.dir, "../fixtures/stories");

export function loadStory(filename: string) {
  return parseStoryCard(readFileSync(join(STORIES_DIR, filename), "utf-8"));
}

export function step(
  id: string,
  name: string,
  args: Record<string, unknown>
): AgentResponse {
  return {
    text: `Executing ${name}`,
    toolCalls: [{ id, name, arguments: args }],
    stopReason: "tool_use",
    rawAssistantMessage: { role: "assistant", content: `step ${id}` },
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

export function report(
  status: string,
  summary: string,
  reasoning: string
): AgentResponse {
  return {
    text: summary,
    toolCalls: [
      {
        id: "call_report",
        name: "report_result",
        arguments: { status, summary, reasoning },
      },
    ],
    stopReason: "tool_use",
    rawAssistantMessage: { role: "assistant", content: "reporting" },
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

export function makeScriptedClient(
  steps: AgentResponse[],
  sleepMs = 200
): LLMClient {
  let callIndex = 0;

  return {
    async chat() {
      await Bun.sleep(sleepMs);
      const response = steps[callIndex++];
      if (!response) throw new Error("No more scripted responses");
      return response;
    },
    userMessage(content: string) {
      return { role: "user", content };
    },
    toolResultMessages(calls: ToolCall[], results: ToolResult[]) {
      return calls.map((call, i) => ({
        role: "tool_result",
        tool_call_id: call.id,
        content: results[i].text,
      }));
    },
  };
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} timed out after ${ms}ms`)),
        ms
      )
    ),
  ]);
}

/** Returns true if the error indicates Chrome/CDP is unavailable */
export function isChromeUnavailable(err: any): boolean {
  const msg = err?.message ?? "";
  return (
    msg.includes("No Chrome") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("chrome-ws-lib") ||
    msg.includes("adapter.start() timed out")
  );
}
