import { describe, test, expect } from "bun:test";
import { runAgent } from "../../src/agent/agent";
import type { LLMClient, AgentResponse, ToolCall, ToolResult } from "../../src/models/provider";
import type { Adapter } from "../../src/adapters/adapter";
import type { EvidenceLogger } from "../../src/evidence/logger";
import type { StoryCard } from "../../src/format/story-card";

const card: StoryCard = {
  id: "test-001",
  title: "Test scenario",
  status: "ready",
  tags: [],
  description: "A test",
  acceptanceCriteria: ["something works"],
  raw: "",
};

function makeMockLogger(): EvidenceLogger {
  return {
    screenshots: [],
    logPath: "/tmp/test.log",
    logTool: () => {},
    logScreenshot: () => "/tmp/shot.png",
  } as unknown as EvidenceLogger;
}

function makeMockAdapter(
  toolResults: Record<string, string> = {}
): Adapter {
  return {
    toolDefinitions: () => [
      {
        name: "screenshot",
        description: "Take a screenshot",
        parameters: { type: "object", properties: {} },
      },
    ],
    executeTool: async (name: string) => {
      if (name in toolResults) return { text: toolResults[name] };
      return { text: `result of ${name}` };
    },
    start: async () => {},
    close: async () => {},
  };
}

// A client that uses simple {role, content} messages internally
function makeMockClient(responses: AgentResponse[]): LLMClient {
  let callIndex = 0;
  const chatCalls: unknown[][] = [];

  return {
    async chat(messages) {
      chatCalls.push([...messages]);
      const response = responses[callIndex++];
      if (!response) throw new Error("No more mock responses");
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
    _chatCalls: chatCalls,
  } as LLMClient & { _chatCalls: unknown[][] };
}

describe("runAgent", () => {
  test("completes when agent calls report_result", async () => {
    const client = makeMockClient([
      // Turn 1: take a screenshot
      {
        text: "Let me take a screenshot",
        toolCalls: [{ id: "call_1", name: "screenshot", arguments: {} }],
        stopReason: "tool_use",
        rawAssistantMessage: {
          role: "assistant",
          content: [
            { type: "text", text: "Let me take a screenshot" },
            { type: "tool_use", id: "call_1", name: "screenshot", input: {} },
          ],
        },
        usage: { inputTokens: 100, outputTokens: 50 },
      },
      // Turn 2: report result
      {
        text: "Everything looks good",
        toolCalls: [
          {
            id: "call_2",
            name: "report_result",
            arguments: {
              status: "pass",
              summary: "All good",
              reasoning: "Screenshot shows correct UI",
            },
          },
        ],
        stopReason: "tool_use",
        rawAssistantMessage: { role: "assistant", content: [] },
        usage: { inputTokens: 200, outputTokens: 75 },
      },
    ]);

    const result = await runAgent(card, makeMockAdapter(), client, makeMockLogger());

    expect(result.status).toBe("pass");
    expect(result.summary).toBe("All good");
    expect(result.scenario).toBe("test-001");
    expect(result.usage).toEqual({
      inputTokens: 300,
      outputTokens: 125,
      turns: 2,
    });
  });

  test("passes tool results back to the client", async () => {
    const client = makeMockClient([
      {
        text: "",
        toolCalls: [{ id: "call_1", name: "screenshot", arguments: {} }],
        stopReason: "tool_use",
        rawAssistantMessage: { role: "assistant", content: "raw_msg_1" },
        usage: { inputTokens: 0, outputTokens: 0 },
      },
      {
        text: "",
        toolCalls: [
          {
            id: "call_2",
            name: "report_result",
            arguments: {
              status: "pass",
              summary: "done",
              reasoning: "done",
            },
          },
        ],
        stopReason: "tool_use",
        rawAssistantMessage: { role: "assistant", content: "raw_msg_2" },
        usage: { inputTokens: 0, outputTokens: 0 },
      },
    ]);

    await runAgent(card, makeMockAdapter(), client, makeMockLogger());

    // Second chat() call should have: initial user message + rawAssistantMessage + tool result
    const secondCallMessages = (client as any)._chatCalls[1];
    expect(secondCallMessages).toHaveLength(3);
    // First message: user message from client.userMessage()
    expect(secondCallMessages[0]).toEqual({
      role: "user",
      content: "Begin testing. Use the available tools to interact with the application.",
    });
    // Second: raw assistant message preserved from response
    expect(secondCallMessages[1]).toEqual({
      role: "assistant",
      content: "raw_msg_1",
    });
    // Third: tool result from client.toolResultMessages()
    expect(secondCallMessages[2]).toEqual({
      role: "tool_result",
      tool_call_id: "call_1",
      content: "result of screenshot",
    });
  });

  test("handles multi-turn tool use conversation", async () => {
    const client = makeMockClient([
      // Turn 1: take a screenshot
      {
        text: "I'll take a screenshot first",
        toolCalls: [{ id: "call_1", name: "screenshot", arguments: {} }],
        stopReason: "tool_use",
        rawAssistantMessage: { role: "assistant", content: "raw_turn_1" },
        usage: { inputTokens: 0, outputTokens: 0 },
      },
      // Turn 2: click something based on what was seen
      {
        text: "I see the page, let me click",
        toolCalls: [
          { id: "call_2", name: "click", arguments: { selector: ".btn" } },
        ],
        stopReason: "tool_use",
        rawAssistantMessage: { role: "assistant", content: "raw_turn_2" },
        usage: { inputTokens: 0, outputTokens: 0 },
      },
      // Turn 3: report result with observations
      {
        text: "Everything checks out",
        toolCalls: [
          {
            id: "call_3",
            name: "report_result",
            arguments: {
              status: "pass",
              summary: "UI renders correctly",
              reasoning: "Screenshot confirmed layout, button click worked",
              observations: [
                { kind: "ux", description: "Button contrast could be higher" },
                { kind: "suggestion", description: "Add loading indicator" },
              ],
            },
          },
        ],
        stopReason: "tool_use",
        rawAssistantMessage: { role: "assistant", content: "raw_turn_3" },
        usage: { inputTokens: 0, outputTokens: 0 },
      },
    ]);

    const adapter = makeMockAdapter({
      screenshot: "screenshot_base64_data",
      click: "clicked .btn",
    });

    const result = await runAgent(card, adapter, client, makeMockLogger());

    expect(result.status).toBe("pass");
    expect(result.summary).toBe("UI renders correctly");
    expect(result.observations).toHaveLength(2);
    expect(result.observations[0]).toEqual({
      kind: "ux",
      description: "Button contrast could be higher",
    });
    expect(result.observations[1]).toEqual({
      kind: "suggestion",
      description: "Add loading indicator",
    });

    // Verify message array grew correctly across turns
    const chatCalls = (client as any)._chatCalls;
    expect(chatCalls).toHaveLength(3);

    // Turn 1: just the initial user message
    expect(chatCalls[0]).toHaveLength(1);

    // Turn 2: initial user + raw assistant turn 1 + tool result for screenshot
    expect(chatCalls[1]).toHaveLength(3);
    expect(chatCalls[1][2]).toEqual({
      role: "tool_result",
      tool_call_id: "call_1",
      content: "screenshot_base64_data",
    });

    // Turn 3: previous 3 + raw assistant turn 2 + tool result for click = 5
    expect(chatCalls[2]).toHaveLength(5);
    expect(chatCalls[2][4]).toEqual({
      role: "tool_result",
      tool_call_id: "call_2",
      content: "clicked .btn",
    });
  });

  test("accumulates token usage across turns", async () => {
    const client = makeMockClient([
      {
        text: "Taking screenshot",
        toolCalls: [{ id: "call_1", name: "screenshot", arguments: {} }],
        stopReason: "tool_use",
        rawAssistantMessage: { role: "assistant", content: "turn1" },
        usage: { inputTokens: 100, outputTokens: 20 },
      },
      {
        text: "Taking another screenshot",
        toolCalls: [{ id: "call_2", name: "screenshot", arguments: {} }],
        stopReason: "tool_use",
        rawAssistantMessage: { role: "assistant", content: "turn2" },
        usage: { inputTokens: 250, outputTokens: 30 },
      },
      {
        text: "Done",
        toolCalls: [
          {
            id: "call_3",
            name: "report_result",
            arguments: {
              status: "pass",
              summary: "All good",
              reasoning: "Checked twice",
            },
          },
        ],
        stopReason: "tool_use",
        rawAssistantMessage: { role: "assistant", content: "turn3" },
        usage: { inputTokens: 400, outputTokens: 50 },
      },
    ]);

    const result = await runAgent(card, makeMockAdapter(), client, makeMockLogger());

    expect(result.usage).toEqual({
      inputTokens: 750,
      outputTokens: 100,
      turns: 3,
    });
  });

  test("handles tool execution errors gracefully", async () => {
    const failingAdapter = makeMockAdapter();
    failingAdapter.executeTool = async (name: string) => {
      if (name === "click") throw new Error("Element not found: .missing");
      return { text: `result of ${name}` };
    };

    const client = makeMockClient([
      // Turn 1: try to click a bad selector
      {
        text: "Let me click",
        toolCalls: [
          { id: "call_1", name: "click", arguments: { selector: ".missing" } },
        ],
        stopReason: "tool_use",
        rawAssistantMessage: { role: "assistant", content: "raw" },
        usage: { inputTokens: 0, outputTokens: 0 },
      },
      // Turn 2: agent sees the error, reports failure
      {
        text: "Click failed",
        toolCalls: [
          {
            id: "call_2",
            name: "report_result",
            arguments: {
              status: "fail",
              summary: "Required element not found",
              reasoning: "Click on .missing failed with element not found error",
            },
          },
        ],
        stopReason: "tool_use",
        rawAssistantMessage: { role: "assistant", content: "raw2" },
        usage: { inputTokens: 0, outputTokens: 0 },
      },
    ]);

    const result = await runAgent(
      card,
      failingAdapter,
      client,
      makeMockLogger()
    );

    expect(result.status).toBe("fail");
    expect(result.summary).toBe("Required element not found");

    // Verify the error was passed back as a tool result, not thrown
    const secondCallMessages = (client as any)._chatCalls[1];
    expect(secondCallMessages[2]).toEqual({
      role: "tool_result",
      tool_call_id: "call_1",
      content: "Error: Element not found: .missing",
    });
  });
});
