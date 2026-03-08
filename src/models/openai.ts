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
        tools: tools.length > 0 ? tools.map(convertTool) : undefined,
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
  const parts = msg.content.map((c) => {
    if (c.type === "image") {
      return {
        type: "image_url" as const,
        image_url: { url: `data:${c.mediaType || "image/png"};base64,${c.data}` },
      };
    }
    return { type: "text" as const, text: c.text! };
  });
  if (msg.role === "assistant") {
    return { role: "assistant" as const, content: parts.filter((p) => p.type === "text") };
  }
  return { role: "user" as const, content: parts };
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

  const toolCalls: AgentResponse["toolCalls"] = [];
  for (const tc of choice.message.tool_calls || []) {
    if (tc.type === "function") {
      toolCalls.push({
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      });
    }
  }

  const stopReason =
    choice.finish_reason === "tool_calls" ? "tool_use" : "end_turn";

  return { text, toolCalls, stopReason };
}
