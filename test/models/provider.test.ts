import { describe, test, expect } from "bun:test";
import type { ToolCall, ToolResult, AgentResponse, LLMClient } from "../../src/models/provider";

describe("provider types", () => {
  test("ToolCall has id field", () => {
    const call: ToolCall = {
      id: "call_123",
      name: "screenshot",
      arguments: {},
    };
    expect(call.id).toBe("call_123");
  });

  test("AgentResponse has rawAssistantMessage", () => {
    const response: AgentResponse = {
      text: "hello",
      toolCalls: [],
      stopReason: "end_turn",
      rawAssistantMessage: { role: "assistant", content: "hello" },
      usage: { inputTokens: 0, outputTokens: 0 },
    };
    expect(response.rawAssistantMessage).toEqual({
      role: "assistant",
      content: "hello",
    });
  });

  test("LLMClient interface has userMessage and toolResultMessages", () => {
    // Verify the interface shape by creating a conforming object
    const client: LLMClient = {
      async chat() {
        return {
          text: "",
          toolCalls: [],
          stopReason: "end_turn",
          rawAssistantMessage: null,
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      },
      userMessage(content: string) {
        return { role: "user", content };
      },
      toolResultMessages(calls: ToolCall[], results: ToolResult[]) {
        return calls.map((c, i) => ({ id: c.id, result: results[i].text }));
      },
    };

    expect(client.userMessage("hi")).toEqual({ role: "user", content: "hi" });
    expect(
      client.toolResultMessages(
        [{ id: "1", name: "test", arguments: {} }],
        [{ text: "ok" }]
      )
    ).toEqual([{ id: "1", result: "ok" }]);
  });
});
