---
title: "OpenAI Responses API replaces messages[] with an item stream — input items in, output items out"
source: "../sources/openai-responses-api-sdk.md"
created: 2026-05-13
schema_version: 1
links: [chat-completions-cannot-expose-reasoning, reasoning-items-roundtrip-on-tool-turns]
---

# OpenAI Responses API replaces messages[] with an item stream — input items in, output items out

Chat Completions' interface is `messages: ChatCompletionMessageParam[]`
in, `choices[0].message` out. One assistant message per response,
with optional `tool_calls[]` nested inside it.

Responses inverts this. The request takes `input: ResponseInput`
(either a string for the simple case, or an array of `ResponseInputItem`
for the agent-loop case). The response returns `output: Array<
ResponseOutputItem>` — a heterogeneous list whose item types are
enumerated by the `ResponseOutputItem` union (currently 20+ kinds:
messages, function calls, reasoning, file-search results, computer-
use calls, code-interpreter calls, MCP calls, custom tool calls).

This is not a cosmetic change. It changes the mental model:

- A single response can contain multiple distinct items in arbitrary
  order — e.g. a reasoning item, then a function call, then a text
  message. Code that assumes "the response is one assistant message"
  doesn't translate.
- Tool calls are top-level items (`{type: 'function_call', call_id,
  name, arguments}`), not nested under a message. Tool results, on
  the way back, are also top-level (`{type: 'function_call_output',
  call_id, output}`), not `{role: 'tool'}` messages.
- The system prompt moves out of the item stream entirely, into the
  top-level `instructions` parameter.
- Reasoning items live in the same stream as everything else, which
  is what makes round-tripping them across turns natural (see
  [[reasoning-items-roundtrip-on-tool-turns]]).

The shape choice is what enables OpenAI's reasoning-model story: an
item stream has a place for reasoning items; a message-list does not.
This explains why the migration is structural rather than a parameter
change ([[chat-completions-cannot-expose-reasoning]]).

For agent-loop integrations, the migration touches at least:
request assembly (build `input[]` from history), response parsing
(walk `output[]` and route by item type), tool-call dispatch
(`call_id` not `id`), and tool-result return (different envelope).

Source: OpenAI Node SDK v6.27.0, `node_modules/openai/resources/
responses/responses.d.ts:2787` (ResponseInputItem union), :3871
(ResponseOutputItem union), :2330 (ResponseFunctionToolCall), :2372
(ResponseFunctionToolCallOutputItem).
