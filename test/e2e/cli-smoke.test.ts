import { describe, test, expect } from "bun:test";
import { runAgent } from "../../src/agent/agent";
import { CLIAdapter } from "../../src/adapters/cli/adapter";
import { EvidenceLogger } from "../../src/evidence/logger";
import type { LLMClient, ToolCall, AgentResponse } from "../../src/models/provider";
import type { StoryCard } from "../../src/format/story-card";
import { join } from "path";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";

const card: StoryCard = {
  id: "cli-smoke-001",
  title: "Echo app responds to input",
  status: "ready",
  tags: [],
  description: "Verify the echo app prints input back",
  acceptanceCriteria: ["App echoes typed input"],
  raw: "",
};

const FIXTURE_PATH = join(import.meta.dir, "../fixtures/echo-app.sh");

function makeScriptedClient(steps: AgentResponse[]): LLMClient {
  let callIndex = 0;

  return {
    async chat() {
      // Small delay to let the process produce output
      await Bun.sleep(300);
      const response = steps[callIndex++];
      if (!response) throw new Error("No more scripted responses");
      return response;
    },
    userMessage(content: string) {
      return { role: "user", content };
    },
    toolResultMessages(calls: ToolCall[], results: string[]) {
      return calls.map((call, i) => ({
        role: "tool_result",
        tool_call_id: call.id,
        content: results[i],
      }));
    },
  };
}

describe("CLI adapter e2e smoke test", () => {
  test("runs agent loop against a real CLI process", async () => {
    const adapter = new CLIAdapter();
    const logDir = mkdtempSync(join(tmpdir(), "vet-cli-smoke-"));
    const logger = new EvidenceLogger(logDir);

    const steps: AgentResponse[] = [
      // Turn 1: read_output — should see welcome message
      {
        text: "Let me read the initial output",
        toolCalls: [{ id: "call_1", name: "read_output", arguments: {} }],
        stopReason: "tool_use",
        rawAssistantMessage: { role: "assistant", content: "read initial" },
      },
      // Turn 2: type "hello world\n"
      {
        text: "I see the welcome message, let me type something",
        toolCalls: [
          { id: "call_2", name: "type", arguments: { text: "hello world\n" } },
        ],
        stopReason: "tool_use",
        rawAssistantMessage: { role: "assistant", content: "typing" },
      },
      // Turn 3: read_output — should see "You said: hello world"
      {
        text: "Let me read the response",
        toolCalls: [{ id: "call_3", name: "read_output", arguments: {} }],
        stopReason: "tool_use",
        rawAssistantMessage: { role: "assistant", content: "read response" },
      },
      // Turn 4: report result
      {
        text: "The echo app works correctly",
        toolCalls: [
          {
            id: "call_4",
            name: "report_result",
            arguments: {
              status: "pass",
              summary: "Echo app correctly echoes input",
              reasoning:
                "The app displayed a welcome message and echoed back the typed input",
            },
          },
        ],
        stopReason: "tool_use",
        rawAssistantMessage: { role: "assistant", content: "reporting" },
      },
    ];

    const client = makeScriptedClient(steps);

    try {
      await adapter.start(`bash ${FIXTURE_PATH}`);
      const result = await runAgent(card, adapter, client, logger);

      expect(result.status).toBe("pass");
      expect(result.scenario).toBe("cli-smoke-001");
      expect(result.summary).toBe("Echo app correctly echoes input");
    } finally {
      await adapter.close();
    }
  });
});
