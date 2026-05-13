# OpenAI Responses API Migration — Implementation Plan

**Status:** revised after review; ready to implement
**Author:** Penric@b821786d (Opus 4.7)
**Date:** 2026-05-13
**Ticket:** PRI-1594
**Spec:** `docs/openai-responses-migration-spec.md`

This is the HOW. Spec is the WHAT and WHY; refer there for design
decisions. This document orders the changes, notes the file-by-file
edits, and defines the validation gates.

## Ordering principle

Types first → message-replay shape adaptation → consumers → producer
→ tests → validation. Each step compiles cleanly before the next
starts; no in-flight broken commits between steps.

## Cross-cutting issue: `rawAssistantMessage` replay shape

Surfaced by plan-review: agent.ts at lines 333 and 407 (and revival
at `src/revival/rebuild-messages.ts:127`) push `response.rawAssistantMessage`
as a single value into the `messages[]` array. This works today
because Anthropic's `rawAssistantMessage` is a single
`{role:'assistant', content:[…]}` message object, which is what
Anthropic's `messages` API expects.

OpenAI Responses' `input[]` is a flat array of `ResponseInputItem`s
— *not* messages. A single OpenAI assistant turn produces multiple
items (reasoning, function calls, message). Wrapping them in
`{output: [...]}` would put a non-`ResponseInputItem` value into the
next request's `input[]` and the API would reject it.

**Fix:** have the OpenAI adapter return `rawAssistantMessage` as the
array of output items directly (`response.output`). At each push
site — `agent.ts:333`, `agent.ts:407`, `rebuild-messages.ts:127` —
spread when the value is an array, push when it's a single object:

```ts
if (Array.isArray(rawAssistantMessage)) {
  messages.push(...rawAssistantMessage);
} else {
  messages.push(rawAssistantMessage);
}
```

This keeps Anthropic's adapter unchanged and makes OpenAI's
`output[]` round-trip naturally. The provider-neutral type stays
`rawAssistantMessage: unknown` — the array-vs-object choice is the
adapter's concern, the dispatch is at the push site.

Three call sites total. This is its own step (Step 1b) below.

## Step 1 — Provider-neutral types (`src/models/provider.ts`)

Three additive type changes. No runtime behavior.

1. Add `reasoning?: string` to `AgentResponse`. Doc-comment: "Model's
   reasoning content for this turn. OpenAI populates with summary
   text from `ResponseReasoningItem.summary`. Anthropic populates
   with extended-thinking text when extended thinking is on (TODO,
   separate ticket). Undefined when the provider returned no
   reasoning."

2. Add a fourth optional parameter to `LLMClient.chat()`:
   ```ts
   chat(
     messages: unknown[],
     tools: ToolDefinition[],
     systemPrompt: string,
     requestContext?: { runId?: string },
   ): Promise<AgentResponse>;
   ```
   Doc-comment explaining: "Optional per-request context. Currently
   used by the OpenAI adapter for `prompt_cache_key` (set to
   `runId`). Anthropic ignores it; its caching uses `cache_control`
   breakpoints, not key-based routing."

3. Update the doc-comment on `TokenUsage.cacheCreationInputTokens`:
   "Tokens written to the prompt cache on this turn. Anthropic only
   — set from `cache_creation_input_tokens`. OpenAI's `ResponseUsage`
   returns only a read counter, no write counter."
   And on `cacheReadInputTokens`: "Tokens read from the prompt cache
   on this turn. Both providers populate this — Anthropic from
   `cache_read_input_tokens`, OpenAI from
   `input_tokens_details.cached_tokens`."

After step 1: `bun tsc --noEmit` passes (existing callers ignore the
new optional parameter and the new optional field).

## Step 1b — Adapt the `rawAssistantMessage` push sites

Update three call sites to spread arrays and push objects:

- `src/agent/agent.ts:333` — main loop, after a normal turn
- `src/agent/agent.ts:407` — grace-path, after the deadline turn
  (verify exact line during implementation)
- `src/revival/rebuild-messages.ts:127` — revival path

Each becomes the dispatch shown in the cross-cutting section above.

After step 1b: `bun test` passes. Anthropic's adapter still returns
a single object → push branch fires; behavior unchanged. OpenAI not
yet rewritten, still using Chat Completions and returning a single
object → push branch fires; behavior unchanged. The dispatch is
inert until the OpenAI rewrite (step 4).

## Step 2 — Logger surface (`src/evidence/logger.ts`)

Add `reasoning?: string` to `LlmResponseFields` (line 48). Doc-comment:
"Model's reasoning content for this turn (provider-neutral). Sourced
from `AgentResponse.reasoning`. Distinct from the verdict's
`reasoning` field on `RunEndFields` — that's the agent's
justification for its pass/fail/investigate verdict; this is what
the model thought during the turn."

Also document the rendered shape in the run.jsonl format. The
`docs/format.md` doc may need a one-line addition; check during
implementation.

After step 2: `bun tsc --noEmit` passes; no tests fail (the field is
optional and unread by the rest of the system at this point).

## Step 3 — Agent loop wiring (`src/agent/agent.ts`)

Two changes:

1. Lines 238 and 460 — pass `{ runId }` as the new fourth arg:
   ```ts
   const response = await client.chat(messages, tools, systemPrompt, { runId });
   ```
   `runId` is already in scope at both call sites (line 138 destructures
   it from `options`; line 196 stores it in the run context; the grace-
   path call site has access via the same closure).

2. Lines 259-272 — pass `reasoning: response.reasoning` to
   `logger.logLlmResponse({…})`. Keep the existing
   `thinkingBlocks` extraction unchanged for now: it's the path
   Anthropic still uses (until the separate Anthropic ticket lands
   and starts populating `AgentResponse.reasoning` itself). When
   that ticket lands, the block-iteration becomes redundant and is
   removed.

After step 3: `bun test` passes. Anthropic runs continue to log
`thinking` blocks via the legacy path; `reasoning` field is logged
as undefined for both providers until step 5 lands.

## Step 4 — OpenAI adapter rewrite (`src/models/openai.ts`)

The big change. Full file rewrite, but the public exports
(`createOpenAIClient`, `mapFinishReason`, `openaiToolResultMessages`)
keep their signatures. `mapFinishReason` may be deleted (no
`finish_reason` on Responses); decide in implementation whether to
keep as an exported no-op for compat or just remove + update callers
(it has no external callers per a grep).

### `createOpenAIClient`

```ts
export function createOpenAIClient(model: string): LLMClient {
  if (!process.env.OPENAI_API_KEY) { /* unchanged error */ }
  const client = new OpenAI();

  return {
    async chat(messages, tools, systemPrompt, requestContext) {
      const response = await withLlmErrorSanitization(() =>
        client.responses.create({
          model,
          instructions: systemPrompt,
          input: messages as OpenAI.Responses.ResponseInputItem[],
          tools: tools.length > 0 ? tools.map(convertTool) : undefined,
          reasoning: { effort: "medium", summary: "auto" },
          include: ["reasoning.encrypted_content"],
          store: false,
          ...(requestContext?.runId && { prompt_cache_key: requestContext.runId }),
        }),
      );
      return convertResponse(response);
    },
    userMessage(content: string) {
      return { type: "message", role: "user", content };
    },
    toolResultMessages: openaiToolResultMessages,
  };
}
```

Note: `userMessage` returns a Responses-shaped item, not a
Completions-shaped message. The agent loop treats the value as
opaque (`unknown[]`) and concatenates into `messages`, so this is
the right level to swap.

### `convertTool`

```ts
function convertTool(tool: ToolDefinition): OpenAI.Responses.FunctionTool {
  return {
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: false,
  };
}
```

(`strict` is required in the type — `boolean | null`. Pass `false`
to match current Chat Completions behavior.)

### `mapFinishReason` removal

`mapFinishReason` is exported but has no external callers
(internal: `src/models/openai.ts:108`; tests:
`test/models/openai.test.ts` — entire `describe("mapFinishReason"…)`
block, 7 tests). Delete the export, delete the test block; replace
with `deriveStopReason` tests in step 5.

### `convertResponse`

Walk `response.output[]`, bucket by item type:

```ts
export function convertResponse(response: OpenAI.Responses.Response): AgentResponse {
  let text = "";
  let reasoning = "";
  let hasRefusal = false;
  const toolCalls: ToolCall[] = [];

  for (const item of response.output) {
    switch (item.type) {
      case "message": {
        for (const part of item.content) {
          if (part.type === "output_text") text += part.text;
          else if (part.type === "refusal") { text += `[refusal] ${part.refusal}`; hasRefusal = true; }
        }
        break;
      }
      case "function_call":
        toolCalls.push({
          id: item.call_id,
          name: item.name,
          arguments: JSON.parse(item.arguments),
        });
        break;
      case "reasoning":
        for (const s of item.summary) reasoning += s.text;
        break;
      // Other item types ignored intentionally — see spec out-of-scope.
    }
  }

  const stopReason = deriveStopReason(response, toolCalls.length, hasRefusal);
  const cached = response.usage?.input_tokens_details?.cached_tokens ?? 0;
  const inputTokens = (response.usage?.input_tokens ?? 0) - cached;

  return {
    text,
    reasoning: reasoning || undefined,
    toolCalls,
    stopReason,
    rawAssistantMessage: response.output,
    usage: {
      inputTokens,
      outputTokens: response.usage?.output_tokens ?? 0,
      cacheReadInputTokens: cached || undefined,
    },
  };
}
```

`rawAssistantMessage: response.output` is the array of output items
(reasoning, function calls, message). Step 1b's spread-on-push
dispatch at `agent.ts:333`, `agent.ts:407`, and
`rebuild-messages.ts:127` replays them as flat `ResponseInputItem`s
into the next request's `input[]`. Reasoning items round-trip
naturally; nothing else in the agent loop needs to know they're
there.

### `deriveStopReason`

Per the spec's stopReason mapping table:

```ts
function deriveStopReason(
  r: OpenAI.Responses.Response,
  toolCallCount: number,
  hasRefusal: boolean,
): StopReason {
  if (toolCallCount > 0) return "tool_use";
  if (hasRefusal) return "refusal";
  if (r.status === "incomplete") {
    const reason = r.incomplete_details?.reason;
    if (reason === "max_output_tokens") return "max_tokens";
    if (reason === "content_filter") return "stop_sequence";
  }
  return "end_turn";
}
```

### `openaiToolResultMessages`

Emit `function_call_output` items with `call_id` matching, plus an
optional follow-up user-role item carrying images and/or
extra-user-text:

```ts
export function openaiToolResultMessages(
  calls: ToolCall[],
  results: ToolResult[],
  extraUserText?: string,
): unknown[] {
  const items: unknown[] = calls.map((call, i) => ({
    type: "function_call_output",
    call_id: call.id,
    output: results[i].text ?? "",
  }));

  const imageParts: unknown[] = [];
  for (const result of results) {
    if (result.image) {
      imageParts.push({
        type: "input_image",
        image_url: `data:${result.image.mediaType};base64,${result.image.data}`,
        detail: "auto",
      });
    }
  }

  if (imageParts.length > 0) {
    items.push({
      type: "message",
      role: "user",
      content: [
        { type: "input_text", text: "Screenshots from the tool calls above:" },
        ...imageParts,
      ],
    });
  }

  if (extraUserText) {
    items.push({
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: extraUserText }],
    });
  }

  return items;
}
```

Image content uses `ResponseInputImageContent` (`responses.d.ts:2760`):
`image_url` is a flat string (data URL), not nested under
`image_url.url` like Chat Completions. `detail: "auto"` is the
permissive default.

After step 4: `bun tsc --noEmit` passes; OpenAI tests likely fail
until step 5.

## Step 5 — Test updates (`test/models/openai.test.ts`)

1. Replace fixtures: any test that constructed a
   `ChatCompletion`-shaped fake response now constructs a `Response`-
   shaped fake.
2. Add tests for the four `stopReason` mapping cases (tool_use via
   function_call presence; refusal via output content; max_tokens
   via incomplete + max_output_tokens; end_turn default).
3. Add a test for `convertResponse` reasoning extraction:
   given an output containing a `'reasoning'` item with two summary
   parts, the returned `reasoning` field is the concatenation.
4. Add a test for token-accounting subtraction: given `input_tokens
   = 1500` and `cached_tokens = 1000`, `inputTokens = 500` and
   `cacheReadInputTokens = 1000`.
5. Add a test that `openaiToolResultMessages` produces correctly-
   shaped `function_call_output` items and that image attachments
   land as `input_image` items with flat `image_url` strings.
6. Add a test for `convertTool` flat shape (no `function:` nesting).
7. Add a test that `convertResponse` round-trips a `reasoning` item's
   `encrypted_content` byte-for-byte through `rawAssistantMessage`.
   This is the load-bearing behavior for the cache-utilization win
   the migration is justified by; if it regresses, we silently lose
   the win without any other test catching it.
8. Replace the deleted `mapFinishReason` describe block with
   `deriveStopReason` tests covering the four mapping cases.

After step 5: `bun test` passes.

## Step 6 — Sanity validation (manual)

Run against the established fixture:

```
bun run gauntlet run examples/tutorial/tutorial-04-login-credentials.md \
  --model gpt-5.4-mini \
  --reflection-interval 10000
```

Inspect the resulting `run.jsonl`:

1. Each `llm_response` row has a `reasoning` field populated with
   non-empty text (from turn 1 onward, when the model produced any
   reasoning).
2. From turn 2 onward, the `usage.cacheReadInputTokens` field is
   non-zero on most turns. Spot-check that it's plausible relative
   to total input.
3. Verdict matches the existing baseline behavior for this fixture
   on gpt-5.4-mini (~12–16 turns typical).

If any of the three fail, do not commit; debug.

## Step 7 — Anthropic compile check

Confirm `src/models/anthropic.ts` still compiles with the new
optional fourth parameter on `LLMClient.chat()` and the new optional
`AgentResponse.reasoning` field. No code changes expected; this is
just a `bun tsc --noEmit` sanity gate. The new parameter is optional
so the existing Anthropic adapter signature satisfies the interface
without modification.

## Step 8 — Doc updates

- `docs/format.md` — one-line note about the new `reasoning` field on
  `llm_response` rows; clarify it's distinct from the verdict's
  `reasoning`.
- `docs/openai-responses-migration-spec.md` — flip status to
  "implemented" once steps 1-7 are green.

## Test strategy

Per the project's existing pattern (no PRs; merge to main directly
after the work is green): each step compiles before moving on. Steps
1-3 are mechanical type/wiring changes with no behavioral risk —
batch into one commit. Steps 4-5 are the substantive change —
separate commit. Step 6 is the validation gate; step 7 is a sanity
gate; step 8 is paperwork — bundle into the step 4-5 commit.

Final commits:
- `model(openai): provider-neutral reasoning + runId plumbing (PRI-1594)`
- `model(openai): migrate to Responses API (PRI-1594)`

Both on `main`, no PR. Per `feedback_no_prs` memory.

## Rollback plan

If the migration breaks production OpenAI runs and we need to fall
back: revert the second commit (`migrate to Responses API`) only.
The first commit (provider-neutral reasoning + runId plumbing) is
additive and safe to leave in place; the previous Chat-Completions
adapter still satisfies the new optional-parameter signature without
changes. So the rollback path is one `git revert <commit>` away.

## Decisions inherited from the spec (recap, not redecide)

- Stateless mode + encrypted reasoning round-trip — not
  `previous_response_id`.
- `reasoning.summary: "auto"` default (open question in spec).
- Round-trip everything in `output[]` via `rawAssistantMessage` —
  the agent loop already does this (replays the whole prior turn);
  no extra work needed.

## Open questions (carried from spec)

1. `reasoning.summary` default — `"auto"` vs `"detailed"`.
   Recommendation: ship with `"auto"`; bump to `"detailed"` if
   summaries turn out too thin in step 6 validation.
2. (Spec open question #2 — round-trip everything) — answered by
   how the agent loop already works. No code decision needed.

## Risks (carried from spec, expanded with implementation specifics)

- `gpt-5-pro` operator paths will fail with hard-coded `effort:
  "medium"` (model only supports `"high"`). Today we don't run
  gpt-5-pro; if we ever do, the operator will see a clear error and
  can override. Not a blocker.
- The `userMessage()` shape change ripples through the agent loop's
  message accumulation — we're swapping
  `{role:'user', content:'...'}` for
  `{type:'message', role:'user', content:'...'}`. The agent loop
  treats values as opaque and just concatenates, so this is the
  right boundary for the change. Plan-reviewer: please verify by
  searching for `\.role` accesses on the OpenAI message side.
