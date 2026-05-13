import { describe, test, expect } from "bun:test";
import { ANSWER_TOOL, extractAnswer } from "../../src/revival/answer-tool";
import type { ToolCall } from "../../src/models/provider";

describe("ANSWER_TOOL", () => {
  test("has shape compatible with ToolDefinition", () => {
    expect(ANSWER_TOOL.name).toBe("answer");
    expect(typeof ANSWER_TOOL.description).toBe("string");
    expect(ANSWER_TOOL.parameters.type).toBe("object");
    const props = (ANSWER_TOOL.parameters as { properties: Record<string, unknown> }).properties;
    expect(props.answer).toBeDefined();
    expect((ANSWER_TOOL.parameters as { required: string[] }).required).toEqual(["answer"]);
  });
});

describe("extractAnswer", () => {
  test("returns {kind:'structured', text} when an answer tool call is present", () => {
    const calls: ToolCall[] = [{ id: "t1", name: "answer", arguments: { answer: "Because the form had validation errors." } }];
    const result = extractAnswer(calls, "ignored fallback text");
    expect(result).toEqual({ kind: "structured", text: "Because the form had validation errors." });
  });

  test("returns {kind:'unstructured', text} when no answer tool call but text is present", () => {
    const result = extractAnswer([], "I clicked because the page told me to.");
    expect(result).toEqual({ kind: "unstructured", text: "I clicked because the page told me to." });
  });

  test("ignores non-answer tool calls and falls back to text", () => {
    const calls: ToolCall[] = [{ id: "t1", name: "click", arguments: {} }];
    const result = extractAnswer(calls, "fallback");
    expect(result).toEqual({ kind: "unstructured", text: "fallback" });
  });

  test("handles non-string answer arg gracefully", () => {
    const calls: ToolCall[] = [{ id: "t1", name: "answer", arguments: { answer: 42 as unknown as string } }];
    const result = extractAnswer(calls, "fallback");
    expect(result).toEqual({ kind: "unstructured", text: "fallback" });
  });

  test("returns empty unstructured when neither answer call nor text", () => {
    const result = extractAnswer([], "");
    expect(result).toEqual({ kind: "unstructured", text: "" });
  });
});
