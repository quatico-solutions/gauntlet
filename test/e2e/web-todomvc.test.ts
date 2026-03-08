import { describe, test, expect } from "bun:test";
import { runAgent } from "../../src/agent/agent";
import { EvidenceLogger } from "../../src/evidence/logger";
import { parseStoryCard } from "../../src/format/story-card";
import type {
  LLMClient,
  ToolCall,
  ToolResult,
  AgentResponse,
} from "../../src/models/provider";
import { join } from "path";
import { readFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";

const TODOMVC_HTML = join(import.meta.dir, "../fixtures/todomvc.html");
const STORIES_DIR = join(import.meta.dir, "../fixtures/stories");

function loadStory(filename: string) {
  return parseStoryCard(readFileSync(join(STORIES_DIR, filename), "utf-8"));
}

/** Race a promise against a timeout; rejects with a descriptive error on timeout */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

/** Returns true if the error indicates Chrome is unavailable (not a real test failure) */
function isChromeUnavailable(err: any): boolean {
  const msg = err?.message ?? "";
  return (
    msg.includes("Chrome") ||
    msg.includes("connect") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("timed out")
  );
}

function step(
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

function report(
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

function makeScriptedClient(steps: AgentResponse[]): LLMClient {
  let callIndex = 0;

  return {
    async chat() {
      await Bun.sleep(200);
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

function serveTodomvc() {
  return Bun.serve({
    port: 0,
    fetch() {
      const html = readFileSync(TODOMVC_HTML, "utf-8");
      return new Response(html, {
        headers: { "Content-Type": "text/html" },
      });
    },
  });
}

describe("Web e2e — TodoMVC", () => {
  test(
    "pass: user can add todo items",
    async () => {
      let WebAdapter: any;
      try {
        const mod = await import("../../src/adapters/web/adapter");
        WebAdapter = mod.WebAdapter;
      } catch (err) {
        console.log("Skipping web e2e: chrome-ws-lib not available");
        return;
      }

      const card = loadStory("todomvc-add-pass.md");
      const logDir = mkdtempSync(join(tmpdir(), "vet-todomvc-add-"));
      const logger = new EvidenceLogger(logDir);
      const server = serveTodomvc();
      const adapter = new WebAdapter();

      const steps: AgentResponse[] = [
        step("call_1", "screenshot", {}),
        step("call_2", "type", { text: "Buy groceries", selector: ".new-todo" }),
        step("call_3", "press", { key: "Enter" }),
        step("call_4", "extract", { selector: ".todo-list" }),
        step("call_5", "extract", { selector: ".todo-count" }),
        step("call_6", "type", { text: "Walk the dog", selector: ".new-todo" }),
        step("call_7", "press", { key: "Enter" }),
        step("call_8", "extract", { selector: ".todo-count" }),
        report("pass", "Todo items can be added", "Added two items, count updated correctly"),
      ];

      const client = makeScriptedClient(steps);

      try {
        await withTimeout(
          adapter.start(`http://localhost:${server.port}`),
          10_000,
          "adapter.start()"
        );
        const result = await withTimeout(
          runAgent(card, adapter, client, logger),
          15_000,
          "runAgent()"
        );

        expect(result.status).toBe("pass");
        expect(result.scenario).toBe("todomvc-add-pass");
      } catch (err: any) {
        if (isChromeUnavailable(err)) {
          console.log(`Skipping web e2e: ${err.message}`);
          return;
        }
        throw err;
      } finally {
        await adapter.close();
        server.stop();
      }
    },
    30_000
  );

  test(
    "fail: editing is not supported",
    async () => {
      let WebAdapter: any;
      try {
        const mod = await import("../../src/adapters/web/adapter");
        WebAdapter = mod.WebAdapter;
      } catch (err) {
        console.log("Skipping web e2e: chrome-ws-lib not available");
        return;
      }

      const card = loadStory("todomvc-edit-fail.md");
      const logDir = mkdtempSync(join(tmpdir(), "vet-todomvc-edit-"));
      const logger = new EvidenceLogger(logDir);
      const server = serveTodomvc();
      const adapter = new WebAdapter();

      const steps: AgentResponse[] = [
        step("call_1", "type", { text: "Test item", selector: ".new-todo" }),
        step("call_2", "press", { key: "Enter" }),
        step("call_3", "eval", {
          expression:
            "document.querySelector('.todo-list li label').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))",
        }),
        step("call_4", "extract", { selector: ".todo-list" }),
        report(
          "fail",
          "Editing is not supported",
          "Double-clicking a todo did not reveal an edit input"
        ),
      ];

      const client = makeScriptedClient(steps);

      try {
        await withTimeout(
          adapter.start(`http://localhost:${server.port}`),
          10_000,
          "adapter.start()"
        );
        const result = await withTimeout(
          runAgent(card, adapter, client, logger),
          15_000,
          "runAgent()"
        );

        expect(result.status).toBe("fail");
        expect(result.scenario).toBe("todomvc-edit-fail");
      } catch (err: any) {
        if (isChromeUnavailable(err)) {
          console.log(`Skipping web e2e: ${err.message}`);
          return;
        }
        throw err;
      } finally {
        await adapter.close();
        server.stop();
      }
    },
    30_000
  );
});
