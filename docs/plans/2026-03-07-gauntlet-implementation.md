# Vet Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a scenario testing system that executes story cards against real apps via autonomous LLM agents.

**Architecture:** CLI tool (`vet run`) takes a story card markdown file and a target URL, spins up an LLM agent with browser or terminal tools, lets it explore and test autonomously, and writes structured JSON to stdout plus evidence artifacts to an output directory. API server wraps the same logic for programmatic access.

**Tech Stack:** Bun, TypeScript, superpowers-chrome (CDP), node-pty, Anthropic SDK, OpenAI SDK

**Design doc:** `docs/plans/2026-03-07-vet-design.md`

---

## Phase 1: Foundation

Scaffolding, story card parser, evidence capture, and structured output types. No LLM calls yet.

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/index.ts`

**Step 1: Initialize bun project**

```bash
cd /Users/jesse/prime-radiant/vet
bun init -y
```

**Step 2: Configure tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "resolveJsonModule": true,
    "types": ["bun-types"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```

**Step 3: Install dependencies**

```bash
bun add @anthropic-ai/sdk openai
bun add -d bun-types @types/node
```

**Step 4: Create minimal src/index.ts**

```typescript
console.log("vet: scenario testing system");
```

**Step 5: Verify it runs**

```bash
bun run src/index.ts
```

Expected: prints "vet: scenario testing system"

**Step 6: Commit**

```bash
git add package.json tsconfig.json bun.lock src/index.ts
git commit -m "Scaffold vet project with bun + TypeScript"
```

---

### Task 2: Story Card Format Parser

**Files:**
- Create: `src/format/story-card.ts`
- Create: `test/format/story-card.test.ts`
- Create: `test/fixtures/story-001-add-todo.md`
- Create: `test/fixtures/story-002-minimal.md`
- Create: `test/fixtures/story-003-with-parent.md`

**Step 1: Create test fixtures**

`test/fixtures/story-001-add-todo.md`:
```markdown
---
id: story-001
title: User can add a todo item
status: ready
tags: onboarding, core
stakeholder: new user
---

As a new user, I want to add a todo item so that I can track my tasks.

## Acceptance Criteria
- User can type a todo item and press Enter
- The item appears in the list
- The item count updates
```

`test/fixtures/story-002-minimal.md`:
```markdown
---
id: story-002
title: Minimal story
---

A story with no acceptance criteria and minimal frontmatter.
```

`test/fixtures/story-003-with-parent.md`:
```markdown
---
id: story-003
title: Add todo with special characters
status: draft
parent: story-001
tags: edge-case
stakeholder: power user
---

As a power user, I want to add a todo with special characters
(quotes, ampersands, unicode) so that my task descriptions
aren't limited.

## Acceptance Criteria
- User can enter text with quotes and ampersands
- The item displays correctly without escaping artifacts
```

**Step 2: Write failing tests**

`test/format/story-card.test.ts`:
```typescript
import { describe, test, expect } from "bun:test";
import { parseStoryCard, type StoryCard } from "../../src/format/story-card";
import { readFileSync } from "fs";
import { join } from "path";

const fixture = (name: string) =>
  readFileSync(join(__dirname, "../fixtures", name), "utf-8");

describe("parseStoryCard", () => {
  test("parses full story card with all fields", () => {
    const card = parseStoryCard(fixture("story-001-add-todo.md"));
    expect(card.id).toBe("story-001");
    expect(card.title).toBe("User can add a todo item");
    expect(card.status).toBe("ready");
    expect(card.tags).toEqual(["onboarding", "core"]);
    expect(card.stakeholder).toBe("new user");
    expect(card.parent).toBeUndefined();
    expect(card.description).toContain("As a new user");
    expect(card.acceptanceCriteria).toHaveLength(3);
    expect(card.acceptanceCriteria[0]).toBe(
      "User can type a todo item and press Enter"
    );
  });

  test("parses minimal story card", () => {
    const card = parseStoryCard(fixture("story-002-minimal.md"));
    expect(card.id).toBe("story-002");
    expect(card.title).toBe("Minimal story");
    expect(card.status).toBe("draft");
    expect(card.tags).toEqual([]);
    expect(card.acceptanceCriteria).toEqual([]);
    expect(card.description).toContain("minimal frontmatter");
  });

  test("parses parent reference", () => {
    const card = parseStoryCard(fixture("story-003-with-parent.md"));
    expect(card.parent).toBe("story-001");
    expect(card.stakeholder).toBe("power user");
  });

  test("throws on missing id", () => {
    expect(() =>
      parseStoryCard("---\ntitle: No ID\n---\nSome body")
    ).toThrow();
  });

  test("throws on missing title", () => {
    expect(() =>
      parseStoryCard("---\nid: story-x\n---\nSome body")
    ).toThrow();
  });
});
```

**Step 3: Run tests to verify they fail**

```bash
bun test test/format/story-card.test.ts
```

Expected: FAIL — module not found

**Step 4: Implement story card parser**

`src/format/story-card.ts`:
```typescript
export interface StoryCard {
  id: string;
  title: string;
  status: string;
  tags: string[];
  parent?: string;
  stakeholder?: string;
  description: string;
  acceptanceCriteria: string[];
  raw: string;
}

export function parseStoryCard(content: string): StoryCard {
  const { frontmatter, body } = splitFrontmatter(content);

  const id = frontmatter.id;
  const title = frontmatter.title;
  if (!id) throw new Error("Story card missing required field: id");
  if (!title) throw new Error("Story card missing required field: title");

  const { description, acceptanceCriteria } = parseBody(body);

  return {
    id,
    title,
    status: frontmatter.status || "draft",
    tags: frontmatter.tags
      ? frontmatter.tags.split(",").map((t: string) => t.trim()).filter(Boolean)
      : [],
    parent: frontmatter.parent || undefined,
    stakeholder: frontmatter.stakeholder || undefined,
    description,
    acceptanceCriteria,
    raw: content,
  };
}

function splitFrontmatter(content: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  const frontmatter: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    frontmatter[key] = value;
  }

  return { frontmatter, body: match[2].trim() };
}

function parseBody(body: string): {
  description: string;
  acceptanceCriteria: string[];
} {
  const marker = "## Acceptance Criteria";
  const markerIndex = body.indexOf(marker);

  if (markerIndex === -1) {
    return { description: body.trim(), acceptanceCriteria: [] };
  }

  const description = body.slice(0, markerIndex).trim();
  const criteriaSection = body.slice(markerIndex + marker.length).trim();
  const acceptanceCriteria = criteriaSection
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim());

  return { description, acceptanceCriteria };
}

export function serializeStoryCard(card: StoryCard): string {
  const lines: string[] = ["---"];
  lines.push(`id: ${card.id}`);
  lines.push(`title: ${card.title}`);
  lines.push(`status: ${card.status}`);
  if (card.tags.length) lines.push(`tags: ${card.tags.join(", ")}`);
  if (card.parent) lines.push(`parent: ${card.parent}`);
  if (card.stakeholder) lines.push(`stakeholder: ${card.stakeholder}`);
  lines.push("---");
  lines.push("");
  lines.push(card.description);
  if (card.acceptanceCriteria.length) {
    lines.push("");
    lines.push("## Acceptance Criteria");
    for (const criterion of card.acceptanceCriteria) {
      lines.push(`- ${criterion}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}
```

**Step 5: Run tests to verify they pass**

```bash
bun test test/format/story-card.test.ts
```

Expected: all 5 tests PASS

**Step 6: Commit**

```bash
git add src/format/ test/format/ test/fixtures/
git commit -m "Add story card parser with tests"
```

---

### Task 3: Result Types and Evidence Logger

**Files:**
- Create: `src/types.ts`
- Create: `src/evidence/logger.ts`
- Create: `test/evidence/logger.test.ts`

**Step 1: Write failing tests**

`test/evidence/logger.test.ts`:
```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { EvidenceLogger } from "../../src/evidence/logger";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("EvidenceLogger", () => {
  let outDir: string;
  let logger: EvidenceLogger;

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), "vet-test-"));
    logger = new EvidenceLogger(outDir);
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test("creates output directory structure", () => {
    expect(existsSync(join(outDir, "screenshots"))).toBe(true);
  });

  test("logs actions to run.jsonl", () => {
    logger.logAction("navigate", { url: "http://localhost:3000" });
    logger.logAction("click", { selector: "#add-btn" });

    const lines = readFileSync(join(outDir, "run.jsonl"), "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));

    expect(lines).toHaveLength(2);
    expect(lines[0].action).toBe("navigate");
    expect(lines[0].params.url).toBe("http://localhost:3000");
    expect(lines[0].timestamp).toBeDefined();
    expect(lines[1].action).toBe("click");
  });

  test("saves screenshot and returns path", () => {
    const fakePng = Buffer.from("fake-png-data");
    const path = logger.saveScreenshot(fakePng, "step-001");

    expect(path).toBe("screenshots/step-001.png");
    expect(
      readFileSync(join(outDir, "screenshots", "step-001.png"))
    ).toEqual(fakePng);
  });

  test("tracks screenshot list", () => {
    logger.saveScreenshot(Buffer.from("a"), "step-001");
    logger.saveScreenshot(Buffer.from("b"), "step-002");

    expect(logger.screenshots).toEqual([
      "screenshots/step-001.png",
      "screenshots/step-002.png",
    ]);
  });

  test("auto-increments screenshot names", () => {
    const p1 = logger.saveScreenshot(Buffer.from("a"));
    const p2 = logger.saveScreenshot(Buffer.from("b"));

    expect(p1).toBe("screenshots/001.png");
    expect(p2).toBe("screenshots/002.png");
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
bun test test/evidence/logger.test.ts
```

Expected: FAIL — module not found

**Step 3: Define result types**

`src/types.ts`:
```typescript
export type VetStatus = "pass" | "fail" | "investigate";

export type ObservationKind =
  | "bug"
  | "ux"
  | "typo"
  | "suggestion"
  | "a11y"
  | "performance";

export interface Observation {
  kind: ObservationKind;
  description: string;
  evidence?: string[];
}

export interface VetResult {
  scenario: string;
  status: VetStatus;
  summary: string;
  reasoning: string;
  observations: Observation[];
  evidence: {
    screenshots: string[];
    log: string;
  };
  duration_ms: number;
}

export interface ModelConfig {
  agent: string;
  judge?: string;
  fanout?: string;
}
```

**Step 4: Implement evidence logger**

`src/evidence/logger.ts`:
```typescript
import { mkdirSync, appendFileSync, writeFileSync } from "fs";
import { join } from "path";

export class EvidenceLogger {
  private outDir: string;
  private screenshotCount = 0;
  private _screenshots: string[] = [];

  constructor(outDir: string) {
    this.outDir = outDir;
    mkdirSync(join(outDir, "screenshots"), { recursive: true });
  }

  get screenshots(): string[] {
    return [...this._screenshots];
  }

  logAction(action: string, params: Record<string, unknown>): void {
    const entry = {
      timestamp: new Date().toISOString(),
      action,
      params,
    };
    appendFileSync(
      join(this.outDir, "run.jsonl"),
      JSON.stringify(entry) + "\n"
    );
  }

  saveScreenshot(data: Buffer, name?: string): string {
    if (!name) {
      this.screenshotCount++;
      name = String(this.screenshotCount).padStart(3, "0");
    }
    const relativePath = `screenshots/${name}.png`;
    writeFileSync(join(this.outDir, relativePath), data);
    this._screenshots.push(relativePath);
    return relativePath;
  }

  get logPath(): string {
    return "run.jsonl";
  }
}
```

**Step 5: Run tests to verify they pass**

```bash
bun test test/evidence/logger.test.ts
```

Expected: all 5 tests PASS

**Step 6: Commit**

```bash
git add src/types.ts src/evidence/ test/evidence/
git commit -m "Add result types and evidence logger"
```

---

### Task 4: Model Provider Abstraction

**Files:**
- Create: `src/models/provider.ts`
- Create: `src/models/anthropic.ts`
- Create: `src/models/openai.ts`
- Create: `src/models/resolve.ts`
- Create: `test/models/resolve.test.ts`

**Step 1: Write failing tests**

`test/models/resolve.test.ts`:
```typescript
import { describe, test, expect } from "bun:test";
import { resolveProvider, parseModelFlags } from "../../src/models/resolve";

describe("resolveProvider", () => {
  test("returns anthropic for claude models", () => {
    expect(resolveProvider("claude-sonnet-4-6")).toBe("anthropic");
    expect(resolveProvider("claude-opus-4-6")).toBe("anthropic");
    expect(resolveProvider("claude-3-5-sonnet-20241022")).toBe("anthropic");
  });

  test("returns openai for gpt/o-series models", () => {
    expect(resolveProvider("gpt-4o")).toBe("openai");
    expect(resolveProvider("gpt-4o-mini")).toBe("openai");
    expect(resolveProvider("o3")).toBe("openai");
    expect(resolveProvider("o1-preview")).toBe("openai");
  });

  test("throws for unknown model", () => {
    expect(() => resolveProvider("unknown-model")).toThrow();
  });
});

describe("parseModelFlags", () => {
  test("parses role=model pairs", () => {
    const config = parseModelFlags(["agent=gpt-4o", "judge=claude-opus-4-6"]);
    expect(config.agent).toBe("gpt-4o");
    expect(config.judge).toBe("claude-opus-4-6");
  });

  test("uses defaults when not specified", () => {
    const config = parseModelFlags([]);
    expect(config.agent).toBe("claude-sonnet-4-6");
  });

  test("falls back to env vars", () => {
    process.env.VET_AGENT_MODEL = "gpt-4o";
    const config = parseModelFlags([]);
    expect(config.agent).toBe("gpt-4o");
    delete process.env.VET_AGENT_MODEL;
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
bun test test/models/resolve.test.ts
```

Expected: FAIL

**Step 3: Implement provider resolution**

`src/models/provider.ts`:
```typescript
export type Provider = "anthropic" | "openai";

export interface Message {
  role: "user" | "assistant";
  content: string | MessageContent[];
}

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
  name: string;
  arguments: Record<string, unknown>;
}

export interface AgentResponse {
  text: string;
  toolCalls: ToolCall[];
  stopReason: "end_turn" | "tool_use" | "max_tokens";
}

export interface LLMClient {
  chat(
    messages: Message[],
    tools: ToolDefinition[],
    systemPrompt: string
  ): Promise<AgentResponse>;
}
```

`src/models/anthropic.ts`:
```typescript
import Anthropic from "@anthropic-ai/sdk";
import type { LLMClient, Message, ToolDefinition, AgentResponse } from "./provider";

export function createAnthropicClient(model: string): LLMClient {
  const client = new Anthropic();

  return {
    async chat(messages, tools, systemPrompt) {
      const response = await client.messages.create({
        model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: messages.map(convertMessage),
        tools: tools.map(convertTool),
      });

      return convertResponse(response);
    },
  };
}

function convertMessage(msg: Message): Anthropic.MessageParam {
  if (typeof msg.content === "string") {
    return { role: msg.role, content: msg.content };
  }
  return {
    role: msg.role,
    content: msg.content.map((c) => {
      if (c.type === "image") {
        return {
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: (c.mediaType || "image/png") as "image/png",
            data: c.data!,
          },
        };
      }
      return { type: "text" as const, text: c.text! };
    }),
  };
}

function convertTool(tool: ToolDefinition): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters as Anthropic.Tool["input_schema"],
  };
}

function convertResponse(response: Anthropic.Message): AgentResponse {
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const toolCalls = response.content
    .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
    .map((b) => ({
      name: b.name,
      arguments: b.input as Record<string, unknown>,
    }));

  const stopReason =
    response.stop_reason === "tool_use" ? "tool_use" : "end_turn";

  return { text, toolCalls, stopReason };
}
```

`src/models/openai.ts`:
```typescript
import OpenAI from "openai";
import type { LLMClient, Message, ToolDefinition, AgentResponse } from "./provider";

export function createOpenAIClient(model: string): LLMClient {
  const client = new OpenAI();

  return {
    async chat(messages, tools, systemPrompt) {
      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages.map(convertMessage),
        ],
        tools: tools.map(convertTool),
      });

      return convertResponse(response);
    },
  };
}

function convertMessage(
  msg: Message
): OpenAI.Chat.Completions.ChatCompletionMessageParam {
  if (typeof msg.content === "string") {
    return { role: msg.role, content: msg.content };
  }
  return {
    role: msg.role,
    content: msg.content.map((c) => {
      if (c.type === "image") {
        return {
          type: "image_url" as const,
          image_url: { url: `data:${c.mediaType || "image/png"};base64,${c.data}` },
        };
      }
      return { type: "text" as const, text: c.text! };
    }),
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

function convertResponse(
  response: OpenAI.Chat.Completions.ChatCompletion
): AgentResponse {
  const choice = response.choices[0];
  const text = choice.message.content || "";

  const toolCalls = (choice.message.tool_calls || []).map((tc) => ({
    name: tc.function.name,
    arguments: JSON.parse(tc.function.arguments),
  }));

  const stopReason =
    choice.finish_reason === "tool_calls" ? "tool_use" : "end_turn";

  return { text, toolCalls, stopReason };
}
```

`src/models/resolve.ts`:
```typescript
import type { Provider } from "./provider";
import type { ModelConfig } from "../types";

export function resolveProvider(model: string): Provider {
  if (model.startsWith("claude")) return "anthropic";
  if (model.startsWith("gpt") || model.startsWith("o1") || model.startsWith("o3"))
    return "openai";
  throw new Error(
    `Cannot determine provider for model "${model}". Expected model name starting with "claude", "gpt", "o1", or "o3".`
  );
}

const DEFAULT_AGENT_MODEL = "claude-sonnet-4-6";

export function parseModelFlags(flags: string[]): ModelConfig {
  const config: Partial<ModelConfig> = {};

  for (const flag of flags) {
    const idx = flag.indexOf("=");
    if (idx === -1) continue;
    const role = flag.slice(0, idx) as keyof ModelConfig;
    const model = flag.slice(idx + 1);
    config[role] = model;
  }

  return {
    agent:
      config.agent || process.env.VET_AGENT_MODEL || DEFAULT_AGENT_MODEL,
    judge: config.judge || process.env.VET_JUDGE_MODEL,
    fanout: config.fanout || process.env.VET_FANOUT_MODEL,
  };
}
```

**Step 4: Run tests to verify they pass**

```bash
bun test test/models/resolve.test.ts
```

Expected: all tests PASS

**Step 5: Commit**

```bash
git add src/models/ test/models/
git commit -m "Add LLM provider abstraction with Anthropic and OpenAI"
```

---

## Phase 2: CLI Adapter and Agent Loop

The simplest end-to-end: a test agent using the CLI adapter against a trivial target.

### Task 5: CLI Adapter (PTY)

**Files:**
- Create: `src/adapters/cli/adapter.ts`
- Create: `src/adapters/adapter.ts`
- Create: `test/adapters/cli/adapter.test.ts`

**Step 1: Write failing tests**

`test/adapters/cli/adapter.test.ts`:
```typescript
import { describe, test, expect, afterEach } from "bun:test";
import { CLIAdapter } from "../../../src/adapters/cli/adapter";

describe("CLIAdapter", () => {
  let adapter: CLIAdapter | null = null;

  afterEach(async () => {
    if (adapter) await adapter.close();
    adapter = null;
  });

  test("starts a shell and reads output", async () => {
    adapter = new CLIAdapter();
    await adapter.start("echo 'hello vet'");
    // Give it time to produce output
    await new Promise((r) => setTimeout(r, 500));
    const output = adapter.readOutput();
    expect(output).toContain("hello vet");
  });

  test("sends input and reads response", async () => {
    adapter = new CLIAdapter();
    await adapter.start("cat");
    await adapter.type("ping\n");
    await new Promise((r) => setTimeout(r, 500));
    const output = adapter.readOutput();
    expect(output).toContain("ping");
  });

  test("exposes tool definitions for the agent", () => {
    adapter = new CLIAdapter();
    const tools = adapter.toolDefinitions();
    const names = tools.map((t) => t.name);
    expect(names).toContain("type");
    expect(names).toContain("press");
    expect(names).toContain("read_output");
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
bun test test/adapters/cli/adapter.test.ts
```

Expected: FAIL

**Step 3: Define adapter interface**

`src/adapters/adapter.ts`:
```typescript
import type { ToolDefinition } from "../models/provider";
import type { EvidenceLogger } from "../evidence/logger";

export interface Adapter {
  start(target: string): Promise<void>;
  close(): Promise<void>;
  toolDefinitions(): ToolDefinition[];
  executeTool(
    name: string,
    args: Record<string, unknown>,
    logger: EvidenceLogger
  ): Promise<string>;
}
```

**Step 4: Implement CLI adapter**

`src/adapters/cli/adapter.ts`:
```typescript
import type { Adapter } from "../adapter";
import type { ToolDefinition } from "../../models/provider";
import type { EvidenceLogger } from "../../evidence/logger";

export class CLIAdapter implements Adapter {
  private proc: import("bun").Subprocess | null = null;
  private outputBuffer: string[] = [];
  private decoder = new TextDecoder();

  async start(command: string): Promise<void> {
    this.proc = Bun.spawn(["sh", "-c", command], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    this.readStream(this.proc.stdout);
    this.readStream(this.proc.stderr);
  }

  private async readStream(
    stream: ReadableStream<Uint8Array> | null
  ): Promise<void> {
    if (!stream) return;
    const reader = stream.getReader();
    (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          this.outputBuffer.push(this.decoder.decode(value));
        }
      } catch {
        // stream closed
      }
    })();
  }

  async close(): Promise<void> {
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
  }

  readOutput(): string {
    const output = this.outputBuffer.join("");
    this.outputBuffer = [];
    return output;
  }

  async type(text: string): Promise<void> {
    if (!this.proc?.stdin) throw new Error("No process running");
    const writer = this.proc.stdin.getWriter();
    await writer.write(new TextEncoder().encode(text));
    writer.releaseLock();
  }

  async press(key: string): Promise<void> {
    const keyMap: Record<string, string> = {
      Enter: "\n",
      Tab: "\t",
      Escape: "\x1b",
      "Ctrl+C": "\x03",
      "Ctrl+D": "\x04",
      "Ctrl+Z": "\x1a",
    };
    await this.type(keyMap[key] || key);
  }

  toolDefinitions(): ToolDefinition[] {
    return [
      {
        name: "type",
        description:
          "Type text into the terminal. Use \\n for Enter within the text.",
        parameters: {
          type: "object",
          properties: {
            text: { type: "string", description: "Text to type" },
          },
          required: ["text"],
        },
      },
      {
        name: "press",
        description:
          "Press a special key: Enter, Tab, Escape, Ctrl+C, Ctrl+D, Ctrl+Z",
        parameters: {
          type: "object",
          properties: {
            key: { type: "string", description: "Key name to press" },
          },
          required: ["key"],
        },
      },
      {
        name: "read_output",
        description:
          "Read recent terminal output. Returns text since last read.",
        parameters: {
          type: "object",
          properties: {},
        },
      },
    ];
  }

  async executeTool(
    name: string,
    args: Record<string, unknown>,
    logger: EvidenceLogger
  ): Promise<string> {
    logger.logAction(name, args);

    switch (name) {
      case "type":
        await this.type(args.text as string);
        return "Typed text into terminal";
      case "press":
        await this.press(args.key as string);
        return `Pressed ${args.key}`;
      case "read_output":
        return this.readOutput() || "(no new output)";
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}
```

**Step 5: Run tests to verify they pass**

```bash
bun test test/adapters/cli/adapter.test.ts
```

Expected: all tests PASS

**Step 6: Commit**

```bash
git add src/adapters/ test/adapters/
git commit -m "Add CLI adapter with PTY-based terminal control"
```

---

### Task 6: Test Agent Core

**Files:**
- Create: `src/agent/agent.ts`
- Create: `src/agent/prompts.ts`
- Create: `test/agent/agent.test.ts`

**Step 1: Write failing tests**

`test/agent/agent.test.ts`:
```typescript
import { describe, test, expect } from "bun:test";
import { buildSystemPrompt } from "../../src/agent/prompts";
import type { StoryCard } from "../../src/format/story-card";

describe("buildSystemPrompt", () => {
  test("includes story card content", () => {
    const card: StoryCard = {
      id: "story-001",
      title: "User can add a todo",
      status: "ready",
      tags: ["core"],
      description: "As a user I want to add a todo",
      acceptanceCriteria: ["Item appears in list", "Count updates"],
      raw: "",
    };

    const prompt = buildSystemPrompt(card);
    expect(prompt).toContain("story-001");
    expect(prompt).toContain("User can add a todo");
    expect(prompt).toContain("Item appears in list");
    expect(prompt).toContain("Count updates");
  });

  test("instructs agent to report observations", () => {
    const card: StoryCard = {
      id: "story-001",
      title: "Test",
      status: "ready",
      tags: [],
      description: "Test story",
      acceptanceCriteria: [],
      raw: "",
    };

    const prompt = buildSystemPrompt(card);
    expect(prompt).toContain("observation");
  });

  test("instructs autonomous exploration when no criteria", () => {
    const card: StoryCard = {
      id: "story-001",
      title: "Test",
      status: "ready",
      tags: [],
      description: "Explore the app",
      acceptanceCriteria: [],
      raw: "",
    };

    const prompt = buildSystemPrompt(card);
    expect(prompt).toContain("explore");
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
bun test test/agent/agent.test.ts
```

Expected: FAIL

**Step 3: Implement agent prompts**

`src/agent/prompts.ts`:
```typescript
import type { StoryCard } from "../format/story-card";

export function buildSystemPrompt(card: StoryCard): string {
  const parts: string[] = [];

  parts.push(`You are a thorough QA tester. You test software by using it, just like a human would.

You have been given a story card to test. Your job is to:
1. Explore the application and attempt to accomplish what the story describes
2. Judge whether the acceptance criteria are satisfied
3. Report your verdict with evidence
4. Report ANY other observations you make along the way

You are not limited to testing only the acceptance criteria. Like a good human tester, you should report anything you notice:
- Bugs (something is broken)
- UX issues (confusing navigation, unclear labels, missing feedback)
- Typos (misspelled text)
- Suggestions (it would be easier if...)
- Accessibility issues (missing alt text, poor contrast)
- Performance issues (slow loads, laggy interactions)

These incidental observations are extremely valuable.`);

  parts.push(`\n## Story Card\n`);
  parts.push(`**ID:** ${card.id}`);
  parts.push(`**Title:** ${card.title}`);
  if (card.stakeholder) parts.push(`**Stakeholder:** ${card.stakeholder}`);
  parts.push(`\n${card.description}`);

  if (card.acceptanceCriteria.length > 0) {
    parts.push(`\n## Acceptance Criteria`);
    for (const criterion of card.acceptanceCriteria) {
      parts.push(`- ${criterion}`);
    }
    parts.push(
      `\nEvaluate each criterion based on what you observe. Use your judgment.`
    );
  } else {
    parts.push(
      `\nThis story has no explicit acceptance criteria. Explore the application freely and report what you find. Judge whether the story's intent is satisfied.`
    );
  }

  parts.push(`\n## Reporting

When you are done testing, call the \`report_result\` tool with your findings.

Your verdict should be:
- **pass** — the story's intent is satisfied, acceptance criteria met
- **fail** — something is clearly broken or criteria are not met
- **investigate** — you're unsure, something seems off but you can't confirm

Include ALL observations, not just those related to the acceptance criteria.`);

  return parts.join("\n");
}
```

**Step 4: Implement agent loop**

`src/agent/agent.ts`:
```typescript
import type { LLMClient, ToolDefinition, Message } from "../models/provider";
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
  const messages: Message[] = [
    {
      role: "user",
      content: "Begin testing. Use the available tools to interact with the application.",
    },
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
      // Add assistant message with tool calls
      messages.push({ role: "assistant", content: response.text });

      const results: string[] = [];
      for (const tc of response.toolCalls) {
        const result = await adapter.executeTool(tc.name, tc.arguments, logger);
        results.push(`[${tc.name}]: ${result}`);
      }

      messages.push({ role: "user", content: results.join("\n\n") });
    } else if (response.text) {
      // Agent said something but didn't use tools — nudge it
      messages.push({ role: "assistant", content: response.text });
      messages.push({
        role: "user",
        content:
          "Use the tools to interact with the application, or call report_result when done.",
      });
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

**Step 5: Run tests to verify they pass**

```bash
bun test test/agent/agent.test.ts
```

Expected: all tests PASS

**Step 6: Commit**

```bash
git add src/agent/ test/agent/
git commit -m "Add test agent core with prompts and agent loop"
```

---

### Task 7: CLI Entrypoint (`vet run`)

**Files:**
- Create: `src/cli/run.ts`
- Create: `src/cli/args.ts`
- Modify: `src/index.ts`

**Step 1: Implement CLI arg parser**

`src/cli/args.ts`:
```typescript
import type { ModelConfig } from "../types";
import { parseModelFlags } from "../models/resolve";

export interface RunArgs {
  scenarioPath: string;
  target: string;
  outDir: string;
  adapter: "web" | "cli";
  models: ModelConfig;
}

export function parseRunArgs(argv: string[]): RunArgs {
  const args = argv.slice(2); // skip 'bun' and script path
  const command = args[0];

  if (command !== "run") {
    throw new Error(`Unknown command: ${command}. Expected: run, fanout, validate, serve`);
  }

  const scenarioPath = args[1];
  if (!scenarioPath) throw new Error("Usage: vet run <scenario.md> --target <url> --out <dir>");

  let target = "";
  let outDir = "./evidence";
  let adapter: "web" | "cli" = "web";
  const modelFlags: string[] = [];

  for (let i = 2; i < args.length; i++) {
    switch (args[i]) {
      case "--target":
        target = args[++i];
        break;
      case "--out":
        outDir = args[++i];
        break;
      case "--adapter":
        adapter = args[++i] as "web" | "cli";
        break;
      case "--model":
        modelFlags.push(args[++i]);
        break;
    }
  }

  if (!target) throw new Error("--target is required");

  return {
    scenarioPath,
    target,
    outDir,
    adapter,
    models: parseModelFlags(modelFlags),
  };
}
```

**Step 2: Implement run command**

`src/cli/run.ts`:
```typescript
import { readFileSync } from "fs";
import { parseStoryCard } from "../format/story-card";
import { EvidenceLogger } from "../evidence/logger";
import { runAgent } from "../agent/agent";
import { resolveProvider } from "../models/resolve";
import { createAnthropicClient } from "../models/anthropic";
import { createOpenAIClient } from "../models/openai";
import { CLIAdapter } from "../adapters/cli/adapter";
import type { RunArgs } from "./args";
import type { LLMClient } from "../models/provider";

function createClient(model: string): LLMClient {
  const provider = resolveProvider(model);
  switch (provider) {
    case "anthropic":
      return createAnthropicClient(model);
    case "openai":
      return createOpenAIClient(model);
  }
}

export async function run(args: RunArgs): Promise<void> {
  const content = readFileSync(args.scenarioPath, "utf-8");
  const card = parseStoryCard(content);
  const logger = new EvidenceLogger(args.outDir);
  const client = createClient(args.models.agent);

  let adapter;
  switch (args.adapter) {
    case "cli":
      adapter = new CLIAdapter();
      await adapter.start(args.target);
      break;
    case "web":
      // Web adapter will be added in Phase 3
      throw new Error("Web adapter not yet implemented. Use --adapter cli");
  }

  try {
    const result = await runAgent(card, adapter, client, logger);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await adapter.close();
  }
}
```

**Step 3: Wire up main entrypoint**

`src/index.ts`:
```typescript
import { parseRunArgs } from "./cli/args";
import { run } from "./cli/run";

async function main() {
  try {
    const args = parseRunArgs(process.argv);
    await run(args);
  } catch (err) {
    console.error(`vet: ${(err as Error).message}`);
    process.exit(1);
  }
}

main();
```

**Step 4: Add bin entry to package.json**

Add to `package.json`:
```json
{
  "bin": {
    "vet": "src/index.ts"
  }
}
```

**Step 5: Test manually with a dry run**

```bash
bun run src/index.ts run test/fixtures/story-001-add-todo.md --target "echo hello" --adapter cli --out /tmp/vet-test
```

Expected: either runs (if API keys are set) or errors with auth message

**Step 6: Commit**

```bash
git add src/cli/ src/index.ts package.json
git commit -m "Add vet run CLI entrypoint"
```

---

## Phase 3: Web Adapter

Fork superpowers-chrome and integrate as the web adapter.

### Task 8: Fork superpowers-chrome

**Files:**
- Create: `src/adapters/web/` (forked from superpowers-chrome TS source)

**Step 1: Clone superpowers-chrome source**

```bash
cd /Users/jesse/prime-radiant/vet
git clone --depth 1 https://github.com/obra/superpowers-chrome.git /tmp/superpowers-chrome-fork
```

**Step 2: Copy TypeScript source files**

Examine the source repo structure and copy the core library files into `src/adapters/web/`. The exact files to copy depend on the repo structure — copy the CDP library source (the TypeScript source that compiles to chrome-ws-lib.js), not the compiled output.

```bash
# Examine structure first
ls -la /tmp/superpowers-chrome-fork/
ls -la /tmp/superpowers-chrome-fork/mcp/src/
ls -la /tmp/superpowers-chrome-fork/skills/browsing/
```

Copy the essential CDP library files. Keep attribution in a comment at the top.

**Step 3: Verify the forked code compiles**

```bash
bun build src/adapters/web/ --no-bundle 2>&1 | head -20
```

Fix any import issues.

**Step 4: Commit**

```bash
git add src/adapters/web/
git commit -m "Fork superpowers-chrome CDP library as web adapter"
```

---

### Task 9: Web Adapter Integration

**Files:**
- Create: `src/adapters/web/adapter.ts`
- Create: `test/adapters/web/adapter.test.ts`

**Step 1: Write failing tests**

`test/adapters/web/adapter.test.ts`:
```typescript
import { describe, test, expect } from "bun:test";
import { WebAdapter } from "../../../src/adapters/web/adapter";

describe("WebAdapter", () => {
  test("exposes tool definitions for the agent", () => {
    const adapter = new WebAdapter();
    const tools = adapter.toolDefinitions();
    const names = tools.map((t) => t.name);
    expect(names).toContain("screenshot");
    expect(names).toContain("click");
    expect(names).toContain("type");
    expect(names).toContain("press");
    expect(names).toContain("navigate");
    expect(names).toContain("extract");
    expect(names).toContain("wait_for");
  });
});
```

Note: Full integration tests for WebAdapter require Chrome running. Write those as integration tests later, not unit tests.

**Step 2: Run tests to verify they fail**

```bash
bun test test/adapters/web/adapter.test.ts
```

**Step 3: Implement web adapter**

`src/adapters/web/adapter.ts`:

Implement the `Adapter` interface wrapping the forked superpowers-chrome library. The adapter should:
- On `start(url)`: launch Chrome (headless), navigate to the URL
- Expose tools: screenshot, click, type, press, navigate, extract, eval, wait_for
- On `executeTool`: delegate to the CDP library functions, log actions, capture evidence
- On `close`: kill Chrome

The exact implementation depends on the forked source API, but the structure is:

```typescript
import type { Adapter } from "../adapter";
import type { ToolDefinition } from "../../models/provider";
import type { EvidenceLogger } from "../../evidence/logger";
// Import from forked superpowers-chrome
import * as chrome from "./chrome-lib"; // adjust to actual import path

export class WebAdapter implements Adapter {
  async start(url: string): Promise<void> {
    await chrome.startChrome(true); // headless
    await chrome.navigate(0, url);
  }

  async close(): Promise<void> {
    await chrome.killChrome();
  }

  toolDefinitions(): ToolDefinition[] {
    return [
      {
        name: "screenshot",
        description: "Capture a screenshot of the current page",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "click",
        description: "Click an element by CSS selector",
        parameters: {
          type: "object",
          properties: {
            selector: { type: "string", description: "CSS selector" },
          },
          required: ["selector"],
        },
      },
      {
        name: "type",
        description: "Type text into the focused element",
        parameters: {
          type: "object",
          properties: {
            selector: { type: "string", description: "CSS selector to focus first" },
            text: { type: "string", description: "Text to type" },
          },
          required: ["text"],
        },
      },
      {
        name: "press",
        description: "Press a key: Enter, Tab, Escape, ArrowUp, ArrowDown, etc.",
        parameters: {
          type: "object",
          properties: {
            key: { type: "string", description: "Key name" },
          },
          required: ["key"],
        },
      },
      {
        name: "navigate",
        description: "Navigate to a URL",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL to navigate to" },
          },
          required: ["url"],
        },
      },
      {
        name: "extract",
        description: "Extract page content as readable text/markdown",
        parameters: {
          type: "object",
          properties: {
            selector: { type: "string", description: "CSS selector (optional, defaults to full page)" },
          },
        },
      },
      {
        name: "eval",
        description: "Execute JavaScript in the browser and return the result",
        parameters: {
          type: "object",
          properties: {
            expression: { type: "string", description: "JavaScript to evaluate" },
          },
          required: ["expression"],
        },
      },
      {
        name: "wait_for",
        description: "Wait for an element or text to appear on the page",
        parameters: {
          type: "object",
          properties: {
            selector: { type: "string", description: "CSS selector to wait for" },
            text: { type: "string", description: "Text to wait for (alternative to selector)" },
            timeout: { type: "number", description: "Max wait in ms (default 5000)" },
          },
        },
      },
    ];
  }

  async executeTool(
    name: string,
    args: Record<string, unknown>,
    logger: EvidenceLogger
  ): Promise<string> {
    logger.logAction(name, args);

    switch (name) {
      case "screenshot": {
        const data = await chrome.screenshot(0);
        const path = logger.saveScreenshot(Buffer.from(data));
        return `Screenshot saved to ${path}`;
      }
      case "click":
        await chrome.click(0, args.selector as string);
        return `Clicked ${args.selector}`;
      case "type":
        if (args.selector) await chrome.click(0, args.selector as string);
        await chrome.fill(0, args.selector as string, args.text as string);
        return `Typed "${args.text}"`;
      case "press":
        await chrome.keyboardPress(0, args.key as string);
        return `Pressed ${args.key}`;
      case "navigate":
        await chrome.navigate(0, args.url as string);
        return `Navigated to ${args.url}`;
      case "extract": {
        const text = await chrome.extractText(0, args.selector as string);
        return text;
      }
      case "eval": {
        const result = await chrome.evaluate(0, args.expression as string);
        return String(result);
      }
      case "wait_for":
        if (args.selector)
          await chrome.waitForElement(0, args.selector as string, args.timeout as number);
        else if (args.text)
          await chrome.waitForText(0, args.text as string, args.timeout as number);
        return "Element/text found";
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}
```

**Step 4: Wire web adapter into cli/run.ts**

Update `src/cli/run.ts` to import and use `WebAdapter` for `--adapter web`.

**Step 5: Run tests to verify they pass**

```bash
bun test test/adapters/web/adapter.test.ts
```

Expected: PASS

**Step 6: Commit**

```bash
git add src/adapters/web/ test/adapters/web/
git commit -m "Add web adapter wrapping forked superpowers-chrome CDP library"
```

---

## Phase 4: Fanout and Validate

### Task 10: Validate Command

**Files:**
- Create: `src/cli/validate.ts`
- Create: `test/cli/validate.test.ts`

**Step 1: Write failing tests**

`test/cli/validate.test.ts`:
```typescript
import { describe, test, expect } from "bun:test";
import { validateScenario } from "../../src/cli/validate";
import { join } from "path";

describe("validateScenario", () => {
  test("valid story card passes", () => {
    const result = validateScenario(
      join(__dirname, "../fixtures/story-001-add-todo.md")
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("missing id fails", () => {
    const result = validateScenario(
      join(__dirname, "../fixtures/invalid-no-id.md")
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("id");
  });
});
```

Create `test/fixtures/invalid-no-id.md`:
```markdown
---
title: No ID story
---

Missing the id field.
```

**Step 2: Run tests to verify they fail**

```bash
bun test test/cli/validate.test.ts
```

**Step 3: Implement validate**

`src/cli/validate.ts`:
```typescript
import { readFileSync } from "fs";
import { parseStoryCard } from "../format/story-card";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateScenario(path: string): ValidationResult {
  const errors: string[] = [];

  try {
    const content = readFileSync(path, "utf-8");
    parseStoryCard(content);
  } catch (err) {
    errors.push((err as Error).message);
  }

  return { valid: errors.length === 0, errors };
}
```

**Step 4: Wire into main entrypoint**

Update `src/cli/args.ts` to support `validate` command and `src/index.ts` to dispatch.

**Step 5: Run tests**

```bash
bun test test/cli/validate.test.ts
```

Expected: PASS

**Step 6: Commit**

```bash
git add src/cli/validate.ts test/cli/validate.test.ts test/fixtures/invalid-no-id.md
git commit -m "Add vet validate command"
```

---

### Task 11: Fanout Command

**Files:**
- Create: `src/cli/fanout.ts`
- Create: `src/fanout/generator.ts`
- Create: `test/fanout/generator.test.ts`

**Step 1: Write failing tests**

`test/fanout/generator.test.ts`:
```typescript
import { describe, test, expect } from "bun:test";
import { buildFanoutPrompt } from "../../src/fanout/generator";
import type { StoryCard } from "../../src/format/story-card";

describe("buildFanoutPrompt", () => {
  test("includes parent story content", () => {
    const card: StoryCard = {
      id: "story-001",
      title: "User can add a todo",
      status: "ready",
      tags: ["core"],
      description: "As a user I want to add a todo",
      acceptanceCriteria: ["Item appears in list"],
      raw: "",
    };

    const prompt = buildFanoutPrompt(card);
    expect(prompt).toContain("story-001");
    expect(prompt).toContain("User can add a todo");
    expect(prompt).toContain("Item appears in list");
  });

  test("instructs generation of variations", () => {
    const card: StoryCard = {
      id: "story-001",
      title: "Test",
      status: "ready",
      tags: [],
      description: "Test",
      acceptanceCriteria: [],
      raw: "",
    };

    const prompt = buildFanoutPrompt(card);
    expect(prompt).toContain("edge case");
    expect(prompt).toContain("parent: story-001");
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
bun test test/fanout/generator.test.ts
```

**Step 3: Implement fanout generator**

`src/fanout/generator.ts`:
```typescript
import type { StoryCard } from "../format/story-card";
import type { LLMClient } from "../models/provider";
import { serializeStoryCard } from "../format/story-card";

export function buildFanoutPrompt(card: StoryCard): string {
  return `You are a QA test designer. Given a story card, generate variation scenarios that test edge cases, error paths, alternate personas, and boundary conditions.

Each variation is a story card in the same format. Each MUST include:
- A unique id (use the parent id with a suffix, e.g., story-001-a, story-001-b)
- parent: ${card.id}
- A clear title describing the variation
- A description explaining what this variation tests
- Acceptance criteria (at least one)

## Parent Story Card

**ID:** ${card.id}
**Title:** ${card.title}
${card.stakeholder ? `**Stakeholder:** ${card.stakeholder}` : ""}

${card.description}

${card.acceptanceCriteria.length > 0 ? "## Acceptance Criteria\n" + card.acceptanceCriteria.map((c) => `- ${c}`).join("\n") : ""}

## Generate Variations

Think about:
- Edge cases (empty input, very long input, special characters)
- Error paths (network failure, invalid state, permission denied)
- Alternate personas (new user, power user, admin, mobile user)
- Boundary conditions (first item, last item, maximum items)
- Negative testing (what should NOT happen)

Generate 3-5 variations. Output each as a complete story card in markdown format with YAML frontmatter, separated by "---CARD---" markers.`;
}

export async function generateFanout(
  card: StoryCard,
  client: LLMClient
): Promise<string[]> {
  const prompt = buildFanoutPrompt(card);
  const response = await client.chat(
    [{ role: "user", content: prompt }],
    [],
    "You are a QA test designer. Output story cards in markdown format."
  );

  return response.text
    .split("---CARD---")
    .map((s) => s.trim())
    .filter(Boolean);
}
```

`src/cli/fanout.ts`:
```typescript
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { parseStoryCard } from "../format/story-card";
import { generateFanout } from "../fanout/generator";
import { resolveProvider } from "../models/resolve";
import { createAnthropicClient } from "../models/anthropic";
import { createOpenAIClient } from "../models/openai";
import type { LLMClient } from "../models/provider";
import type { ModelConfig } from "../types";

function createClient(model: string): LLMClient {
  const provider = resolveProvider(model);
  return provider === "anthropic"
    ? createAnthropicClient(model)
    : createOpenAIClient(model);
}

export async function fanout(
  scenarioPath: string,
  outDir: string,
  models: ModelConfig
): Promise<void> {
  const content = readFileSync(scenarioPath, "utf-8");
  const card = parseStoryCard(content);
  const model = models.fanout || models.agent;
  const client = createClient(model);

  const cards = await generateFanout(card, client);

  mkdirSync(outDir, { recursive: true });
  for (let i = 0; i < cards.length; i++) {
    const filename = `${card.id}-${String.fromCharCode(97 + i)}.md`;
    writeFileSync(join(outDir, filename), cards[i] + "\n");
    console.error(`Generated: ${filename}`);
  }

  console.log(JSON.stringify({ parent: card.id, generated: cards.length }));
}
```

**Step 4: Run tests**

```bash
bun test test/fanout/generator.test.ts
```

Expected: PASS

**Step 5: Wire fanout into main entrypoint**

Update `src/cli/args.ts` and `src/index.ts` to support `vet fanout`.

**Step 6: Commit**

```bash
git add src/fanout/ src/cli/fanout.ts test/fanout/
git commit -m "Add vet fanout command for scenario generation"
```

---

## Phase 5: API Server

### Task 12: API Server

**Files:**
- Create: `src/api/server.ts`
- Create: `src/api/routes/scenarios.ts`
- Create: `src/api/routes/results.ts`
- Create: `test/api/scenarios.test.ts`

**Step 1: Install Hono**

```bash
bun add hono
```

**Step 2: Write failing tests**

`test/api/scenarios.test.ts`:
```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createApp } from "../../src/api/server";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("GET /scenarios", () => {
  let dataDir: string;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "vet-api-"));
    const storiesDir = join(dataDir, "stories");
    mkdirSync(storiesDir, { recursive: true });

    writeFileSync(
      join(storiesDir, "story-001-test.md"),
      "---\nid: story-001\ntitle: Test story\nstatus: draft\n---\n\nA test story.\n"
    );

    app = createApp(dataDir);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("lists scenarios", async () => {
    const res = await app.request("/scenarios");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("story-001");
  });

  test("gets single scenario", async () => {
    const res = await app.request("/scenarios/story-001");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe("Test story");
  });

  test("returns 404 for missing scenario", async () => {
    const res = await app.request("/scenarios/story-999");
    expect(res.status).toBe(404);
  });
});
```

**Step 3: Run tests to verify they fail**

```bash
bun test test/api/scenarios.test.ts
```

**Step 4: Implement API server**

`src/api/server.ts`:
```typescript
import { Hono } from "hono";
import { scenarioRoutes } from "./routes/scenarios";

export function createApp(dataDir: string) {
  const app = new Hono();

  app.route("/scenarios", scenarioRoutes(dataDir));

  return app;
}
```

`src/api/routes/scenarios.ts`:
```typescript
import { Hono } from "hono";
import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { parseStoryCard, serializeStoryCard } from "../../format/story-card";

export function scenarioRoutes(dataDir: string) {
  const router = new Hono();
  const storiesDir = join(dataDir, "stories");

  router.get("/", (c) => {
    const files = readdirSync(storiesDir).filter((f) => f.endsWith(".md"));
    const scenarios = files.map((f) => {
      const content = readFileSync(join(storiesDir, f), "utf-8");
      const card = parseStoryCard(content);
      return {
        id: card.id,
        title: card.title,
        status: card.status,
        tags: card.tags,
        parent: card.parent,
        stakeholder: card.stakeholder,
      };
    });
    return c.json(scenarios);
  });

  router.get("/:id", (c) => {
    const id = c.req.param("id");
    const files = readdirSync(storiesDir).filter((f) => f.endsWith(".md"));
    for (const f of files) {
      const content = readFileSync(join(storiesDir, f), "utf-8");
      const card = parseStoryCard(content);
      if (card.id === id) return c.json(card);
    }
    return c.json({ error: "Not found" }, 404);
  });

  router.put("/:id", async (c) => {
    const id = c.req.param("id");
    const updates = await c.req.json();
    const files = readdirSync(storiesDir).filter((f) => f.endsWith(".md"));
    for (const f of files) {
      const content = readFileSync(join(storiesDir, f), "utf-8");
      const card = parseStoryCard(content);
      if (card.id === id) {
        const updated = { ...card, ...updates, raw: "" };
        writeFileSync(join(storiesDir, f), serializeStoryCard(updated));
        return c.json(updated);
      }
    }
    return c.json({ error: "Not found" }, 404);
  });

  router.post("/:id/approve", async (c) => {
    const id = c.req.param("id");
    const files = readdirSync(storiesDir).filter((f) => f.endsWith(".md"));
    for (const f of files) {
      const content = readFileSync(join(storiesDir, f), "utf-8");
      const card = parseStoryCard(content);
      if (card.id === id) {
        const updated = { ...card, status: "ready", raw: "" };
        writeFileSync(join(storiesDir, f), serializeStoryCard(updated));
        return c.json(updated);
      }
    }
    return c.json({ error: "Not found" }, 404);
  });

  return router;
}
```

**Step 5: Run tests**

```bash
bun test test/api/scenarios.test.ts
```

Expected: PASS

**Step 6: Wire serve command into CLI**

Update `src/cli/args.ts` and `src/index.ts` to support `vet serve --port 3000`.

**Step 7: Commit**

```bash
git add src/api/ test/api/ package.json
git commit -m "Add API server with scenario CRUD endpoints"
```

---

## Phase 6: Containerization

### Task 13: Dockerfile

**Files:**
- Create: `docker/Dockerfile`
- Create: `.dockerignore`

**Step 1: Create Dockerfile**

`docker/Dockerfile`:
```dockerfile
FROM debian:bookworm-slim

# Install Chrome
RUN apt-get update && apt-get install -y \
    wget gnupg2 \
    && wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update && apt-get install -y google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

# Install bun
RUN wget -qO- https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY src/ src/
COPY tsconfig.json ./

ENTRYPOINT ["bun", "run", "src/index.ts"]
```

`.dockerignore`:
```
node_modules
dist
.git
test
docs
evidence
```

**Step 2: Build and verify**

```bash
cd /Users/jesse/prime-radiant/vet
docker build -f docker/Dockerfile -t vet .
docker run --rm vet run --help
```

**Step 3: Commit**

```bash
git add docker/Dockerfile .dockerignore
git commit -m "Add Dockerfile for containerized scenario execution"
```

---

## Summary

| Phase | Tasks | What you get |
|-------|-------|-------------|
| 1: Foundation | 1-4 | Project scaffold, story card parser, evidence logger, model abstraction |
| 2: CLI + Agent | 5-7 | CLI adapter, agent loop, `vet run` with terminal testing |
| 3: Web Adapter | 8-9 | Forked superpowers-chrome, browser testing |
| 4: Fanout + Validate | 10-11 | `vet validate`, `vet fanout` for scenario generation |
| 5: API Server | 12 | REST API for scenario management |
| 6: Container | 13 | Docker image for headless execution |

After Phase 2, you have a working end-to-end: `vet run story.md --target "some-cli-command" --adapter cli --out ./evidence/`

After Phase 3, you can test web apps.

After Phase 5, toil and other tools can manage scenarios via API.
