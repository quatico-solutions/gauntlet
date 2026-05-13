import type { ToolCall, ToolDefinition } from "../models/provider";

export const ANSWER_TOOL: ToolDefinition = {
  name: "answer",
  description:
    "Reply to the operator's question about this completed test run. " +
    "This is the only tool available; the original run's tools are listed in the system prompt for context but cannot be invoked.",
  parameters: {
    type: "object",
    properties: {
      answer: {
        type: "string",
        description: "Your reply to the operator's question. Reason out loud as needed.",
      },
    },
    required: ["answer"],
  },
};

export type ExtractedAnswer =
  | { kind: "structured"; text: string }
  | { kind: "unstructured"; text: string };

export function extractAnswer(toolCalls: ToolCall[], fallbackText: string): ExtractedAnswer {
  const answerCall = toolCalls.find((tc) => tc.name === "answer");
  if (answerCall) {
    const arg = answerCall.arguments.answer;
    if (typeof arg === "string") {
      return { kind: "structured", text: arg };
    }
  }
  return { kind: "unstructured", text: fallbackText };
}
