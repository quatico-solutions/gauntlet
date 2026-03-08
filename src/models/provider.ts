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
