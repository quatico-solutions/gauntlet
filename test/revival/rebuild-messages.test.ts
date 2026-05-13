import { describe, test, expect, afterEach } from "bun:test";
import { rebuildMessages } from "../../src/revival/rebuild-messages";
import {
  makeRunDir,
  cleanup,
  makeFakeAnthropicClient,
  writeScreenshot,
  writeArtifact,
  writeCapture,
  ONE_PIXEL_PNG,
} from "./fixtures";

const cleanups: string[] = [];
afterEach(() => {
  while (cleanups.length) cleanup(cleanups.pop()!);
});

const minimalRunStart = {
  type: "run_start", runId: "r1", cardId: "c1",
  model: "claude-sonnet-4-6", adapter: "web", provider: "anthropic",
  target: "x", budgetMs: 60000, reflectionInterval: 0,
  toolTimeoutMs: 30000, contextTreeBytes: 0,
};

describe("rebuildMessages — happy path", () => {
  test("returns systemPrompt, messages, modelId, adapterName for a 2-turn run", () => {
    const dir = makeRunDir([
      minimalRunStart,
      { type: "system_prompt", content: "You are a test agent." },
      { type: "tool_definitions", tools: [
        { name: "click", description: "Click", parameters: { type: "object" } },
        { name: "report_result", description: "Report", parameters: { type: "object" } },
      ]},
      { type: "user_message", turn: 0, content: "Test the login page at http://x" },
      { type: "llm_request", turn: 1, messageCount: 1 },
      { type: "llm_response", turn: 1, stopReason: "tool_use", text: "",
        thinking: [],
        toolCalls: [{ id: "t1", name: "click", arguments: { selector: "#login" } }],
        usage: { inputTokens: 100, outputTokens: 20 },
        rawAssistantMessage: { role: "assistant", content: [
          { type: "tool_use", id: "t1", name: "click", input: { selector: "#login" } },
        ]},
      },
      { type: "tool_call", turn: 1, toolUseId: "t1", name: "click", arguments: { selector: "#login" } },
      { type: "tool_result", turn: 1, toolUseId: "t1", name: "click", durationMs: 5, text: "ok", error: false },
      { type: "run_end", status: "pass", summary: "done", reasoning: "done", observationCount: 0, observations: [], durationMs: 100, usage: { inputTokens: 100, outputTokens: 20, turns: 1 } },
    ]);
    cleanups.push(dir);

    const result = rebuildMessages(dir, makeFakeAnthropicClient());
    expect(result.modelId).toBe("claude-sonnet-4-6");
    expect(result.adapterName).toBe("web");
    expect(result.systemPrompt).toContain("You are a test agent.");
    expect(result.systemPrompt).toContain("REVIVAL");
    expect(result.messages.length).toBeGreaterThanOrEqual(3);
    const m0 = result.messages[0] as { role: string };
    expect(m0.role).toBe("user");
    const m1 = result.messages[1] as { role: string };
    expect(m1.role).toBe("assistant");
    expect(result.warnings).toEqual([]);
  });
});

describe("rebuildMessages — image rehydration", () => {
  test("reads screenshot bytes from disk and slots them into the tool_result block", () => {
    const dir = makeRunDir([
      minimalRunStart,
      { type: "system_prompt", content: "sys" },
      { type: "tool_definitions", tools: [{ name: "screenshot", description: "shoot", parameters: { type: "object" } }] },
      { type: "user_message", turn: 0, content: "go" },
      { type: "llm_response", turn: 1, stopReason: "tool_use", text: "", thinking: [],
        toolCalls: [{ id: "t1", name: "screenshot", arguments: {} }],
        usage: { inputTokens: 10, outputTokens: 5 },
        rawAssistantMessage: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "screenshot", input: {} }] },
      },
      { type: "tool_call", turn: 1, toolUseId: "t1", name: "screenshot", arguments: {} },
      { type: "tool_result", turn: 1, toolUseId: "t1", name: "screenshot", durationMs: 5, text: "", image: "screenshots/001.png", mediaType: "image/png", error: false },
    ]);
    cleanups.push(dir);
    writeScreenshot(dir, "001.png", ONE_PIXEL_PNG);

    const result = rebuildMessages(dir, makeFakeAnthropicClient());
    const userTurn = result.messages.find(
      (m) => (m as { role?: string }).role === "user" && Array.isArray((m as { content: unknown }).content),
    ) as { role: string; content: Array<{ type: string; tool_use_id: string; content: Array<{ type: string; source?: { type: string; media_type: string; data: string } }> }> };
    expect(userTurn).toBeDefined();
    const block = userTurn.content[0];
    expect(block.type).toBe("tool_result");
    const imageBlock = block.content.find((c) => c.type === "image");
    expect(imageBlock).toBeDefined();
    expect(imageBlock!.source!.media_type).toBe("image/png");
    expect(imageBlock!.source!.data).toBe(ONE_PIXEL_PNG.toString("base64"));
  });

  test("warns and defaults to image/png when mediaType is missing", () => {
    const dir = makeRunDir([
      minimalRunStart,
      { type: "system_prompt", content: "sys" },
      { type: "tool_definitions", tools: [{ name: "screenshot", description: "shoot", parameters: { type: "object" } }] },
      { type: "user_message", turn: 0, content: "go" },
      { type: "llm_response", turn: 1, stopReason: "tool_use", text: "", thinking: [],
        toolCalls: [{ id: "t1", name: "screenshot", arguments: {} }],
        usage: { inputTokens: 10, outputTokens: 5 },
        rawAssistantMessage: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "screenshot", input: {} }] },
      },
      { type: "tool_call", turn: 1, toolUseId: "t1", name: "screenshot", arguments: {} },
      { type: "tool_result", turn: 1, toolUseId: "t1", name: "screenshot", durationMs: 5, text: "", image: "screenshots/001.png", error: false },
    ]);
    cleanups.push(dir);
    writeScreenshot(dir, "001.png", ONE_PIXEL_PNG);

    const result = rebuildMessages(dir, makeFakeAnthropicClient());
    expect(result.warnings.some((w) => w.includes("mediaType"))).toBe(true);
  });
});

describe("rebuildMessages — text rehydration", () => {
  test("reads the artifact when tool_result.textTruncated is true", () => {
    const dir = makeRunDir([
      minimalRunStart,
      { type: "system_prompt", content: "sys" },
      { type: "tool_definitions", tools: [{ name: "extract", description: "extract", parameters: { type: "object" } }] },
      { type: "user_message", turn: 0, content: "go" },
      { type: "llm_response", turn: 1, stopReason: "tool_use", text: "", thinking: [],
        toolCalls: [{ id: "t1", name: "extract", arguments: {} }],
        usage: { inputTokens: 10, outputTokens: 5 },
        rawAssistantMessage: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "extract", input: {} }] },
      },
      { type: "tool_call", turn: 1, toolUseId: "t1", name: "extract", arguments: {} },
      { type: "tool_result", turn: 1, toolUseId: "t1", name: "extract", durationMs: 5, text: "", textTruncated: true, textBytes: 1024, artifact: "artifacts/001.txt", error: false },
    ]);
    cleanups.push(dir);
    writeArtifact(dir, "001.txt", "THE FULL TEXT THE AGENT SAW");

    const result = rebuildMessages(dir, makeFakeAnthropicClient());
    const userTurn = result.messages[result.messages.length - 1] as { content: Array<{ content: string }> };
    expect(userTurn.content[0].content).toBe("THE FULL TEXT THE AGENT SAW");
  });
});

describe("rebuildMessages — TUI capture rehydration", () => {
  test("reads the .ansi file when capturePath is set", () => {
    const dir = makeRunDir([
      { ...minimalRunStart, adapter: "tui" },
      { type: "system_prompt", content: "sys" },
      { type: "tool_definitions", tools: [{ name: "read_screen", description: "read", parameters: { type: "object" } }] },
      { type: "user_message", turn: 0, content: "go" },
      { type: "llm_response", turn: 1, stopReason: "tool_use", text: "", thinking: [],
        toolCalls: [{ id: "t1", name: "read_screen", arguments: {} }],
        usage: { inputTokens: 10, outputTokens: 5 },
        rawAssistantMessage: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "read_screen", input: {} }] },
      },
      { type: "tool_call", turn: 1, toolUseId: "t1", name: "read_screen", arguments: {} },
      { type: "tool_result", turn: 1, toolUseId: "t1", name: "read_screen", durationMs: 5, text: "captures/000.ansi", capturePath: "captures/000.ansi", error: false },
    ]);
    cleanups.push(dir);
    writeCapture(dir, "000.ansi", "RAW ANSI SCREEN CONTENT");

    const result = rebuildMessages(dir, makeFakeAnthropicClient());
    const userTurn = result.messages[result.messages.length - 1] as { content: Array<{ content: string }> };
    expect(userTurn.content[0].content).toBe("RAW ANSI SCREEN CONTENT");
  });
});
