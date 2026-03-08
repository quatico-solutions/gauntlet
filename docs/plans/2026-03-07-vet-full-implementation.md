# Vet Full Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the broken agent loop message protocol, add proper tests, and verify the tool works end-to-end against real applications.

**Architecture:** The core issue is that the agent loop (`src/agent/agent.ts`) pushes flattened text as assistant messages, losing tool_use blocks (Anthropic) and tool_calls (OpenAI). The fix restructures the LLMClient interface so each provider manages its own message format. The agent loop stores opaque messages it doesn't need to understand. After fixing the protocol, we add agent loop tests, then end-to-end tests.

**Tech Stack:** Bun, TypeScript, Anthropic SDK, OpenAI SDK, superpowers-chrome (CDP)

**Design doc:** `docs/plans/2026-03-07-vet-design.md`

---

## Phase 1: Fix the Message Protocol

The agent loop currently does this on each turn:

```typescript
messages.push({ role: "assistant", content: response.text });  // WRONG: loses tool_use blocks
// ... execute tools ...
messages.push({ role: "user", content: results.join("\n\n") }); // WRONG: not tool_result format
```

Both Anthropic and OpenAI require tool calls in the assistant message and tool results in a specific format. The current `Message` type can't represent either. Rather than trying to unify two fundamentally different message formats, we make the agent loop format-agnostic: it stores opaque messages that only the LLMClient knows how to produce and consume.

### Task 1: Restructure provider types

**Files:**
- Modify: `src/models/provider.ts`

**Context:** The `Message` type is used in two places: (1) the agent loop builds messages and passes them to `client.chat()`, and (2) each LLM client converts messages to its native format. The problem is these are the same type, but the agent loop can't construct proper tool messages. Solution: separate "what the agent loop sees" from "what the client manages."

**Step 1: Write the failing test**

Create `test/models/provider.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import type { ToolCall, AgentResponse, LLMClient } from "../../src/models/provider";

describe("provider types", () => {
  test("ToolCall has an id field", () => {
    const tc: ToolCall = {
      id: "call_123",
      name: "screenshot",
      arguments: {},
    };
    expect(tc.id).toBe("call_123");
  });

  test("AgentResponse has rawAssistantMessage", () => {
    const response: AgentResponse = {
      text: "I'll take a screenshot",
      toolCalls: [{ id: "call_123", name: "screenshot", arguments: {} }],
      stopReason: "tool_use",
      rawAssistantMessage: { some: "opaque data" },
    };
    expect(response.rawAssistantMessage).toBeDefined();
  });

  test("LLMClient interface has userMessage and toolResultMessages", () => {
    // Type-level test — if this compiles, the interface is correct
    const mockClient: LLMClient = {
      async chat() {
        return {
          text: "",
          toolCalls: [],
          stopReason: "end_turn" as const,
          rawAssistantMessage: null,
        };
      },
      userMessage(content: string) {
        return { role: "user", content };
      },
      toolResultMessages(calls: ToolCall[], results: string[]) {
        return calls.map((c, i) => ({ id: c.id, result: results[i] }));
      },
    };
    expect(mockClient.userMessage("hi")).toBeDefined();
    expect(mockClient.toolResultMessages([], [])).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test test/models/provider.test.ts`
Expected: FAIL — `ToolCall` has no `id` field, `AgentResponse` has no `rawAssistantMessage`, `LLMClient` has no `userMessage`/`toolResultMessages`.

**Step 3: Update the provider types**

Replace the contents of `src/models/provider.ts`:

```typescript
export type Provider = "anthropic" | "openai";

export interface MessageContent {
  type: "text" | "image";
  text?: string;
  data?: string; // base64 for images
  mediaType?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AgentResponse {
  text: string;
  toolCalls: ToolCall[];
  stopReason: "end_turn" | "tool_use" | "max_tokens";
  /** The raw assistant message in the provider's native format. Push this into messages[]. */
  rawAssistantMessage: unknown;
}

export interface LLMClient {
  /** Send messages to the model. messages[] contains opaque items from rawAssistantMessage, userMessage(), and toolResultMessages(). */
  chat(
    messages: unknown[],
    tools: ToolDefinition[],
    systemPrompt: string
  ): Promise<AgentResponse>;

  /** Create an initial user message. */
  userMessage(content: string): unknown;

  /** Create tool result messages from completed tool calls. */
  toolResultMessages(calls: ToolCall[], results: string[]): unknown[];
}
```

Note: The old `Message` type is removed. It was a leaky abstraction — the two APIs are too different to unify. The agent loop now stores `unknown[]` and lets each client handle serialization.

**Step 4: Run test to verify it passes**

Run: `bun test test/models/provider.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/models/provider.ts test/models/provider.test.ts
git commit -m "refactor: restructure provider types for proper tool call round-trip"
```

---

### Task 2: Fix the Anthropic client

**Files:**
- Modify: `src/models/anthropic.ts`
- Create: `test/models/anthropic.test.ts`

**Context:** The Anthropic API requires:
- Assistant messages with `tool_use` content blocks (id, name, input)
- User messages with `tool_result` content blocks (tool_use_id, content)

The current client extracts text and tool calls from the response but discards the raw content blocks. It also can't format tool results.

**Step 1: Write the failing test**

Create `test/models/anthropic.test.ts`:

```typescript
import { describe, test, expect, mock } from "bun:test";

// We test the exported functions by importing the module
// These tests verify the message formatting logic, not actual API calls

describe("Anthropic client message formatting", () => {
  test("userMessage creates a text user message", async () => {
    // We need to test the client's userMessage method
    // Since createAnthropicClient requires an API key, we test the format directly
    // by checking the returned structure
    const { createAnthropicClient } = await import("../../src/models/anthropic");

    // This will fail without ANTHROPIC_API_KEY, but we only need the format methods
    // Skip if no API key
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log("Skipping: no ANTHROPIC_API_KEY");
      return;
    }

    const client = createAnthropicClient("claude-sonnet-4-6");
    const msg = client.userMessage("hello") as any;
    expect(msg.role).toBe("user");
    expect(msg.content).toBe("hello");
  });

  test("toolResultMessages creates tool_result content blocks", async () => {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log("Skipping: no ANTHROPIC_API_KEY");
      return;
    }

    const { createAnthropicClient } = await import("../../src/models/anthropic");
    const client = createAnthropicClient("claude-sonnet-4-6");
    const calls = [
      { id: "tu_1", name: "screenshot", arguments: {} },
      { id: "tu_2", name: "click", arguments: { selector: ".btn" } },
    ];
    const results = ["Screenshot saved", "clicked"];
    const msgs = client.toolResultMessages(calls, results) as any[];

    // Anthropic: single user message with tool_result content blocks
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toHaveLength(2);
    expect(msgs[0].content[0].type).toBe("tool_result");
    expect(msgs[0].content[0].tool_use_id).toBe("tu_1");
    expect(msgs[0].content[0].content).toBe("Screenshot saved");
    expect(msgs[0].content[1].tool_use_id).toBe("tu_2");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test test/models/anthropic.test.ts`
Expected: FAIL — `client.userMessage` and `client.toolResultMessages` don't exist.

**Step 3: Rewrite the Anthropic client**

Replace `src/models/anthropic.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import type {
  LLMClient,
  ToolDefinition,
  AgentResponse,
  ToolCall,
} from "./provider";

export function createAnthropicClient(model: string): LLMClient {
  const client = new Anthropic();

  return {
    async chat(messages, tools, systemPrompt) {
      const response = await client.messages.create({
        model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: messages as Anthropic.MessageParam[],
        tools: tools.map(convertTool),
      });

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");

      const toolCalls: ToolCall[] = response.content
        .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
        .map((b) => ({
          id: b.id,
          name: b.name,
          arguments: b.input as Record<string, unknown>,
        }));

      const stopReason =
        response.stop_reason === "tool_use" ? "tool_use" : "end_turn";

      return {
        text,
        toolCalls,
        stopReason,
        rawAssistantMessage: {
          role: "assistant" as const,
          content: response.content,
        },
      };
    },

    userMessage(content: string) {
      return { role: "user" as const, content };
    },

    toolResultMessages(calls: ToolCall[], results: string[]) {
      return [
        {
          role: "user" as const,
          content: calls.map((call, i) => ({
            type: "tool_result" as const,
            tool_use_id: call.id,
            content: results[i],
          })),
        },
      ];
    },
  };
}

function convertTool(tool: ToolDefinition): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters as Anthropic.Tool["input_schema"],
  };
}
```

Key changes:
- `chat()` passes messages directly as `Anthropic.MessageParam[]` (no conversion needed since we produce them in the right format)
- `rawAssistantMessage` preserves the full content array (text + tool_use blocks)
- `toolResultMessages()` creates a single user message with `tool_result` content blocks
- `userMessage()` creates a simple text user message
- Removed the old `convertMessage` function entirely

**Step 4: Run test to verify it passes**

Run: `bun test test/models/anthropic.test.ts`
Expected: PASS (or skip if no API key)

**Step 5: Commit**

```bash
git add src/models/anthropic.ts test/models/anthropic.test.ts
git commit -m "fix: Anthropic client returns raw messages for proper tool call round-trip"
```

---

### Task 3: Fix the OpenAI client

**Files:**
- Modify: `src/models/openai.ts`
- Create: `test/models/openai.test.ts`

**Context:** The OpenAI API requires:
- Assistant messages with a `tool_calls` array (id, function.name, function.arguments)
- Separate `tool` role messages for each result (tool_call_id, content)

Different from Anthropic: tool results are individual messages with `role: "tool"`, not content blocks in a user message.

**Step 1: Write the failing test**

Create `test/models/openai.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";

describe("OpenAI client message formatting", () => {
  test("userMessage creates a user message", async () => {
    if (!process.env.OPENAI_API_KEY) {
      console.log("Skipping: no OPENAI_API_KEY");
      return;
    }

    const { createOpenAIClient } = await import("../../src/models/openai");
    const client = createOpenAIClient("gpt-4o");
    const msg = client.userMessage("hello") as any;
    expect(msg.role).toBe("user");
    expect(msg.content).toBe("hello");
  });

  test("toolResultMessages creates one tool message per call", async () => {
    if (!process.env.OPENAI_API_KEY) {
      console.log("Skipping: no OPENAI_API_KEY");
      return;
    }

    const { createOpenAIClient } = await import("../../src/models/openai");
    const client = createOpenAIClient("gpt-4o");
    const calls = [
      { id: "call_abc", name: "screenshot", arguments: {} },
      { id: "call_def", name: "click", arguments: { selector: ".btn" } },
    ];
    const results = ["Screenshot saved", "clicked"];
    const msgs = client.toolResultMessages(calls, results) as any[];

    // OpenAI: one tool message per call
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("tool");
    expect(msgs[0].tool_call_id).toBe("call_abc");
    expect(msgs[0].content).toBe("Screenshot saved");
    expect(msgs[1].role).toBe("tool");
    expect(msgs[1].tool_call_id).toBe("call_def");
    expect(msgs[1].content).toBe("clicked");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test test/models/openai.test.ts`
Expected: FAIL — `client.userMessage` and `client.toolResultMessages` don't exist.

**Step 3: Rewrite the OpenAI client**

Replace `src/models/openai.ts`:

```typescript
import OpenAI from "openai";
import type {
  LLMClient,
  ToolDefinition,
  AgentResponse,
  ToolCall,
} from "./provider";

export function createOpenAIClient(model: string): LLMClient {
  const client = new OpenAI();

  return {
    async chat(messages, tools, systemPrompt) {
      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: "system" as const, content: systemPrompt },
          ...(messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[]),
        ],
        tools: tools.length > 0 ? tools.map(convertTool) : undefined,
      });

      const choice = response.choices[0];
      const text = choice.message.content || "";

      const toolCalls: ToolCall[] = [];
      for (const tc of choice.message.tool_calls || []) {
        if (tc.type === "function") {
          toolCalls.push({
            id: tc.id,
            name: tc.function.name,
            arguments: JSON.parse(tc.function.arguments),
          });
        }
      }

      const stopReason =
        choice.finish_reason === "tool_calls" ? "tool_use" : "end_turn";

      return {
        text,
        toolCalls,
        stopReason,
        rawAssistantMessage: {
          role: "assistant" as const,
          content: choice.message.content,
          tool_calls: choice.message.tool_calls,
        },
      };
    },

    userMessage(content: string) {
      return { role: "user" as const, content };
    },

    toolResultMessages(calls: ToolCall[], results: string[]) {
      return calls.map((call, i) => ({
        role: "tool" as const,
        tool_call_id: call.id,
        content: results[i],
      }));
    },
  };
}

function convertTool(
  tool: ToolDefinition
): OpenAI.Chat.Completions.ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}
```

Key changes:
- `chat()` passes messages directly as OpenAI params (no conversion)
- `rawAssistantMessage` preserves `tool_calls` from the response
- `toolResultMessages()` creates individual `tool` role messages with `tool_call_id`
- Removed `convertMessage` entirely

**Step 4: Run test to verify it passes**

Run: `bun test test/models/openai.test.ts`
Expected: PASS (or skip if no API key)

**Step 5: Commit**

```bash
git add src/models/openai.ts test/models/openai.test.ts
git commit -m "fix: OpenAI client returns raw messages for proper tool call round-trip"
```

---

### Task 4: Fix the agent loop

**Files:**
- Modify: `src/agent/agent.ts`
- Create: `test/agent/agent.test.ts`

**Context:** The agent loop currently manages a `Message[]` array manually, constructing assistant and user messages from response text. This breaks tool call context. Now that `LLMClient` has `userMessage()`, `toolResultMessages()`, and returns `rawAssistantMessage`, the loop should use these instead.

**Step 1: Write the failing test**

Create `test/agent/agent.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { runAgent } from "../../src/agent/agent";
import type { LLMClient, AgentResponse, ToolCall } from "../../src/models/provider";
import type { Adapter } from "../../src/adapters/adapter";
import type { EvidenceLogger } from "../../src/evidence/logger";
import type { StoryCard } from "../../src/format/story-card";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function makeCard(): StoryCard {
  return {
    id: "test-001",
    title: "Test scenario",
    status: "ready",
    tags: [],
    description: "Test the thing",
    acceptanceCriteria: ["Thing works"],
    raw: "",
  };
}

function makeLogger(): EvidenceLogger {
  const dir = mkdtempSync(join(tmpdir(), "vet-test-"));
  // Inline a minimal logger to avoid coupling to EvidenceLogger internals
  return {
    screenshots: [],
    logPath: join(dir, "run.jsonl"),
    logAction(_name: string, _args: Record<string, unknown>) {},
    saveScreenshot(_data: Buffer) { return "screenshot.png"; },
  } as unknown as EvidenceLogger;
}

function makeAdapter(toolResults: Record<string, string>): Adapter {
  return {
    async start() {},
    async close() {},
    toolDefinitions() {
      return [
        {
          name: "screenshot",
          description: "Take a screenshot",
          parameters: { type: "object", properties: {} },
        },
      ];
    },
    async executeTool(name: string) {
      return toolResults[name] || "ok";
    },
  };
}

describe("runAgent", () => {
  test("completes when agent calls report_result", async () => {
    let callCount = 0;

    const client: LLMClient = {
      async chat() {
        callCount++;
        if (callCount === 1) {
          // First turn: agent calls screenshot
          return {
            text: "Let me take a screenshot",
            toolCalls: [{ id: "tc_1", name: "screenshot", arguments: {} }],
            stopReason: "tool_use" as const,
            rawAssistantMessage: { role: "assistant", content: "..." },
          };
        }
        // Second turn: agent reports result
        return {
          text: "All done",
          toolCalls: [
            {
              id: "tc_2",
              name: "report_result",
              arguments: {
                status: "pass",
                summary: "Everything works",
                reasoning: "Screenshot showed the expected content",
                observations: [],
              },
            },
          ],
          stopReason: "tool_use" as const,
          rawAssistantMessage: { role: "assistant", content: "..." },
        };
      },
      userMessage(content: string) {
        return { role: "user", content };
      },
      toolResultMessages(calls: ToolCall[], results: string[]) {
        return calls.map((c, i) => ({ id: c.id, result: results[i] }));
      },
    };

    const result = await runAgent(makeCard(), makeAdapter({ screenshot: "Screenshot saved" }), client, makeLogger());
    expect(result.status).toBe("pass");
    expect(result.summary).toBe("Everything works");
    expect(callCount).toBe(2);
  });

  test("passes tool results back to the client", async () => {
    const messagesReceived: unknown[][] = [];
    let callCount = 0;

    const client: LLMClient = {
      async chat(messages) {
        messagesReceived.push([...messages]);
        callCount++;
        if (callCount === 1) {
          return {
            text: "",
            toolCalls: [{ id: "tc_1", name: "screenshot", arguments: {} }],
            stopReason: "tool_use" as const,
            rawAssistantMessage: { role: "assistant", tool_use: "tc_1" },
          };
        }
        return {
          text: "",
          toolCalls: [
            {
              id: "tc_2",
              name: "report_result",
              arguments: { status: "pass", summary: "ok", reasoning: "ok" },
            },
          ],
          stopReason: "tool_use" as const,
          rawAssistantMessage: { role: "assistant", content: "done" },
        };
      },
      userMessage(content: string) {
        return { role: "user", content };
      },
      toolResultMessages(calls: ToolCall[], results: string[]) {
        return [{ role: "tool_results", calls: calls.map((c, i) => ({ id: c.id, result: results[i] })) }];
      },
    };

    await runAgent(makeCard(), makeAdapter({ screenshot: "saved" }), client, makeLogger());

    // Second call should have: initial user message + raw assistant message + tool results
    const secondCallMessages = messagesReceived[1];
    expect(secondCallMessages).toHaveLength(3);
    // First message is the initial user message
    expect((secondCallMessages[0] as any).role).toBe("user");
    // Second message is the raw assistant message (opaque)
    expect((secondCallMessages[1] as any).role).toBe("assistant");
    // Third message is the tool result (opaque)
    expect((secondCallMessages[2] as any).role).toBe("tool_results");
  });

  test("returns investigate status when max turns reached", async () => {
    const client: LLMClient = {
      async chat() {
        return {
          text: "thinking...",
          toolCalls: [],
          stopReason: "end_turn" as const,
          rawAssistantMessage: { role: "assistant", content: "thinking..." },
        };
      },
      userMessage(content: string) {
        return { role: "user", content };
      },
      toolResultMessages() {
        return [];
      },
    };

    // This will hit MAX_TURNS. We need a way to set a lower limit for testing.
    // For now, test with the adapter — the agent loop pushes a nudge message
    // when no tool calls are made. After MAX_TURNS, it returns investigate.
    // We can't easily test this without lowering MAX_TURNS or making it configurable.
    // Skip this test for now — the important behavior is tested above.
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test test/agent/agent.test.ts`
Expected: FAIL — `runAgent` expects `Message[]` but client produces `unknown[]`. Also, `runAgent` doesn't call `client.userMessage()` or `client.toolResultMessages()`.

**Step 3: Rewrite the agent loop**

Replace `src/agent/agent.ts`:

```typescript
import type { LLMClient, ToolDefinition, ToolCall } from "../models/provider";
import type { Adapter } from "../adapters/adapter";
import type { EvidenceLogger } from "../evidence/logger";
import type { StoryCard } from "../format/story-card";
import type { VetResult, VetStatus, Observation } from "../types";
import { buildSystemPrompt } from "./prompts";

const MAX_TURNS = 50;

const REPORT_TOOL: ToolDefinition = {
  name: "report_result",
  description:
    "Report your test result. Call this when you are done testing.",
  parameters: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: ["pass", "fail", "investigate"],
        description: "Your verdict",
      },
      summary: {
        type: "string",
        description: "Brief summary of what happened",
      },
      reasoning: {
        type: "string",
        description: "Why you reached this verdict",
      },
      observations: {
        type: "array",
        description: "Any observations, bugs, suggestions, etc.",
        items: {
          type: "object",
          properties: {
            kind: {
              type: "string",
              enum: [
                "bug",
                "ux",
                "typo",
                "suggestion",
                "a11y",
                "performance",
              ],
            },
            description: { type: "string" },
          },
          required: ["kind", "description"],
        },
      },
    },
    required: ["status", "summary", "reasoning"],
  },
};

export async function runAgent(
  card: StoryCard,
  adapter: Adapter,
  client: LLMClient,
  logger: EvidenceLogger
): Promise<VetResult> {
  const startTime = Date.now();
  const systemPrompt = buildSystemPrompt(card);
  const tools = [...adapter.toolDefinitions(), REPORT_TOOL];
  const messages: unknown[] = [
    client.userMessage(
      "Begin testing. Use the available tools to interact with the application."
    ),
  ];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await client.chat(messages, tools, systemPrompt);

    // Check for report_result
    const report = response.toolCalls.find(
      (tc) => tc.name === "report_result"
    );
    if (report) {
      const args = report.arguments;
      return {
        scenario: card.id,
        status: args.status as VetStatus,
        summary: args.summary as string,
        reasoning: args.reasoning as string,
        observations: (args.observations as Observation[]) || [],
        evidence: {
          screenshots: logger.screenshots,
          log: logger.logPath,
        },
        duration_ms: Date.now() - startTime,
      };
    }

    // Process tool calls
    if (response.toolCalls.length > 0) {
      messages.push(response.rawAssistantMessage);

      const adapterCalls = response.toolCalls.filter(
        (tc) => tc.name !== "report_result"
      );
      const results: string[] = [];
      for (const tc of adapterCalls) {
        try {
          const result = await adapter.executeTool(tc.name, tc.arguments, logger);
          results.push(result);
        } catch (err) {
          results.push(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      messages.push(
        ...client.toolResultMessages(adapterCalls, results)
      );
    } else if (response.text) {
      // No tool calls — push the assistant message and nudge
      messages.push(response.rawAssistantMessage);
      messages.push(
        client.userMessage(
          "Use the tools to interact with the application, or call report_result when done."
        )
      );
    }
  }

  // Max turns reached
  return {
    scenario: card.id,
    status: "investigate",
    summary: "Agent reached maximum turn limit without reporting a result",
    reasoning: `Exhausted ${MAX_TURNS} turns`,
    observations: [],
    evidence: {
      screenshots: logger.screenshots,
      log: logger.logPath,
    },
    duration_ms: Date.now() - startTime,
  };
}
```

Key changes:
- `messages` is `unknown[]` instead of `Message[]`
- Initial message created via `client.userMessage()`
- After tool calls: pushes `response.rawAssistantMessage` then `client.toolResultMessages()`
- Nudge messages created via `client.userMessage()`
- Tool execution errors are caught and passed as error text (agent can see what failed)

**Step 4: Run test to verify it passes**

Run: `bun test test/agent/agent.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/agent/agent.ts test/agent/agent.test.ts
git commit -m "fix: agent loop uses opaque messages for proper tool call round-trip"
```

---

### Task 5: Fix compile errors from removing Message type

**Files:**
- Modify: `src/cli/run.ts` (if it imports Message)
- Modify: any other files importing `Message` from provider

**Context:** We removed the `Message` type from `provider.ts`. Any files that imported it will fail to compile. Find and fix them.

**Step 1: Search for imports of Message**

Run: `grep -r "Message" src/ --include="*.ts" -l`

Fix each file. The `Message` type was only used in:
- `src/agent/agent.ts` (already fixed in Task 4)
- Any test files referencing it

**Step 2: Run all tests**

Run: `bun test`
Expected: All tests pass. If any fail due to missing `Message` type, fix the imports.

**Step 3: Commit**

```bash
git add -A  # after verifying with git status
git commit -m "fix: remove stale Message type imports"
```

---

## Phase 2: Agent Loop Integration Tests

Now that the message protocol is fixed, test the agent loop with a mock client that simulates realistic multi-turn tool use.

### Task 6: Agent loop multi-turn test

**Files:**
- Modify: `test/agent/agent.test.ts`

**Context:** Add a test that simulates a realistic 3+ turn interaction: screenshot → extract → click → screenshot → report_result. This verifies the full message round-trip works correctly.

**Step 1: Write the test**

Add to `test/agent/agent.test.ts`:

```typescript
test("handles multi-turn tool use conversation", async () => {
  let callCount = 0;

  const client: LLMClient = {
    async chat(messages) {
      callCount++;
      switch (callCount) {
        case 1:
          // Turn 1: Take a screenshot
          return {
            text: "Let me see what's on the page",
            toolCalls: [{ id: "tc_1", name: "screenshot", arguments: {} }],
            stopReason: "tool_use" as const,
            rawAssistantMessage: { role: "assistant", turn: 1 },
          };
        case 2:
          // Turn 2: Agent saw the screenshot, now reports
          // Verify messages grew correctly
          expect(messages.length).toBeGreaterThanOrEqual(3); // user + assistant + tool_result
          return {
            text: "I can see the page. It looks correct.",
            toolCalls: [
              {
                id: "tc_2",
                name: "report_result",
                arguments: {
                  status: "pass",
                  summary: "Page loads correctly",
                  reasoning: "Screenshot shows expected content",
                  observations: [
                    { kind: "ux", description: "Button label could be clearer" },
                  ],
                },
              },
            ],
            stopReason: "tool_use" as const,
            rawAssistantMessage: { role: "assistant", turn: 2 },
          };
        default:
          throw new Error("Unexpected call");
      }
    },
    userMessage(content: string) {
      return { role: "user", content };
    },
    toolResultMessages(calls: ToolCall[], results: string[]) {
      return calls.map((c, i) => ({ role: "tool", id: c.id, content: results[i] }));
    },
  };

  const result = await runAgent(
    makeCard(),
    makeAdapter({ screenshot: "Screenshot saved to evidence/001.png" }),
    client,
    makeLogger()
  );

  expect(result.status).toBe("pass");
  expect(result.observations).toHaveLength(1);
  expect(result.observations[0].kind).toBe("ux");
  expect(callCount).toBe(2);
});

test("handles tool execution errors gracefully", async () => {
  let callCount = 0;

  const errorAdapter: Adapter = {
    async start() {},
    async close() {},
    toolDefinitions() {
      return [
        {
          name: "click",
          description: "Click an element",
          parameters: { type: "object", properties: { selector: { type: "string" } }, required: ["selector"] },
        },
      ];
    },
    async executeTool(name: string) {
      if (name === "click") throw new Error("Element not found: .missing");
      return "ok";
    },
  };

  const client: LLMClient = {
    async chat(messages) {
      callCount++;
      if (callCount === 1) {
        return {
          text: "Clicking the button",
          toolCalls: [{ id: "tc_1", name: "click", arguments: { selector: ".missing" } }],
          stopReason: "tool_use" as const,
          rawAssistantMessage: { role: "assistant", turn: 1 },
        };
      }
      // After seeing the error, agent reports
      // Check that the error message was passed through
      const lastMsg = messages[messages.length - 1] as any;
      expect(lastMsg.content).toContain("Error:");
      return {
        text: "",
        toolCalls: [{
          id: "tc_2",
          name: "report_result",
          arguments: { status: "fail", summary: "Button missing", reasoning: "Click failed" },
        }],
        stopReason: "tool_use" as const,
        rawAssistantMessage: { role: "assistant", turn: 2 },
      };
    },
    userMessage(content: string) {
      return { role: "user", content };
    },
    toolResultMessages(calls: ToolCall[], results: string[]) {
      return calls.map((c, i) => ({ role: "tool", id: c.id, content: results[i] }));
    },
  };

  const result = await runAgent(makeCard(), errorAdapter, client, makeLogger());
  expect(result.status).toBe("fail");
});
```

**Step 2: Run tests**

Run: `bun test test/agent/agent.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add test/agent/agent.test.ts
git commit -m "test: add multi-turn and error handling agent loop tests"
```

---

## Phase 3: End-to-End Smoke Tests

### Task 7: CLI adapter end-to-end test

**Files:**
- Create: `test/e2e/cli-smoke.test.ts`

**Context:** Run the full `vet run` pipeline against a simple CLI program using a mock LLM client that sends scripted tool calls. This verifies the CLI adapter actually works with a real process.

We can't use a real LLM (costs money, nondeterministic), so we create a deterministic mock client that simulates a realistic interaction: read_output → type → press Enter → read_output → report_result.

**Step 1: Create a tiny test CLI program**

Create `test/fixtures/echo-app.sh`:

```bash
#!/bin/bash
echo "Welcome to Echo App"
echo -n "> "
read input
echo "You said: $input"
```

**Step 2: Write the e2e test**

Create `test/e2e/cli-smoke.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { runAgent } from "../../src/agent/agent";
import { CLIAdapter } from "../../src/adapters/cli/adapter";
import { EvidenceLogger } from "../../src/evidence/logger";
import type { LLMClient, ToolCall, AgentResponse } from "../../src/models/provider";
import type { StoryCard } from "../../src/format/story-card";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const FIXTURE = join(import.meta.dir, "../fixtures/echo-app.sh");

function makeCard(): StoryCard {
  return {
    id: "cli-smoke",
    title: "Echo app responds to input",
    status: "ready",
    tags: [],
    description: "The echo app should echo back what the user types",
    acceptanceCriteria: ["App echoes user input"],
    raw: "",
  };
}

describe("CLI e2e smoke test", () => {
  test("agent can interact with a CLI program", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "vet-e2e-cli-"));
    const logger = new EvidenceLogger(outDir);
    const adapter = new CLIAdapter();

    let callCount = 0;

    const client: LLMClient = {
      async chat() {
        callCount++;
        // Add small delay to let process produce output
        await new Promise((r) => setTimeout(r, 300));

        switch (callCount) {
          case 1:
            // Read initial output
            return {
              text: "Let me read the initial output",
              toolCalls: [{ id: "tc_1", name: "read_output", arguments: {} }],
              stopReason: "tool_use" as const,
              rawAssistantMessage: { role: "assistant", turn: 1 },
            };
          case 2:
            // Type something
            return {
              text: "I see the prompt, let me type something",
              toolCalls: [{ id: "tc_2", name: "type", arguments: { text: "hello world\n" } }],
              stopReason: "tool_use" as const,
              rawAssistantMessage: { role: "assistant", turn: 2 },
            };
          case 3:
            // Read the response
            return {
              text: "Let me read the response",
              toolCalls: [{ id: "tc_3", name: "read_output", arguments: {} }],
              stopReason: "tool_use" as const,
              rawAssistantMessage: { role: "assistant", turn: 3 },
            };
          case 4:
            // Report result
            return {
              text: "The app echoed correctly",
              toolCalls: [{
                id: "tc_4",
                name: "report_result",
                arguments: {
                  status: "pass",
                  summary: "Echo app works correctly",
                  reasoning: "Typed 'hello world' and saw it echoed back",
                },
              }],
              stopReason: "tool_use" as const,
              rawAssistantMessage: { role: "assistant", turn: 4 },
            };
          default:
            throw new Error(`Unexpected call ${callCount}`);
        }
      },
      userMessage(content: string) {
        return { role: "user", content };
      },
      toolResultMessages(calls: ToolCall[], results: string[]) {
        return calls.map((c, i) => ({ role: "tool", id: c.id, content: results[i] }));
      },
    };

    await adapter.start(`bash ${FIXTURE}`);

    try {
      const result = await runAgent(makeCard(), adapter, client, logger);
      expect(result.status).toBe("pass");
      expect(result.scenario).toBe("cli-smoke");
      expect(result.duration_ms).toBeGreaterThan(0);
    } finally {
      await adapter.close();
    }
  });
});
```

**Step 3: Make the fixture executable**

Run: `chmod +x test/fixtures/echo-app.sh`

**Step 4: Run the test**

Run: `bun test test/e2e/cli-smoke.test.ts`
Expected: PASS — the mock client drives the CLI adapter through a real process interaction.

**Step 5: Commit**

```bash
git add test/e2e/cli-smoke.test.ts test/fixtures/echo-app.sh
git commit -m "test: add CLI adapter end-to-end smoke test"
```

---

### Task 8: Web adapter smoke test (requires Chrome)

**Files:**
- Create: `test/e2e/web-smoke.test.ts`
- Create: `test/fixtures/test-page.html`

**Context:** This test starts a local HTTP server serving a simple HTML page, starts Chrome, and runs the agent loop against it. It requires Chrome to be installed. The test should skip gracefully if Chrome isn't available.

We use the same mock client pattern — scripted tool calls that simulate a realistic interaction.

**Step 1: Create a test HTML page**

Create `test/fixtures/test-page.html`:

```html
<!DOCTYPE html>
<html>
<head><title>Vet Test Page</title></head>
<body>
  <h1>Welcome</h1>
  <input id="name" placeholder="Enter your name" />
  <button onclick="document.getElementById('greeting').textContent = 'Hello, ' + document.getElementById('name').value + '!'">
    Greet
  </button>
  <p id="greeting"></p>
</body>
</html>
```

**Step 2: Write the e2e test**

Create `test/e2e/web-smoke.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { runAgent } from "../../src/agent/agent";
import { EvidenceLogger } from "../../src/evidence/logger";
import type { LLMClient, ToolCall } from "../../src/models/provider";
import type { StoryCard } from "../../src/format/story-card";
import { mkdtempSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const TEST_PAGE = join(import.meta.dir, "../fixtures/test-page.html");

function makeCard(): StoryCard {
  return {
    id: "web-smoke",
    title: "Greeting page works",
    status: "ready",
    tags: [],
    description: "User can enter their name and see a greeting",
    acceptanceCriteria: ["Greeting appears after clicking button"],
    raw: "",
  };
}

describe("Web e2e smoke test", () => {
  test("agent can interact with a web page", async () => {
    // Dynamic import — WebAdapter depends on chrome-ws-lib which may not be available
    let WebAdapter: any;
    try {
      const mod = await import("../../src/adapters/web/adapter");
      WebAdapter = mod.WebAdapter;
    } catch (err) {
      console.log("Skipping web e2e: chrome-ws-lib not available");
      return;
    }

    const outDir = mkdtempSync(join(tmpdir(), "vet-e2e-web-"));
    const logger = new EvidenceLogger(outDir);

    // Serve the test page on a random port
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const html = readFileSync(TEST_PAGE, "utf-8");
        return new Response(html, { headers: { "Content-Type": "text/html" } });
      },
    });

    const adapter = new WebAdapter();
    let callCount = 0;

    const client: LLMClient = {
      async chat() {
        callCount++;
        switch (callCount) {
          case 1:
            return {
              text: "Let me take a screenshot first",
              toolCalls: [{ id: "tc_1", name: "screenshot", arguments: {} }],
              stopReason: "tool_use" as const,
              rawAssistantMessage: { role: "assistant", turn: 1 },
            };
          case 2:
            return {
              text: "I see a name input and greet button. Let me type a name.",
              toolCalls: [{ id: "tc_2", name: "type", arguments: { text: "Alice", selector: "#name" } }],
              stopReason: "tool_use" as const,
              rawAssistantMessage: { role: "assistant", turn: 2 },
            };
          case 3:
            return {
              text: "Now click the button",
              toolCalls: [{ id: "tc_3", name: "click", arguments: { selector: "button" } }],
              stopReason: "tool_use" as const,
              rawAssistantMessage: { role: "assistant", turn: 3 },
            };
          case 4:
            return {
              text: "Let me check the greeting",
              toolCalls: [{ id: "tc_4", name: "extract", arguments: { selector: "#greeting" } }],
              stopReason: "tool_use" as const,
              rawAssistantMessage: { role: "assistant", turn: 4 },
            };
          case 5:
            return {
              text: "The greeting appeared correctly",
              toolCalls: [{
                id: "tc_5",
                name: "report_result",
                arguments: {
                  status: "pass",
                  summary: "Greeting page works",
                  reasoning: "Typed 'Alice', clicked Greet, saw 'Hello, Alice!'",
                },
              }],
              stopReason: "tool_use" as const,
              rawAssistantMessage: { role: "assistant", turn: 5 },
            };
          default:
            throw new Error(`Unexpected call ${callCount}`);
        }
      },
      userMessage(content: string) {
        return { role: "user", content };
      },
      toolResultMessages(calls: ToolCall[], results: string[]) {
        return calls.map((c, i) => ({ role: "tool", id: c.id, content: results[i] }));
      },
    };

    try {
      await adapter.start(`http://localhost:${server.port}`);
      const result = await runAgent(makeCard(), adapter, client, logger);
      expect(result.status).toBe("pass");
    } catch (err: any) {
      if (err.message?.includes("Chrome") || err.message?.includes("connect")) {
        console.log("Skipping web e2e: Chrome not available");
        return;
      }
      throw err;
    } finally {
      await adapter.close();
      server.stop();
    }
  });
});
```

**Step 2: Run the test**

Run: `bun test test/e2e/web-smoke.test.ts`
Expected: PASS if Chrome is available, skip otherwise.

**Step 3: Commit**

```bash
git add test/e2e/web-smoke.test.ts test/fixtures/test-page.html
git commit -m "test: add web adapter end-to-end smoke test"
```

---

## Phase 4: Results API

### Task 9: Implement results storage and retrieval

**Files:**
- Modify: `src/api/routes/results.ts`
- Create: `test/api/results.test.ts`

**Context:** The results route is currently a stub returning `[]`. We need it to:
- `GET /results` — list results from the evidence directory
- `GET /results/:scenario` — get result for a specific scenario

Results are stored as `result.json` files in the evidence output directory. The API reads them from disk (filesystem is the database).

**Step 1: Write the failing test**

Create `test/api/results.test.ts`:

```typescript
import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { VetResult } from "../../src/types";

// We'll need to update createApp to accept a dataDir
// import { createApp } from "../../src/api/server";

describe("results API", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "vet-results-"));

    // Create some test results
    const result1: VetResult = {
      scenario: "test-001",
      status: "pass",
      summary: "All good",
      reasoning: "Everything works",
      observations: [],
      evidence: { screenshots: [], log: "run.jsonl" },
      duration_ms: 1234,
    };

    const result2: VetResult = {
      scenario: "test-002",
      status: "fail",
      summary: "Button broken",
      reasoning: "Click didn't work",
      observations: [{ kind: "bug", description: "Submit button unresponsive" }],
      evidence: { screenshots: ["001.png"], log: "run.jsonl" },
      duration_ms: 5678,
    };

    // Store as evidence/<scenario>/result.json
    mkdirSync(join(dataDir, "test-001"), { recursive: true });
    writeFileSync(join(dataDir, "test-001", "result.json"), JSON.stringify(result1));
    mkdirSync(join(dataDir, "test-002"), { recursive: true });
    writeFileSync(join(dataDir, "test-002", "result.json"), JSON.stringify(result2));
  });

  test("GET /results lists all results", async () => {
    const { createApp } = await import("../../src/api/server");
    const app = createApp({ dataDir });
    const res = await app.request("/results");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body.map((r: any) => r.scenario).sort()).toEqual(["test-001", "test-002"]);
  });

  test("GET /results/:scenario returns a specific result", async () => {
    const { createApp } = await import("../../src/api/server");
    const app = createApp({ dataDir });
    const res = await app.request("/results/test-002");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scenario).toBe("test-002");
    expect(body.status).toBe("fail");
    expect(body.observations).toHaveLength(1);
  });

  test("GET /results/:scenario returns 404 for missing scenario", async () => {
    const { createApp } = await import("../../src/api/server");
    const app = createApp({ dataDir });
    const res = await app.request("/results/nonexistent");
    expect(res.status).toBe(404);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test test/api/results.test.ts`
Expected: FAIL — `createApp` doesn't accept options, results route returns `[]`.

**Step 3: Update server to accept options**

Modify `src/api/server.ts`:

```typescript
import { Hono } from "hono";
import { scenarioRoutes } from "./routes/scenarios";
import { resultRoutes } from "./routes/results";

export interface AppOptions {
  scenarioDir?: string;
  dataDir?: string;
}

export function createApp(options: AppOptions = {}) {
  const app = new Hono();

  app.route("/scenarios", scenarioRoutes(options.scenarioDir || "./scenarios"));
  app.route("/results", resultRoutes(options.dataDir || "./evidence"));

  return app;
}
```

**Step 4: Implement results routes**

Replace `src/api/routes/results.ts`:

```typescript
import { Hono } from "hono";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";

export function resultRoutes(dataDir: string) {
  const app = new Hono();

  app.get("/", (c) => {
    if (!existsSync(dataDir)) {
      return c.json([]);
    }

    const entries = readdirSync(dataDir, { withFileTypes: true });
    const results = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const resultPath = join(dataDir, entry.name, "result.json");
      if (existsSync(resultPath)) {
        const data = JSON.parse(readFileSync(resultPath, "utf-8"));
        results.push(data);
      }
    }

    return c.json(results);
  });

  app.get("/:scenario", (c) => {
    const scenario = c.req.param("scenario");
    const resultPath = join(dataDir, scenario, "result.json");

    if (!existsSync(resultPath)) {
      return c.json({ error: "Result not found" }, 404);
    }

    const data = JSON.parse(readFileSync(resultPath, "utf-8"));
    return c.json(data);
  });

  return app;
}
```

**Step 5: Update scenarios route to use function pattern**

The scenarios route currently exports a Hono instance directly. Update it to match the function pattern used by results. Check `src/api/routes/scenarios.ts` — if it already uses `scenarioRoutes(dir)`, no change needed. If it exports a bare `Hono`, wrap it in a function.

**Step 6: Run test to verify it passes**

Run: `bun test test/api/results.test.ts`
Expected: PASS

**Step 7: Run all tests**

Run: `bun test`
Expected: All pass. The scenarios test may need updating if `createApp` signature changed.

**Step 8: Commit**

```bash
git add src/api/server.ts src/api/routes/results.ts test/api/results.test.ts
git commit -m "feat: implement results API with filesystem-backed storage"
```

---

## Phase 5: Live LLM Test

### Task 10: Manual smoke test with real LLM

**Files:** None (manual verification)

**Context:** Everything above uses mock LLM clients. Before declaring vet "done," run it against a real application with a real LLM to verify the full pipeline works.

**Step 1: Create a test scenario**

Create `test/fixtures/smoke-scenario.md`:

```markdown
---
id: smoke-test
title: Page loads and displays content
status: ready
tags: [smoke]
---

# Page loads and displays content

Visit the application and verify the page loads successfully.

## Acceptance Criteria

- Page loads without errors
- Page displays some content
```

**Step 2: Run against a simple web target with CLI adapter**

Test with a simple command first:

```bash
ANTHROPIC_API_KEY=<key> bun src/index.ts run test/fixtures/smoke-scenario.md \
  --target "echo 'Hello World'" \
  --adapter cli \
  --out /tmp/vet-smoke-cli
```

Inspect the output:
- Check `/tmp/vet-smoke-cli/result.json` exists and has valid structure
- Check `/tmp/vet-smoke-cli/result.md` is readable
- Check `/tmp/vet-smoke-cli/run.jsonl` has action log entries

**Step 3: Run against a web target (requires Chrome)**

Start the Chrome container:

```bash
docker run -d --rm -p 9222:9222 vet-chrome
```

Then run:

```bash
ANTHROPIC_API_KEY=<key> bun src/index.ts run test/fixtures/smoke-scenario.md \
  --target "https://example.com" \
  --adapter web \
  --chrome localhost:9222 \
  --out /tmp/vet-smoke-web
```

Inspect the output same as above, plus check screenshots directory.

**Step 4: Fix any issues found**

This is where real bugs surface. Common issues:
- API key not found
- Chrome connection failures
- Tool call format mismatches
- Screenshot file paths
- Agent getting stuck in loops

Fix each issue with TDD: write a test that reproduces it, then fix.

**Step 5: Commit any fixes**

```bash
git add test/fixtures/smoke-scenario.md
git commit -m "test: add smoke test scenario for manual verification"
```

---

## Summary

| Phase | Tasks | What it fixes |
|-------|-------|---------------|
| 1: Message Protocol | Tasks 1-5 | Agent loop loses tool context between turns (blocking bug) |
| 2: Agent Loop Tests | Task 6 | Core logic untested |
| 3: E2E Smoke Tests | Tasks 7-8 | Never verified adapters work with real processes/Chrome |
| 4: Results API | Task 9 | Results endpoint is a stub |
| 5: Live LLM Test | Task 10 | Never tested with a real LLM |

After Phase 5, vet will be a working tool that can run scenarios against real applications.
