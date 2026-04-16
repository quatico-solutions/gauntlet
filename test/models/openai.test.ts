import { describe, test, expect } from "bun:test";
import {
  createOpenAIClient,
  openaiToolResultMessages,
  mapFinishReason,
} from "../../src/models/openai";

describe("OpenAI message helpers", () => {
  test("toolResultMessages creates one tool message per call", () => {
    const calls = [
      { id: "call_abc", name: "screenshot", arguments: {} },
      { id: "call_def", name: "click", arguments: { x: 10, y: 20 } },
    ];
    const results = [{ text: "base64data" }, { text: "clicked" }];

    const messages = openaiToolResultMessages(calls, results);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({
      role: "tool",
      tool_call_id: "call_abc",
      content: "base64data",
    });
    expect(messages[1]).toEqual({
      role: "tool",
      tool_call_id: "call_def",
      content: "clicked",
    });
  });

  test("toolResultMessages appends user message with images when results contain images", () => {
    const calls = [
      { id: "call_abc", name: "screenshot", arguments: {} },
      { id: "call_def", name: "click", arguments: { x: 10, y: 20 } },
    ];
    const results = [
      { text: "Screenshot captured", image: { data: "iVBOR...", mediaType: "image/png" } },
      { text: "clicked" },
    ];

    const messages = openaiToolResultMessages(calls, results);

    // 2 tool messages + 1 user message with image
    expect(messages).toHaveLength(3);
    expect(messages[0]).toEqual({
      role: "tool",
      tool_call_id: "call_abc",
      content: "Screenshot captured",
    });
    expect(messages[1]).toEqual({
      role: "tool",
      tool_call_id: "call_def",
      content: "clicked",
    });
    expect(messages[2]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "Screenshots from the tool calls above:" },
        {
          type: "image_url",
          image_url: { url: "data:image/png;base64,iVBOR..." },
        },
      ],
    });
  });

  test("toolResultMessages with multiple images includes all in user message", () => {
    const calls = [
      { id: "call_1", name: "screenshot", arguments: {} },
      { id: "call_2", name: "click", arguments: { return_screenshot: true } },
    ];
    const results = [
      { text: "Screenshot 1", image: { data: "img1data", mediaType: "image/png" } },
      { text: "Clicked + screenshot", image: { data: "img2data", mediaType: "image/png" } },
    ];

    const messages = openaiToolResultMessages(calls, results);

    expect(messages).toHaveLength(3);
    const userMsg = messages[2] as any;
    expect(userMsg.role).toBe("user");
    expect(userMsg.content).toHaveLength(3); // 1 text + 2 images
    expect(userMsg.content[1].image_url.url).toBe("data:image/png;base64,img1data");
    expect(userMsg.content[2].image_url.url).toBe("data:image/png;base64,img2data");
  });

  test("toolResultMessages handles undefined text gracefully", () => {
    const calls = [{ id: "call_1", name: "eval", arguments: {} }];
    const results = [{ text: undefined as unknown as string }];

    const messages = openaiToolResultMessages(calls, results);

    expect(messages).toHaveLength(1);
    expect((messages[0] as any).content).toBe("");
  });

  test("toolResultMessages with no images returns only tool messages", () => {
    const calls = [{ id: "call_1", name: "click", arguments: {} }];
    const results = [{ text: "clicked" }];

    const messages = openaiToolResultMessages(calls, results);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      role: "tool",
      tool_call_id: "call_1",
      content: "clicked",
    });
  });
});

describe("mapFinishReason", () => {
  test("tool_calls → tool_use", () => {
    expect(mapFinishReason("tool_calls")).toBe("tool_use");
  });
  test("function_call (legacy) → tool_use", () => {
    expect(mapFinishReason("function_call")).toBe("tool_use");
  });
  test("length → max_tokens (surfaces truncation)", () => {
    expect(mapFinishReason("length")).toBe("max_tokens");
  });
  test("stop → end_turn", () => {
    expect(mapFinishReason("stop")).toBe("end_turn");
  });
  test("content_filter → stop_sequence (approximation)", () => {
    expect(mapFinishReason("content_filter")).toBe("stop_sequence");
  });
  test("null → end_turn", () => {
    expect(mapFinishReason(null)).toBe("end_turn");
  });
  test("unknown future value → end_turn (non-crashing default)", () => {
    expect(mapFinishReason("some_new_reason")).toBe("end_turn");
  });
});

const skip = !process.env.OPENAI_API_KEY;

describe.skipIf(skip)("OpenAIClient integration", () => {
  const client = skip ? null! : createOpenAIClient("gpt-5-mini");

  test("userMessage creates OpenAI user message format", () => {
    const msg = client.userMessage("hello");
    expect(msg).toEqual({ role: "user", content: "hello" });
  });
});
