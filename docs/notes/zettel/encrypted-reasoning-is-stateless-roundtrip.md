---
title: "Encrypted reasoning items let stateless agent loops keep reasoning across turns without server-side state"
source: "../sources/openai-reasoning-items-cookbook.md"
created: 2026-05-13
schema_version: 1
links: [reasoning-items-roundtrip-on-tool-turns, stateless-vs-stateful-responses-migration]
---

# Encrypted reasoning items let stateless agent loops keep reasoning across turns without server-side state

OpenAI's Responses API offers two ways to preserve reasoning items
across turns: stateful (`previous_response_id`, OpenAI keeps state
server-side) or stateless (you keep state client-side). For
stateless, the mechanism is encrypted reasoning items.

The mechanism: add `'reasoning.encrypted_content'` to `include` on
the request. Each `ResponseReasoningItem` in the response then
carries an `encrypted_content` field — an opaque string that
encodes the model's reasoning state, encrypted with a key OpenAI
holds. The client cannot read it; the client's only valid operation
is to round-trip it back into `input[]` on the next request.

OpenAI decrypts in-memory at request time, uses the items for
generation, and discards. Nothing is persisted server-side
(critically, this is enforced for Zero-Data-Retention organizations:
ZDR forces `store: false` and `encrypted_content` is the supported
path).

For an agent loop that already sends full conversation history each
turn (because it has its own audit log, replay capability, or runs
against multiple providers), this is the path of least resistance
for the Responses migration: nothing about the loop's data-flow
shape changes, only the items being carried get richer. Compare
[[stateless-vs-stateful-responses-migration]] for the full
trade-off.

The encryption is a privacy/safety mechanism, not a contract you can
build behavior on — you can't inspect, modify, or splice
`encrypted_content`. Treat it as a black box you receive and return.

The cost of the round trip is bandwidth (encrypted_content is not
small) but is offset by cache hits and quality (per
[[reasoning-items-roundtrip-on-tool-turns]]).

Source: OpenAI cookbook, `examples/responses_api/reasoning_items.
ipynb`, "Encrypted Reasoning Items" section.
