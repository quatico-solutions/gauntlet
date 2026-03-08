# Vet Completeness Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make vet fully functional — agent can see screenshots, token costs are tracked, fanout is tested, errors are clear, and tool calls can't hang forever.

**Architecture:** Screenshot delivery uses a `ToolResult` type that carries optional base64 image data. Each LLM provider formats images in its native way (Anthropic: image content block in tool_result; OpenAI: text-only since tool messages don't support images). Token tracking captures usage from each API response and accumulates across the run. Tool call timeouts use `Promise.race` with a configurable deadline.

**Tech Stack:** Bun, TypeScript, Anthropic SDK, OpenAI SDK

---

## Phase 1: Screenshot Delivery

The agent takes screenshots but can't see them — it only gets `"Screenshot saved to screenshots/001.png"` as text. Jesse's design: a `return_screenshot` boolean parameter on web adapter tools. When true, the tool result includes the base64 PNG so the LLM can see what happened.

### Task 1: Add ToolResult type and update Adapter interface

**Files:**
- Modify: `src/models/provider.ts`
- Modify: `src/adapters/adapter.ts`
- Create: `test/models/tool-result.test.ts`

**Context:** Currently `executeTool` returns `Promise<string>` and `toolResultMessages` takes `string[]`. We need a richer return type that can carry images.

**Step 1: Write the failing test**

Create `test/models/tool-result.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import type { ToolResult } from "../../src/models/provider";

describe("ToolResult type", () => {
  test("text-only result", () => {
    const result: ToolResult = { text: "clicked" };
    expect(result.text).toBe("clicked");
    expect(result.image).toBeUndefined();
  });

  test("result with image", () => {
    const result: ToolResult = {
      text: "Screenshot saved to screenshots/001.png",
      image: { data: "iVBOR...", mediaType: "image/png" },
    };
    expect(result.image!.data).toBe("iVBOR...");
    expect(result.image!.mediaType).toBe("image/png");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test test/models/tool-result.test.ts`
Expected: FAIL — `ToolResult` doesn't exist in provider.ts.

**Step 3: Add the ToolResult type**

Add to `src/models/provider.ts` after the `ToolCall` interface:

```typescript
export interface ToolResult {
  text: string;
  image?: {
    data: string;       // base64-encoded
    mediaType: string;  // e.g. "image/png"
  };
}
```

Update `LLMClient.toolResultMessages` signature:

```typescript
toolResultMessages(calls: ToolCall[], results: ToolResult[]): unknown[];
```

**Step 4: Update the Adapter interface**

Change `src/adapters/adapter.ts`:

```typescript
import type { ToolDefinition } from "../models/provider";
import type { ToolResult } from "../models/provider";
import type { EvidenceLogger } from "../evidence/logger";

export interface Adapter {
  start(target: string): Promise<void>;
  close(): Promise<void>;
  toolDefinitions(): ToolDefinition[];
  executeTool(
    name: string,
    args: Record<string, unknown>,
    logger: EvidenceLogger
  ): Promise<ToolResult>;
}
```

**Step 5: Run test to verify it passes**

Run: `bun test test/models/tool-result.test.ts`
Expected: PASS

Note: Other tests will break at this point because `executeTool` return type changed and `toolResultMessages` signature changed. That's expected — we fix them in subsequent tasks.

**Step 6: Commit**

```bash
git add src/models/provider.ts src/adapters/adapter.ts test/models/tool-result.test.ts
git commit -m "feat: add ToolResult type with optional image support"
```

---

### Task 2: Update Anthropic client to handle images in tool results

**Files:**
- Modify: `src/models/anthropic.ts`
- Modify: `test/models/anthropic.test.ts`

**Context:** Anthropic's tool_result content block supports images natively:
```json
{
  "type": "tool_result",
  "tool_use_id": "...",
  "content": [
    { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "..." } },
    { "type": "text", "text": "Screenshot saved to screenshots/001.png" }
  ]
}
```

When there's no image, use the simpler string content format (current behavior).

**Step 1: Write the failing test**

Add to `test/models/anthropic.test.ts`:

```typescript
test("toolResultMessages includes image when present", async () => {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("Skipping: no ANTHROPIC_API_KEY");
    return;
  }

  const { createAnthropicClient } = await import("../../src/models/anthropic");
  const client = createAnthropicClient("claude-sonnet-4-6");
  const calls = [{ id: "tu_1", name: "screenshot", arguments: {} }];
  const results = [{
    text: "Screenshot saved",
    image: { data: "iVBORw0KGgo=", mediaType: "image/png" },
  }];
  const msgs = client.toolResultMessages(calls, results) as any[];

  expect(msgs).toHaveLength(1);
  expect(msgs[0].content).toHaveLength(1);
  // tool_result content should be an array with image + text blocks
  const content = msgs[0].content[0].content;
  expect(content).toBeInstanceOf(Array);
  expect(content).toHaveLength(2);
  expect(content[0].type).toBe("image");
  expect(content[0].source.data).toBe("iVBORw0KGgo=");
  expect(content[1].type).toBe("text");
  expect(content[1].text).toBe("Screenshot saved");
});

test("toolResultMessages uses string content when no image", async () => {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("Skipping: no ANTHROPIC_API_KEY");
    return;
  }

  const { createAnthropicClient } = await import("../../src/models/anthropic");
  const client = createAnthropicClient("claude-sonnet-4-6");
  const calls = [{ id: "tu_1", name: "click", arguments: {} }];
  const results = [{ text: "clicked" }];
  const msgs = client.toolResultMessages(calls, results) as any[];

  // No image — content should be a plain string
  expect(msgs[0].content[0].content).toBe("clicked");
});
```

**Step 2: Run test to verify it fails**

Run: `bun test test/models/anthropic.test.ts`
Expected: FAIL — `toolResultMessages` still takes `string[]`.

**Step 3: Update the Anthropic client**

In `src/models/anthropic.ts`, update `toolResultMessages`:

```typescript
import type { LLMClient, ToolDefinition, AgentResponse, ToolCall, ToolResult } from "./provider";

// ... in the returned object:

toolResultMessages(calls: ToolCall[], results: ToolResult[]) {
  return [
    {
      role: "user" as const,
      content: calls.map((call, i) => {
        const result = results[i];
        if (result.image) {
          return {
            type: "tool_result" as const,
            tool_use_id: call.id,
            content: [
              {
                type: "image" as const,
                source: {
                  type: "base64" as const,
                  media_type: result.image.mediaType,
                  data: result.image.data,
                },
              },
              { type: "text" as const, text: result.text },
            ],
          };
        }
        return {
          type: "tool_result" as const,
          tool_use_id: call.id,
          content: result.text,
        };
      }),
    },
  ];
},
```

**Step 4: Run test to verify it passes**

Run: `bun test test/models/anthropic.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/models/anthropic.ts test/models/anthropic.test.ts
git commit -m "feat: Anthropic client embeds images in tool_result content blocks"
```

---

### Task 3: Update OpenAI client to handle ToolResult

**Files:**
- Modify: `src/models/openai.ts`
- Modify: `test/models/openai.test.ts`

**Context:** OpenAI tool messages only support text content — no images. When a ToolResult has an image, we include a text note that a screenshot was taken but can't send the actual image data. This is acceptable because Jesse said GPT models are for "browser use" (action execution), while Claude does the reasoning.

**Step 1: Write the failing test**

Add to `test/models/openai.test.ts`:

```typescript
test("toolResultMessages handles ToolResult with image (text-only)", async () => {
  if (!process.env.OPENAI_API_KEY) {
    console.log("Skipping: no OPENAI_API_KEY");
    return;
  }

  const { createOpenAIClient } = await import("../../src/models/openai");
  const client = createOpenAIClient("gpt-4o");
  const calls = [{ id: "call_1", name: "screenshot", arguments: {} }];
  const results = [{
    text: "Screenshot saved to screenshots/001.png",
    image: { data: "iVBORw0KGgo=", mediaType: "image/png" },
  }];
  const msgs = client.toolResultMessages(calls, results) as any[];

  // OpenAI can't embed images in tool messages — just gets the text
  expect(msgs).toHaveLength(1);
  expect(msgs[0].content).toBe("Screenshot saved to screenshots/001.png");
});
```

**Step 2: Run test to verify it fails**

Run: `bun test test/models/openai.test.ts`
Expected: FAIL — `toolResultMessages` still takes `string[]`.

**Step 3: Update the OpenAI client**

In `src/models/openai.ts`, update `toolResultMessages`:

```typescript
import type { LLMClient, ToolDefinition, AgentResponse, ToolCall, ToolResult } from "./provider";

// ... in the returned object:

toolResultMessages(calls: ToolCall[], results: ToolResult[]) {
  return calls.map((call, i) => ({
    role: "tool" as const,
    tool_call_id: call.id,
    content: results[i].text,
  }));
},
```

**Step 4: Run test to verify it passes**

Run: `bun test test/models/openai.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/models/openai.ts test/models/openai.test.ts
git commit -m "feat: OpenAI client accepts ToolResult (text-only, images unsupported)"
```

---

### Task 4: Update WebAdapter to return images

**Files:**
- Modify: `src/adapters/web/adapter.ts`
- Modify: `test/adapters/web/adapter.test.ts`

**Context:** The screenshot tool currently saves a PNG to disk and returns `"Screenshot saved to ${path}"`. It needs to also return the base64-encoded image data. Other tools (click, type, etc.) just return text-only ToolResults.

Jesse's design: add a `return_screenshot` boolean parameter to all web adapter tools. When true on any tool call, the result includes a screenshot taken after the action.

However, for simplicity in the first pass, we'll only return images from the `screenshot` tool itself. The `return_screenshot` param on other tools is a future enhancement.

**Step 1: Write the failing test**

Add to `test/adapters/web/adapter.test.ts`:

```typescript
test("screenshot tool returns ToolResult with image data", () => {
  // We can't actually run Chrome in unit tests, but we can verify
  // the tool definition includes the right parameters
  const adapter = new WebAdapter();
  const tools = adapter.toolDefinitions();
  const screenshotTool = tools.find((t) => t.name === "screenshot");
  expect(screenshotTool).toBeDefined();

  // Other tools should have return_screenshot parameter
  const clickTool = tools.find((t) => t.name === "click");
  expect(clickTool!.parameters.properties).toHaveProperty("return_screenshot");
});
```

**Step 2: Run test to verify it fails**

Run: `bun test test/adapters/web/adapter.test.ts`
Expected: FAIL — click tool doesn't have `return_screenshot` parameter.

**Step 3: Update the WebAdapter**

In `src/adapters/web/adapter.ts`:

1. Change the import to include `ToolResult`:
```typescript
import type { ToolDefinition, ToolResult } from "../../models/provider";
```

2. Add `return_screenshot` parameter to click, type, press, navigate, and eval tool definitions:
```typescript
return_screenshot: {
  type: "boolean",
  description: "Take a screenshot after this action and return the image",
},
```

3. Change `executeTool` return type to `Promise<ToolResult>`.

4. Update the screenshot case to return image data:
```typescript
case "screenshot": {
  const tmpFile = join(tmpdir(), `vet-screenshot-${Date.now()}.png`);
  await chrome.screenshot(
    0,
    tmpFile,
    (args.selector as string) ?? null,
    (args.fullPage as boolean) ?? false
  );
  const data = readFileSync(tmpFile);
  const saved = logger.saveScreenshot(Buffer.from(data));
  try { unlinkSync(tmpFile); } catch { }
  return {
    text: `Screenshot saved to ${saved}`,
    image: { data: Buffer.from(data).toString("base64"), mediaType: "image/png" },
  };
}
```

5. For other tools, check `args.return_screenshot` and take a screenshot after the action:
```typescript
// Helper at the top of executeTool:
const takeReturnScreenshot = async (): Promise<ToolResult["image"]> => {
  if (!args.return_screenshot) return undefined;
  const tmpFile = join(tmpdir(), `vet-screenshot-${Date.now()}.png`);
  await chrome.screenshot(0, tmpFile, null, false);
  const data = readFileSync(tmpFile);
  logger.saveScreenshot(Buffer.from(data));
  try { unlinkSync(tmpFile); } catch { }
  return { data: Buffer.from(data).toString("base64"), mediaType: "image/png" };
};
```

Then each tool returns:
```typescript
case "click": {
  await chrome.click(0, args.selector as string);
  return { text: "clicked", image: await takeReturnScreenshot() };
}
```

6. Tools that don't support `return_screenshot` (like `wait_for`) return `{ text: "..." }`.

**Step 4: Run test to verify it passes**

Run: `bun test test/adapters/web/adapter.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/adapters/web/adapter.ts test/adapters/web/adapter.test.ts
git commit -m "feat: web adapter returns screenshot images in ToolResult"
```

---

### Task 5: Update CLIAdapter to return ToolResult

**Files:**
- Modify: `src/adapters/cli/adapter.ts`
- Modify: `test/adapters/cli/adapter.test.ts`

**Context:** The CLI adapter returns strings. It needs to return `ToolResult` objects. Since CLI has no screenshots, all results are text-only: `{ text: "..." }`.

**Step 1: Update CLIAdapter**

Change `executeTool` return type and update all return statements:

```typescript
import type { ToolDefinition, ToolResult } from "../../models/provider";

// ... change executeTool signature:
async executeTool(
  name: string,
  args: Record<string, unknown>,
  logger: EvidenceLogger
): Promise<ToolResult> {

// ... update returns:
case "type": {
  await this.type(args.text as string);
  return { text: "typed" };
}
case "press": {
  await this.press(args.key as string);
  return { text: "pressed" };
}
case "read_output": {
  return { text: this.readOutput() };
}
```

**Step 2: Verify existing tests pass**

Run: `bun test test/adapters/cli/adapter.test.ts`

The test for "starts a shell and reads output" checks `output` string, but the adapter now returns `ToolResult`. However, that test calls `adapter.readOutput()` directly, not `executeTool`. So it should still pass. Verify.

**Step 3: Commit**

```bash
git add src/adapters/cli/adapter.ts
git commit -m "refactor: CLIAdapter returns ToolResult"
```

---

### Task 6: Update agent loop and fix all tests

**Files:**
- Modify: `src/agent/agent.ts`
- Modify: `test/agent/agent.test.ts`
- Modify: `test/e2e/cli-smoke.test.ts`
- Modify: `test/e2e/web-smoke.test.ts`

**Context:** The agent loop currently collects `string[]` results and passes them to `client.toolResultMessages`. It needs to collect `ToolResult[]` instead. All mock clients and adapters in tests need updating.

**Step 1: Update the agent loop**

In `src/agent/agent.ts`:

```typescript
import type { LLMClient, ToolDefinition, ToolResult } from "../models/provider";

// ... in the tool call processing section:

const results: ToolResult[] = [];
for (const tc of response.toolCalls) {
  try {
    const result = await adapter.executeTool(tc.name, tc.arguments, logger);
    results.push(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ text: `Error: ${message}` });
  }
}

messages.push(...client.toolResultMessages(response.toolCalls, results));
```

**Step 2: Update all test mock clients**

In `test/agent/agent.test.ts`, update mock client's `toolResultMessages`:
```typescript
toolResultMessages(calls: ToolCall[], results: ToolResult[]) {
  return calls.map((c, i) => ({ role: "tool", id: c.id, content: results[i].text }));
},
```

Update mock adapter's `executeTool`:
```typescript
async executeTool(name: string) {
  return { text: toolResults[name] || "ok" };
},
```

Do the same for `test/e2e/cli-smoke.test.ts` and `test/e2e/web-smoke.test.ts`.

**Step 3: Run all tests**

Run: `bun test`
Expected: All pass.

**Step 4: Commit**

```bash
git add src/agent/agent.ts test/agent/agent.test.ts test/e2e/cli-smoke.test.ts test/e2e/web-smoke.test.ts
git commit -m "feat: agent loop passes ToolResult with images to LLM clients"
```

---

## Phase 2: Token and Cost Tracking

### Task 7: Add usage tracking to provider types and VetResult

**Files:**
- Modify: `src/models/provider.ts`
- Modify: `src/types.ts`
- Create: `test/models/usage.test.ts`

**Context:** Both Anthropic and OpenAI return token usage in their responses. We need to capture it, accumulate it across the agent loop, and include it in VetResult.

**Step 1: Write the failing test**

Create `test/models/usage.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import type { AgentResponse, TokenUsage } from "../../src/models/provider";
import type { VetResult } from "../../src/types";

describe("usage tracking types", () => {
  test("AgentResponse has usage field", () => {
    const response: AgentResponse = {
      text: "hello",
      toolCalls: [],
      stopReason: "end_turn",
      rawAssistantMessage: null,
      usage: { inputTokens: 100, outputTokens: 50 },
    };
    expect(response.usage.inputTokens).toBe(100);
    expect(response.usage.outputTokens).toBe(50);
  });

  test("VetResult has usage field", () => {
    const result = {
      scenario: "test",
      status: "pass" as const,
      summary: "ok",
      reasoning: "ok",
      observations: [],
      evidence: { screenshots: [], log: "" },
      duration_ms: 100,
      usage: { inputTokens: 1000, outputTokens: 500, turns: 3 },
    } satisfies VetResult;
    expect(result.usage!.turns).toBe(3);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test test/models/usage.test.ts`
Expected: FAIL — `TokenUsage` doesn't exist, `AgentResponse` has no `usage` field.

**Step 3: Add the types**

Add to `src/models/provider.ts`:

```typescript
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}
```

Add to `AgentResponse`:
```typescript
export interface AgentResponse {
  text: string;
  toolCalls: ToolCall[];
  stopReason: "end_turn" | "tool_use" | "max_tokens";
  rawAssistantMessage: unknown;
  usage: TokenUsage;
}
```

Add to `src/types.ts` in `VetResult`:
```typescript
export interface VetResult {
  // ... existing fields ...
  usage?: {
    inputTokens: number;
    outputTokens: number;
    turns: number;
  };
}
```

**Step 4: Run test to verify it passes**

Run: `bun test test/models/usage.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/models/provider.ts src/types.ts test/models/usage.test.ts
git commit -m "feat: add TokenUsage type to AgentResponse and VetResult"
```

---

### Task 8: Capture tokens from Anthropic and OpenAI responses

**Files:**
- Modify: `src/models/anthropic.ts`
- Modify: `src/models/openai.ts`

**Context:** Both SDKs return usage data in their responses:
- Anthropic: `response.usage.input_tokens`, `response.usage.output_tokens`
- OpenAI: `response.usage.prompt_tokens`, `response.usage.completion_tokens`

**Step 1: Update Anthropic client**

In `convertResponse` in `src/models/anthropic.ts`:

```typescript
return {
  text,
  toolCalls,
  stopReason,
  rawAssistantMessage: { role: "assistant", content: response.content },
  usage: {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  },
};
```

**Step 2: Update OpenAI client**

In `convertResponse` in `src/models/openai.ts`:

```typescript
return {
  text,
  toolCalls,
  stopReason,
  rawAssistantMessage: {
    role: "assistant",
    content: choice.message.content,
    tool_calls: choice.message.tool_calls,
  },
  usage: {
    inputTokens: response.usage?.prompt_tokens ?? 0,
    outputTokens: response.usage?.completion_tokens ?? 0,
  },
};
```

**Step 3: Run all tests**

Run: `bun test`
Expected: Tests that use mock clients will fail because mock `AgentResponse` objects don't include `usage`. Fix them by adding `usage: { inputTokens: 0, outputTokens: 0 }` to all mock responses.

**Step 4: Commit**

```bash
git add src/models/anthropic.ts src/models/openai.ts
git commit -m "feat: capture token usage from Anthropic and OpenAI responses"
```

---

### Task 9: Accumulate usage in agent loop

**Files:**
- Modify: `src/agent/agent.ts`
- Modify: `test/agent/agent.test.ts`

**Context:** The agent loop should sum up inputTokens and outputTokens across all turns and include them in VetResult.

**Step 1: Write the failing test**

Add to `test/agent/agent.test.ts`:

```typescript
test("accumulates token usage across turns", async () => {
  let callCount = 0;
  const client: LLMClient = {
    async chat() {
      callCount++;
      if (callCount === 1) {
        return {
          text: "screenshot",
          toolCalls: [{ id: "tc_1", name: "screenshot", arguments: {} }],
          stopReason: "tool_use" as const,
          rawAssistantMessage: { role: "assistant" },
          usage: { inputTokens: 100, outputTokens: 50 },
        };
      }
      return {
        text: "done",
        toolCalls: [{
          id: "tc_2", name: "report_result",
          arguments: { status: "pass", summary: "ok", reasoning: "ok" },
        }],
        stopReason: "tool_use" as const,
        rawAssistantMessage: { role: "assistant" },
        usage: { inputTokens: 200, outputTokens: 75 },
      };
    },
    userMessage(content: string) { return { role: "user", content }; },
    toolResultMessages(calls, results) {
      return calls.map((c, i) => ({ role: "tool", id: c.id, content: results[i].text }));
    },
  };

  const result = await runAgent(makeCard(), makeAdapter({}), client, makeLogger());
  expect(result.usage).toBeDefined();
  expect(result.usage!.inputTokens).toBe(300);
  expect(result.usage!.outputTokens).toBe(125);
  expect(result.usage!.turns).toBe(2);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test test/agent/agent.test.ts`
Expected: FAIL — `result.usage` is undefined.

**Step 3: Add accumulation to agent loop**

In `src/agent/agent.ts`, after `const startTime`:

```typescript
let totalInputTokens = 0;
let totalOutputTokens = 0;
let turns = 0;
```

After each `client.chat()` call:

```typescript
totalInputTokens += response.usage.inputTokens;
totalOutputTokens += response.usage.outputTokens;
turns++;
```

In both return statements (report_result and max turns), add:

```typescript
usage: {
  inputTokens: totalInputTokens,
  outputTokens: totalOutputTokens,
  turns,
},
```

**Step 4: Run test to verify it passes**

Run: `bun test test/agent/agent.test.ts`
Expected: PASS

**Step 5: Run all tests**

Run: `bun test`
Expected: All pass.

**Step 6: Commit**

```bash
git add src/agent/agent.ts test/agent/agent.test.ts
git commit -m "feat: accumulate token usage across agent turns in VetResult"
```

---

## Phase 3: Functional Gaps

### Task 10: Fanout integration test

**Files:**
- Modify: `test/fanout/generator.test.ts`

**Context:** `generateFanout()` is untested. It calls `client.chat()` and splits the response on `"---CARD---"`. Test it with a mock client that returns known card data.

**Step 1: Write the test**

Add to `test/fanout/generator.test.ts`:

```typescript
import { generateFanout } from "../../src/fanout/generator";
import type { LLMClient, ToolResult } from "../../src/models/provider";

test("generateFanout splits response into cards", async () => {
  const mockClient: LLMClient = {
    async chat() {
      return {
        text: `---
id: story-001-a
title: Edge case variation
status: draft
tags:
  - generated
parent: story-001
---

# Edge case variation

Test with empty input.

## Acceptance Criteria

- Shows validation error
---CARD---
---
id: story-001-b
title: Error path variation
status: draft
tags:
  - generated
parent: story-001
---

# Error path variation

Test with network failure.

## Acceptance Criteria

- Shows error message`,
        toolCalls: [],
        stopReason: "end_turn" as const,
        rawAssistantMessage: null,
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
    userMessage(content: string) { return { role: "user", content }; },
    toolResultMessages() { return []; },
  };

  const card: StoryCard = {
    id: "story-001",
    title: "Test",
    status: "ready",
    tags: [],
    description: "Test story",
    acceptanceCriteria: ["Works"],
    raw: "",
  };

  const cards = await generateFanout(card, mockClient);
  expect(cards).toHaveLength(2);
  expect(cards[0]).toContain("story-001-a");
  expect(cards[1]).toContain("story-001-b");
});
```

**Step 2: Run test to verify it passes**

Run: `bun test test/fanout/generator.test.ts`

Note: `generateFanout` passes raw messages to `client.chat()` — it passes `[{ role: "user", content: prompt }]` not `client.userMessage(prompt)`. This is fine for the fanout use case (no tool calls), but check it works with the mock. If the mock's `chat()` ignores messages (which it does), this will pass.

**Step 3: Commit**

```bash
git add test/fanout/generator.test.ts
git commit -m "test: add generateFanout integration test with mock client"
```

---

### Task 11: Fanout uses client.userMessage()

**Files:**
- Modify: `src/fanout/generator.ts`

**Context:** `generateFanout()` currently constructs a raw message: `[{ role: "user", content: prompt }]`. This is fragile — if the provider changes message format, this breaks. It should use `client.userMessage()`.

**Step 1: Fix the code**

In `src/fanout/generator.ts`:

```typescript
export async function generateFanout(
  card: StoryCard,
  client: LLMClient
): Promise<string[]> {
  const prompt = buildFanoutPrompt(card);
  const response = await client.chat(
    [client.userMessage(prompt)],
    [],
    "You are a QA test designer. Output story cards in markdown format."
  );

  return response.text
    .split("---CARD---")
    .map((s) => s.trim())
    .filter(Boolean);
}
```

**Step 2: Run tests**

Run: `bun test test/fanout/generator.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add src/fanout/generator.ts
git commit -m "fix: fanout uses client.userMessage() instead of raw message object"
```

---

### Task 12: API key validation with clear error messages

**Files:**
- Modify: `src/models/anthropic.ts`
- Modify: `src/models/openai.ts`
- Modify: `src/models/resolve.ts`
- Create: `test/models/validation.test.ts`

**Context:** If you run `vet run` without an API key, the SDK throws a cryptic error deep in the call stack. We should validate early with a clear message.

**Step 1: Write the failing test**

Create `test/models/validation.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";

describe("API key validation", () => {
  test("Anthropic client throws clear error without API key", () => {
    const origKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      // Reset module cache to pick up env change
      const { createAnthropicClient } = require("../../src/models/anthropic");
      expect(() => createAnthropicClient("claude-sonnet-4-6")).toThrow(
        /ANTHROPIC_API_KEY/
      );
    } finally {
      if (origKey) process.env.ANTHROPIC_API_KEY = origKey;
    }
  });

  test("OpenAI client throws clear error without API key", () => {
    const origKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const { createOpenAIClient } = require("../../src/models/openai");
      expect(() => createOpenAIClient("gpt-4o")).toThrow(/OPENAI_API_KEY/);
    } finally {
      if (origKey) process.env.OPENAI_API_KEY = origKey;
    }
  });
});
```

Note: These tests manipulate environment variables and use `require()` to bypass ESM module caching. They may need adjustment depending on how Bun handles this. If `require()` doesn't work for resetting module cache, the validation can be tested differently — by checking the env var directly before creating the SDK client.

**Step 2: Run test to verify it fails**

Run: `bun test test/models/validation.test.ts`
Expected: FAIL — no validation exists.

**Step 3: Add validation**

In `src/models/anthropic.ts`:

```typescript
export function createAnthropicClient(model: string): LLMClient {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY environment variable is not set. " +
      "Set it to your Anthropic API key to use Claude models."
    );
  }
  const client = new Anthropic();
  // ...
```

In `src/models/openai.ts`:

```typescript
export function createOpenAIClient(model: string): LLMClient {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY environment variable is not set. " +
      "Set it to your OpenAI API key to use GPT models."
    );
  }
  const client = new OpenAI();
  // ...
```

**Step 4: Run test to verify it passes**

Run: `bun test test/models/validation.test.ts`
Expected: PASS

**Step 5: Run all tests**

Run: `bun test`
Expected: All pass. The Anthropic/OpenAI format tests already skip when no API key is set, so they won't conflict.

**Step 6: Commit**

```bash
git add src/models/anthropic.ts src/models/openai.ts test/models/validation.test.ts
git commit -m "feat: validate API keys early with clear error messages"
```

---

## Phase 4: Robustness

### Task 13: Tool call timeouts

**Files:**
- Modify: `src/agent/agent.ts`
- Modify: `test/agent/agent.test.ts`

**Context:** If a tool call hangs (e.g., Chrome becomes unresponsive), the agent loop blocks forever. Add a configurable timeout (default 30 seconds) on each `adapter.executeTool()` call.

**Step 1: Write the failing test**

Add to `test/agent/agent.test.ts`:

```typescript
test("times out slow tool calls", async () => {
  let callCount = 0;

  const slowAdapter: Adapter = {
    async start() {},
    async close() {},
    toolDefinitions() {
      return [{
        name: "slow_tool",
        description: "A slow tool",
        parameters: { type: "object", properties: {} },
      }];
    },
    async executeTool() {
      // Simulate a tool that takes forever
      await new Promise((resolve) => setTimeout(resolve, 60000));
      return { text: "done" };
    },
  };

  const client: LLMClient = {
    async chat() {
      callCount++;
      if (callCount === 1) {
        return {
          text: "calling slow tool",
          toolCalls: [{ id: "tc_1", name: "slow_tool", arguments: {} }],
          stopReason: "tool_use" as const,
          rawAssistantMessage: { role: "assistant" },
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      }
      return {
        text: "done",
        toolCalls: [{
          id: "tc_2", name: "report_result",
          arguments: { status: "fail", summary: "timeout", reasoning: "tool timed out" },
        }],
        stopReason: "tool_use" as const,
        rawAssistantMessage: { role: "assistant" },
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
    userMessage(content: string) { return { role: "user", content }; },
    toolResultMessages(calls, results) {
      return calls.map((c, i) => ({ role: "tool", id: c.id, content: results[i].text }));
    },
  };

  const result = await runAgent(
    makeCard(), slowAdapter, client, makeLogger(), undefined,
    { toolTimeoutMs: 1000 } // 1 second timeout for testing
  );

  // The agent should see a timeout error and eventually report
  expect(result.status).toBe("fail");
}, 10000); // test timeout
```

**Step 2: Run test to verify it fails**

Run: `bun test test/agent/agent.test.ts`
Expected: FAIL — `runAgent` doesn't accept options parameter.

**Step 3: Add timeout support**

In `src/agent/agent.ts`:

```typescript
export interface AgentOptions {
  toolTimeoutMs?: number;
}

const DEFAULT_TOOL_TIMEOUT_MS = 30000;

export async function runAgent(
  card: StoryCard,
  adapter: Adapter,
  client: LLMClient,
  logger: EvidenceLogger,
  target?: string,
  options?: AgentOptions
): Promise<VetResult> {
  const toolTimeout = options?.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;

  // ... in the tool call loop:
  for (const tc of response.toolCalls) {
    try {
      const result = await Promise.race([
        adapter.executeTool(tc.name, tc.arguments, logger),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Tool "${tc.name}" timed out after ${toolTimeout}ms`)), toolTimeout)
        ),
      ]);
      results.push(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ text: `Error: ${message}` });
    }
  }
```

**Step 4: Run test to verify it passes**

Run: `bun test test/agent/agent.test.ts`
Expected: PASS

**Step 5: Run all tests**

Run: `bun test`
Expected: All pass.

**Step 6: Commit**

```bash
git add src/agent/agent.ts test/agent/agent.test.ts
git commit -m "feat: add configurable timeout on tool calls (default 30s)"
```

---

## Summary

| Phase | Tasks | What it delivers |
|-------|-------|------------------|
| 1: Screenshot Delivery | Tasks 1-6 | Agent can SEE screenshots — base64 images in tool results for Anthropic, `return_screenshot` param on web tools |
| 2: Token Tracking | Tasks 7-9 | VetResult includes inputTokens, outputTokens, turns |
| 3: Functional Gaps | Tasks 10-12 | Fanout tested, API key errors are clear and early |
| 4: Robustness | Task 13 | Tool calls can't hang forever (30s default timeout) |

After all tasks, vet will be a complete, robust tool that can see what it's testing, report what it costs, fail clearly when misconfigured, and recover from hung tools.
