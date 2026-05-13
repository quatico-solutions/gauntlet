---
title: "Migrating to Responses API forces a stateless-vs-stateful choice; encrypted reasoning makes stateless viable"
source: "../sources/openai-responses-api-sdk.md"
created: 2026-05-13
schema_version: 1
links: [encrypted-reasoning-is-stateless-roundtrip]
---

# Migrating to Responses API forces a stateless-vs-stateful choice; encrypted reasoning makes stateless viable

The Responses API supports two architectural shapes for multi-turn
conversations, and any migration has to pick one (or both):

**Stateful.** Set `previous_response_id: <prior>` on each request.
OpenAI retains the conversation server-side. You don't resend
history. Smaller requests, simpler client. Cost: server-side coupling
(the audit trail lives on OpenAI's servers, not yours), opaque
state, harder to replay or branch a conversation, blocked under
Zero-Data-Retention policies.

**Stateless.** Send the full conversation as `input: ResponseInputItem[]`
on every turn. Set `store: false`. To preserve reasoning across turns,
also set `include: ['reasoning.encrypted_content']` and round-trip
the resulting `ResponseReasoningItem`s back through `input[]` on the
next turn (see [[encrypted-reasoning-is-stateless-roundtrip]]).
Larger requests; cache helps absorb the cost. Audit trail stays on
your side. ZDR-compatible by construction.

The decision rule: *match the shape of the integration you already
have*. An agent loop that already sends full history each turn (e.g.
because it interleaves with another provider, or because it persists
the conversation locally for replay/audit) is in stateless territory
already; going stateful is a regression. An integration starting
from scratch with no other provider in play and no audit needs can
go stateful for the simpler client code.

The encrypted-reasoning option is what makes "go stateless" not a
quality regression — without it, stateless multi-turn loses the
reasoning persistence that drives ~3% on SWE-bench (cookbook claim,
benchmark-shaped) and the 40→80% cache-utilization win OpenAI
reported. With it, stateless is functionally equivalent for quality.

The trade-off generalizes beyond OpenAI: any API offering both a
"server holds your context" mode and a "client holds context, server
is pure function" mode poses the same question. The right answer is
usually the one that matches the system's existing data-flow shape,
not the one with the smaller per-request payload.

Source: OpenAI Node SDK v6.27.0, `responses.d.ts:5971` (`previous_
response_id`), :6027 (`store`), :5917 (`include`); cookbook,
`examples/responses_api/reasoning_items.ipynb`.
