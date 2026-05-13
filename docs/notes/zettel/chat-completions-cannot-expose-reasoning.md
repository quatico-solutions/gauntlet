---
title: "Chat Completions structurally cannot expose reasoning content; surfacing reasoning requires Responses API"
source: "../sources/openai-responses-api-sdk.md"
created: 2026-05-13
schema_version: 1
links: [effort-parameter-is-the-real-depth-lever, reasoning-summary-not-raw-thoughts, responses-api-item-stream-shape]
---

# Chat Completions structurally cannot expose reasoning content; surfacing reasoning requires Responses API

OpenAI's Chat Completions response object — `ChatCompletionMessage`
in the SDK — has fields for `content`, `refusal`, `role`,
`annotations`, `audio`, and `tool_calls`. There is no field for
reasoning content. Reasoning models still produce reasoning tokens
when called via Chat Completions (and you are billed for them, with
the count visible in `usage.completion_tokens_details.reasoning_
tokens`), but the tokens themselves are unreachable from the
response.

The Responses API exposes reasoning as a first-class output item
type — `ResponseReasoningItem` in `Response.output[]` — carrying
summaries (`summary[]`) and optionally encrypted opaque content
(`encrypted_content`). Even there, the *raw* chain of thought is
not exposed for safety reasons (see [[reasoning-summary-not-raw-thoughts]]).

The practical consequence: if you observe "the model's reasoning is
empty in our logs" for a Chat Completions integration, this is not
a code bug, not a configuration bug, and not something a SDK upgrade
will fix. It is a structural limit of the API surface. Surfacing
reasoning *requires* migrating to the Responses API.

This claim should also reframe how migration decisions get made.
"Should we move to the Responses API?" is sometimes posed as a
preference; for any application that wants to show or log model
reasoning, it is a hard constraint.

Source: OpenAI Node SDK v6.27.0, `node_modules/openai/resources/chat/
completions/completions.d.ts:792` (ChatCompletionMessage); same SDK
`responses/responses.d.ts:4367` (ResponseReasoningItem).
