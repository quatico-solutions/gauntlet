import { describe, test, expect } from "bun:test";
import { runAgent } from "../../src/agent/agent";
import { makeRunId } from "../../src/util/id";
import type { LLMClient, AgentResponse, ToolCall, ToolResult } from "../../src/models/provider";
import type { Adapter } from "../../src/adapters/adapter";
import type { EvidenceLogger } from "../../src/evidence/logger";
import type { StoryCard } from "../../src/format/story-card";

const card: StoryCard = {
  id: "test-checkpoint",
  title: "Test scenario",
  status: "ready",
  tags: [],
  description: "A test",
  acceptanceCriteria: ["something works"],
  raw: "",
};

function makeLogger(): EvidenceLogger & { events: Array<{ kind: string; payload: unknown }>; userMessages: Array<{ turn: number; text: string }> } {
  const events: Array<{ kind: string; payload: unknown }> = [];
  const userMessages: Array<{ turn: number; text: string }> = [];
  return {
    screenshots: [],
    artifacts: [],
    captures: [],
    logPath: "/tmp/test.log",
    logTool: () => {},
    logScreenshot: () => "/tmp/shot.png",
    logAction: () => {},
    logRunStart: () => {},
    logSystemPrompt: () => {},
    logUserMessage: (turn: number, text: string) => { userMessages.push({ turn, text }); },
    logLlmRequest: () => {},
    logLlmResponse: () => {},
    logToolCall: () => {},
    logToolResult: () => {},
    logEvent: (kind: string, payload: unknown) => { events.push({ kind, payload }); },
    logRunEnd: () => {},
    events,
    userMessages,
  } as unknown as EvidenceLogger & { events: Array<{ kind: string; payload: unknown }>; userMessages: Array<{ turn: number; text: string }> };
}

function makeAdapter(mutatingNames: Set<string> = new Set(["click", "type"])): Adapter {
  return {
    name: "test",
    toolDefinitions: () => [
      { name: "screenshot", description: "screenshot", parameters: { type: "object", properties: {} } },
      { name: "click", description: "click", parameters: { type: "object", properties: { selector: { type: "string" } }, required: ["selector"] } },
      { name: "type", description: "type", parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
    ],
    executeTool: async (name: string) => ({ text: `${name}-ok` }),
    start: async () => {},
    close: async () => {},
    describeTarget: (t: string) => `target: ${t}`,
    defaultViewport: () => null,
    isMutatingTool: (n: string) => mutatingNames.has(n),
  };
}

interface MockClient extends LLMClient {
  _chatCalls: unknown[][];
  _extraTexts: Array<string | undefined>;
}

function makeClient(responses: AgentResponse[]): MockClient {
  let i = 0;
  const _chatCalls: unknown[][] = [];
  const _extraTexts: Array<string | undefined> = [];
  return {
    async chat(messages) {
      _chatCalls.push(JSON.parse(JSON.stringify(messages)));
      const r = responses[i++];
      if (!r) throw new Error("no more mock responses");
      return r;
    },
    userMessage(content: string) { return { role: "user", content }; },
    toolResultMessages(calls: ToolCall[], results: ToolResult[], extraUserText?: string) {
      _extraTexts.push(extraUserText);
      const msgs: unknown[] = calls.map((c, idx) => ({
        role: "tool_result",
        tool_call_id: c.id,
        content: results[idx].text,
      }));
      if (extraUserText) msgs.push({ role: "user", content: extraUserText });
      return msgs;
    },
    _chatCalls,
    _extraTexts,
  } as MockClient;
}

function clickResponse(turn: number, selector: string): AgentResponse {
  return {
    text: "",
    toolCalls: [{ id: `c${turn}`, name: "click", arguments: { selector } }],
    stopReason: "tool_use",
    rawAssistantMessage: {
      role: "assistant",
      content: [{ type: "tool_use", id: `c${turn}`, name: "click", input: { selector } }],
    },
    usage: { inputTokens: 1, outputTokens: 1 },
  };
}

function reportResponse(): AgentResponse {
  return {
    text: "",
    toolCalls: [{
      id: "rr",
      name: "report_result",
      arguments: { status: "investigate", summary: "stuck", observations: [], reasoning: "circling" },
    }],
    stopReason: "tool_use",
    rawAssistantMessage: { role: "assistant", content: [] },
    usage: { inputTokens: 1, outputTokens: 1 },
  };
}

describe("runAgent — reflection checkpoints", () => {
  test("injects a SYSTEM-REMINDER every reflectionInterval turns", async () => {
    // 6 clicks then a report. Interval=3 → checkpoints after turn 3 and 6.
    const responses: AgentResponse[] = [
      clickResponse(1, "#a"),
      clickResponse(2, "#b"),
      clickResponse(3, "#c"),  // 1st checkpoint emitted with this turn's tool_result
      clickResponse(4, "#d"),
      clickResponse(5, "#e"),
      clickResponse(6, "#f"),  // 2nd checkpoint
      reportResponse(),
    ];
    const client = makeClient(responses);
    const logger = makeLogger();

    await runAgent(card, makeAdapter(), client, logger, "http://x", {
      runId: makeRunId(card.id),
      budgetMs: 600_000,
      reflectionInterval: 3,
    });

    const extras = client._extraTexts;
    // tool result rounds happen on turns 1..6; checkpoint at turns 3 and 6.
    expect(extras).toHaveLength(6);
    expect(extras[0]).toBeUndefined();
    expect(extras[1]).toBeUndefined();
    expect(extras[2]).toContain("<SYSTEM-REMINDER>");
    expect(extras[2]).toContain("Reflection checkpoint");
    expect(extras[3]).toBeUndefined();
    expect(extras[4]).toBeUndefined();
    expect(extras[5]).toContain("<SYSTEM-REMINDER>");

    // Trace at the first checkpoint should list clicks 1..3
    expect(extras[2]).toContain('click(selector="#a")');
    expect(extras[2]).toContain('click(selector="#b")');
    expect(extras[2]).toContain('click(selector="#c")');

    // Trace at the second checkpoint should *include* later actions; the
    // 8-entry window will still include #a since we've only made 6 calls.
    expect(extras[5]).toContain('click(selector="#a")');
    expect(extras[5]).toContain('click(selector="#f")');

    // Evidence: a reflection_checkpoint event per firing.
    const checkpoints = (logger as unknown as { events: Array<{ kind: string; payload: unknown }> })
      .events.filter((e) => e.kind === "reflection_checkpoint");
    expect(checkpoints).toHaveLength(2);

    // The injected text appears as a user_message log row too.
    const userReminders = (logger as unknown as { userMessages: Array<{ turn: number; text: string }> })
      .userMessages.filter((m) => m.text.includes("<SYSTEM-REMINDER>") && m.text.includes("Reflection checkpoint"));
    expect(userReminders).toHaveLength(2);
  });

  test("excludes informational tool calls from the trace", async () => {
    // Adapter says only "click" is mutating; "screenshot" is informational.
    const adapter = makeAdapter(new Set(["click"]));
    const screenshotResp = (turn: number): AgentResponse => ({
      text: "",
      toolCalls: [{ id: `s${turn}`, name: "screenshot", arguments: {} }],
      stopReason: "tool_use",
      rawAssistantMessage: { role: "assistant", content: [] },
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    const responses: AgentResponse[] = [
      clickResponse(1, "#login"),
      screenshotResp(2),
      screenshotResp(3),  // checkpoint fires with this turn's tool_result
      reportResponse(),
    ];
    const client = makeClient(responses);
    await runAgent(card, adapter, client, makeLogger(), "http://x", {
      runId: makeRunId(card.id),
      budgetMs: 600_000,
      reflectionInterval: 3,
    });
    const reminder = client._extraTexts[2]!;
    expect(reminder).toContain('click(selector="#login")');
    expect(reminder).not.toContain("screenshot(");
  });

  test("reflectionInterval=0 disables checkpoints entirely", async () => {
    const responses: AgentResponse[] = [
      clickResponse(1, "#a"),
      clickResponse(2, "#b"),
      clickResponse(3, "#c"),
      clickResponse(4, "#d"),
      reportResponse(),
    ];
    const client = makeClient(responses);
    const logger = makeLogger();

    await runAgent(card, makeAdapter(), client, logger, "http://x", {
      runId: makeRunId(card.id),
      budgetMs: 600_000,
      reflectionInterval: 0,
    });
    expect(client._extraTexts.every((t) => t === undefined)).toBe(true);
    const checkpoints = (logger as unknown as { events: Array<{ kind: string; payload: unknown }> })
      .events.filter((e) => e.kind === "reflection_checkpoint");
    expect(checkpoints).toHaveLength(0);
  });
});
