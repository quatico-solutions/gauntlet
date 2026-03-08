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
