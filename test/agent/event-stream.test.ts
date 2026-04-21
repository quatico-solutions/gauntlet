import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { EvidenceLogger } from "../../src/evidence/logger";
import { runAgent } from "../../src/agent/agent";
import type { LLMClient, AgentResponse, ToolCall, ToolResult } from "../../src/models/provider";
import type { Adapter } from "../../src/adapters/adapter";
import type { StoryCard } from "../../src/format/story-card";

function readLog(outDir: string): Array<Record<string, unknown>> {
  return readFileSync(join(outDir, "run.jsonl"), "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function makeCard(): StoryCard {
  return {
    id: "card-001",
    title: "t",
    status: "ready",
    tags: [],
    description: "d",
    acceptanceCriteria: [],
    raw: "",
  } as unknown as StoryCard;
}

function makeAdapter(): Adapter {
  return {
    name: "test",
    toolDefinitions: () => [],
    async executeTool(_n, _a, _l): Promise<ToolResult> { return { text: "ok" }; },
    async start() {}, async close() {},
  } as unknown as Adapter;
}

function makeClient(responses: AgentResponse[]): LLMClient {
  let i = 0;
  return {
    async chat() { return responses[i++]; },
    userMessage(content: string) { return { role: "user", content }; },
    toolResultMessages(calls: ToolCall[], results: ToolResult[]) {
      return [{ role: "user", content: calls.map((c, j) => ({ tool_use_id: c.id, text: results[j].text })) }];
    },
  };
}

describe("agent event stream", () => {
  let outDir: string;
  let logger: EvidenceLogger;

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), "gauntlet-agent-"));
    logger = new EvidenceLogger(outDir);
  });
  afterEach(() => rmSync(outDir, { recursive: true, force: true }));

  test("emits llm_request + llm_response per turn with usage and rawAssistantMessage", async () => {
    const rawAssistant = { role: "assistant", content: [{ type: "text", text: "hi" }] };
    const client = makeClient([{
      text: "hi",
      toolCalls: [{ id: "t1", name: "report_result", arguments: { status: "pass", summary: "s", reasoning: "r" } }],
      stopReason: "tool_use",
      rawAssistantMessage: rawAssistant,
      usage: { inputTokens: 100, outputTokens: 20, cacheCreationInputTokens: 50, cacheReadInputTokens: 30 },
    }]);

    await runAgent(makeCard(), makeAdapter(), client, logger, undefined, {
      runId: "card-001_20260421T000000Z_aaaa",
    });

    const rows = readLog(outDir);
    const req = rows.find((r) => r.type === "llm_request");
    const res = rows.find((r) => r.type === "llm_response");
    expect(req).toBeDefined();
    expect(req!.turn).toBe(1);
    expect(req!.messageCount).toBe(1);
    expect(res).toBeDefined();
    expect(res!.turn).toBe(1);
    expect(res!.stopReason).toBe("tool_use");
    expect(res!.text).toBe("hi");
    expect((res!.usage as any).inputTokens).toBe(100);
    expect((res!.usage as any).cacheReadInputTokens).toBe(30);
    expect(res!.rawAssistantMessage).toEqual(rawAssistant);
    expect(Array.isArray(res!.toolCalls)).toBe(true);
    expect((res!.toolCalls as any[])[0].name).toBe("report_result");
  });

  test("emits run_start, system_prompt, user_message as first three rows", async () => {
    const client = makeClient([{
      text: "", toolCalls: [{ id: "t1", name: "report_result", arguments: { status: "pass", summary: "s", reasoning: "r" } }],
      stopReason: "tool_use", rawAssistantMessage: { role: "assistant", content: [] },
      usage: { inputTokens: 10, outputTokens: 5 },
    }]);
    await runAgent(makeCard(), makeAdapter(), client, logger, "http://x", {
      runId: "card-001_20260421T000000Z_aaaa",
    });

    const rows = readLog(outDir);
    expect(rows[0].type).toBe("run_start");
    expect(rows[0].runId).toBe("card-001_20260421T000000Z_aaaa");
    expect(rows[0].cardId).toBe("card-001");
    expect(rows[1].type).toBe("system_prompt");
    expect(typeof rows[1].content).toBe("string");
    expect(rows[2].type).toBe("user_message");
    expect(rows[2].turn).toBe(0);
    expect((rows[2].content as string)).toContain("http://x");
  });
});
