# Fanout Completion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the fanout feature: validate generated cards, promote observations to stories, generate stories from failures, and expose fanout via the REST API.

**Architecture:** Three fanout triggers exist — manual expansion (CLI, done), observation promotion (new), and failure analysis (new). All share the same output: validated story card files with `parent:` references. The REST API gets `POST /fanout` and `POST /run` endpoints. Generated cards are always validated through `parseStoryCard()` before writing.

**Tech Stack:** Bun, TypeScript, Hono (API), Anthropic/OpenAI SDKs

---

### Task 1: Validate generated cards before writing

The CLI fanout writes raw LLM output to files without checking it parses as a valid story card. If the LLM forgets frontmatter or uses wrong format, we silently write garbage.

**Files:**
- Modify: `src/fanout/generator.ts`
- Modify: `test/fanout/generator.test.ts`

**Step 1: Write the failing test**

Add to `test/fanout/generator.test.ts`:

```typescript
import { parseStoryCard } from "../../src/format/story-card";

test("generateFanout returns only valid parseable story cards", async () => {
  const mockClient: LLMClient = {
    async chat() {
      return {
        text: [
          // Valid card
          "---\nid: story-001-a\ntitle: Variation A\nstatus: draft\nparent: story-001\n---\n\nEdge case test.\n\n## Acceptance Criteria\n\n- Shows error",
          // Invalid card (missing id)
          "This is not a valid card at all",
          // Valid card
          "---\nid: story-001-b\ntitle: Variation B\nstatus: draft\nparent: story-001\n---\n\nBoundary test.\n\n## Acceptance Criteria\n\n- Handles limit",
        ].join("\n---CARD---\n"),
        toolCalls: [],
        stopReason: "end_turn" as const,
        rawAssistantMessage: null,
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
    userMessage(content: string) {
      return { role: "user", content };
    },
    toolResultMessages() {
      return [];
    },
  };

  const card: StoryCard = {
    id: "story-001",
    title: "Test",
    status: "ready",
    tags: [],
    description: "Test",
    acceptanceCriteria: ["Works"],
    raw: "",
  };

  const cards = await generateFanout(card, mockClient);
  expect(cards).toHaveLength(2);
  // Every returned card must be parseable
  for (const c of cards) {
    expect(() => parseStoryCard(c)).not.toThrow();
  }
});
```

**Step 2: Run test to verify it fails**

Run: `bun test test/fanout/generator.test.ts`
Expected: FAIL — currently all 3 chunks are returned including the invalid one.

**Step 3: Implement validation in generateFanout**

In `src/fanout/generator.ts`, add validation:

```typescript
import { parseStoryCard } from "../format/story-card";

export async function generateFanout(
  card: StoryCard,
  client: LLMClient
): Promise<string[]> {
  const prompt = buildFanoutPrompt(card);
  const response = await client.chat(
    [client.userMessage(prompt)],
    [],
    "You are a QA test designer. Output story cards in markdown format."
  );

  return response.text
    .split("---CARD---")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((raw) => {
      try {
        parseStoryCard(raw);
        return true;
      } catch {
        return false;
      }
    });
}
```

**Step 4: Run test to verify it passes**

Run: `bun test test/fanout/generator.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/fanout/generator.ts test/fanout/generator.test.ts
git commit -m "feat: validate generated fanout cards before returning"
```

---

### Task 2: Observation promotion — generate stories from observations

When a vet run produces observations (bugs, UX issues, etc.), we should be able to generate story cards that specifically test those observations. This is a new function in the fanout module.

**Files:**
- Modify: `src/fanout/generator.ts`
- Modify: `test/fanout/generator.test.ts`

**Step 1: Write the failing test for buildObservationPrompt**

Add to `test/fanout/generator.test.ts`:

```typescript
import type { VetResult } from "../../src/types";

describe("buildObservationPrompt", () => {
  test("includes observation details and parent scenario", () => {
    const result: VetResult = {
      scenario: "login-flow",
      status: "pass",
      summary: "Login works",
      reasoning: "All criteria met",
      observations: [
        { kind: "bug", description: "Password field doesn't mask on mobile" },
        { kind: "a11y", description: "Missing aria-label on submit button" },
      ],
      evidence: { screenshots: [], log: "" },
      duration_ms: 5000,
    };

    const prompt = buildObservationPrompt(result);
    expect(prompt).toContain("login-flow");
    expect(prompt).toContain("Password field doesn't mask on mobile");
    expect(prompt).toContain("Missing aria-label on submit button");
    expect(prompt).toContain("bug");
    expect(prompt).toContain("a11y");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test test/fanout/generator.test.ts`
Expected: FAIL — `buildObservationPrompt` is not exported.

**Step 3: Implement buildObservationPrompt**

Add to `src/fanout/generator.ts`:

```typescript
import type { VetResult } from "../types";

export function buildObservationPrompt(result: VetResult): string {
  const obsLines = result.observations
    .map((o) => `- [${o.kind}] ${o.description}`)
    .join("\n");

  return `You are a QA test designer. A test run for scenario "${result.scenario}" produced the following observations:

${obsLines}

For each observation, generate a focused story card that specifically tests for this issue. Each card MUST include:
- A unique id (use the parent scenario id with a suffix, e.g., ${result.scenario}-obs-a)
- parent: ${result.scenario}
- tags: observation
- A clear title describing what to test
- A description explaining the issue and how to verify it
- Acceptance criteria (at least one)

Output each as a complete story card in markdown format with YAML frontmatter, separated by "---CARD---" markers.`;
}
```

**Step 4: Run test to verify it passes**

Run: `bun test test/fanout/generator.test.ts`
Expected: PASS

**Step 5: Write the failing test for generateFromObservations**

Add to `test/fanout/generator.test.ts`:

```typescript
test("generateFromObservations creates cards from observations", async () => {
  const mockClient: LLMClient = {
    async chat() {
      return {
        text: "---\nid: login-flow-obs-a\ntitle: Password masking on mobile\nstatus: draft\ntags: observation\nparent: login-flow\n---\n\nVerify password field masks input on mobile viewports.\n\n## Acceptance Criteria\n\n- Password characters are hidden on mobile",
        toolCalls: [],
        stopReason: "end_turn" as const,
        rawAssistantMessage: null,
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
    userMessage(content: string) {
      return { role: "user", content };
    },
    toolResultMessages() {
      return [];
    },
  };

  const result: VetResult = {
    scenario: "login-flow",
    status: "pass",
    summary: "Login works",
    reasoning: "All criteria met",
    observations: [
      { kind: "bug", description: "Password field doesn't mask on mobile" },
    ],
    evidence: { screenshots: [], log: "" },
    duration_ms: 5000,
  };

  const cards = await generateFromObservations(result, mockClient);
  expect(cards).toHaveLength(1);
  expect(cards[0]).toContain("login-flow-obs-a");
  expect(cards[0]).toContain("parent: login-flow");
  // Must be parseable
  expect(() => parseStoryCard(cards[0])).not.toThrow();
});
```

**Step 6: Implement generateFromObservations**

Add to `src/fanout/generator.ts`:

```typescript
export async function generateFromObservations(
  result: VetResult,
  client: LLMClient
): Promise<string[]> {
  if (result.observations.length === 0) return [];

  const prompt = buildObservationPrompt(result);
  const response = await client.chat(
    [client.userMessage(prompt)],
    [],
    "You are a QA test designer. Output story cards in markdown format."
  );

  return response.text
    .split("---CARD---")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((raw) => {
      try {
        parseStoryCard(raw);
        return true;
      } catch {
        return false;
      }
    });
}
```

**Step 7: Run tests to verify they pass**

Run: `bun test test/fanout/generator.test.ts`
Expected: PASS

**Step 8: Commit**

```bash
git add src/fanout/generator.ts test/fanout/generator.test.ts
git commit -m "feat: add observation promotion — generate stories from observations"
```

---

### Task 3: Failure analysis — generate stories from failed runs

When a vet run fails, we should generate follow-up story cards that zoom in on the failure to understand it better. Similar to observation promotion but uses the failure context.

**Files:**
- Modify: `src/fanout/generator.ts`
- Modify: `test/fanout/generator.test.ts`

**Step 1: Write the failing test for buildFailurePrompt**

Add to `test/fanout/generator.test.ts`:

```typescript
describe("buildFailurePrompt", () => {
  test("includes failure details and parent scenario", () => {
    const result: VetResult = {
      scenario: "checkout-flow",
      status: "fail",
      summary: "Payment form rejects valid card",
      reasoning: "Entered a valid Visa number but got 'Invalid card' error",
      observations: [],
      evidence: { screenshots: ["evidence/001.png"], log: "evidence/log.jsonl" },
      duration_ms: 8000,
    };

    const prompt = buildFailurePrompt(result);
    expect(prompt).toContain("checkout-flow");
    expect(prompt).toContain("Payment form rejects valid card");
    expect(prompt).toContain("Entered a valid Visa number");
  });

  test("returns null for non-fail results", () => {
    const result: VetResult = {
      scenario: "checkout-flow",
      status: "pass",
      summary: "Works fine",
      reasoning: "All good",
      observations: [],
      evidence: { screenshots: [], log: "" },
      duration_ms: 3000,
    };

    const prompt = buildFailurePrompt(result);
    expect(prompt).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test test/fanout/generator.test.ts`
Expected: FAIL — `buildFailurePrompt` is not exported.

**Step 3: Implement buildFailurePrompt**

Add to `src/fanout/generator.ts`:

```typescript
export function buildFailurePrompt(result: VetResult): string | null {
  if (result.status !== "fail") return null;

  return `You are a QA test designer. A test run for scenario "${result.scenario}" FAILED.

**Summary:** ${result.summary}
**Reasoning:** ${result.reasoning}

Generate 2-3 follow-up story cards that investigate this failure from different angles:
- Reproduce the exact failure with minimal steps
- Test related functionality that might share the same root cause
- Test the same flow with different valid inputs

Each card MUST include:
- A unique id (use the parent scenario id with a suffix, e.g., ${result.scenario}-fail-a)
- parent: ${result.scenario}
- tags: failure-analysis
- A clear title
- A description explaining what this variation investigates
- Acceptance criteria (at least one)

Output each as a complete story card in markdown format with YAML frontmatter, separated by "---CARD---" markers.`;
}
```

**Step 4: Run test to verify it passes**

Run: `bun test test/fanout/generator.test.ts`
Expected: PASS

**Step 5: Write the failing test for generateFromFailure**

Add to `test/fanout/generator.test.ts`:

```typescript
test("generateFromFailure creates cards from failed run", async () => {
  const mockClient: LLMClient = {
    async chat() {
      return {
        text: "---\nid: checkout-flow-fail-a\ntitle: Minimal repro of card rejection\nstatus: draft\ntags: failure-analysis\nparent: checkout-flow\n---\n\nReproduce the card rejection with a Visa test number.\n\n## Acceptance Criteria\n\n- Payment is accepted with valid Visa",
        toolCalls: [],
        stopReason: "end_turn" as const,
        rawAssistantMessage: null,
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
    userMessage(content: string) {
      return { role: "user", content };
    },
    toolResultMessages() {
      return [];
    },
  };

  const result: VetResult = {
    scenario: "checkout-flow",
    status: "fail",
    summary: "Payment form rejects valid card",
    reasoning: "Entered a valid Visa number but got error",
    observations: [],
    evidence: { screenshots: [], log: "" },
    duration_ms: 8000,
  };

  const cards = await generateFromFailure(result, mockClient);
  expect(cards).toHaveLength(1);
  expect(cards[0]).toContain("checkout-flow-fail-a");
  expect(cards[0]).toContain("parent: checkout-flow");
});

test("generateFromFailure returns empty for non-fail results", async () => {
  const mockClient: LLMClient = {
    async chat() {
      throw new Error("should not be called");
    },
    userMessage(content: string) {
      return { role: "user", content };
    },
    toolResultMessages() {
      return [];
    },
  };

  const result: VetResult = {
    scenario: "ok-flow",
    status: "pass",
    summary: "Fine",
    reasoning: "Fine",
    observations: [],
    evidence: { screenshots: [], log: "" },
    duration_ms: 1000,
  };

  const cards = await generateFromFailure(result, mockClient);
  expect(cards).toHaveLength(0);
});
```

**Step 6: Implement generateFromFailure**

Add to `src/fanout/generator.ts`:

```typescript
export async function generateFromFailure(
  result: VetResult,
  client: LLMClient
): Promise<string[]> {
  const prompt = buildFailurePrompt(result);
  if (!prompt) return [];

  const response = await client.chat(
    [client.userMessage(prompt)],
    [],
    "You are a QA test designer. Output story cards in markdown format."
  );

  return response.text
    .split("---CARD---")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((raw) => {
      try {
        parseStoryCard(raw);
        return true;
      } catch {
        return false;
      }
    });
}
```

**Step 7: Run tests to verify they pass**

Run: `bun test test/fanout/generator.test.ts`
Expected: PASS

**Step 8: Commit**

```bash
git add src/fanout/generator.ts test/fanout/generator.test.ts
git commit -m "feat: add failure analysis — generate follow-up stories from failed runs"
```

---

### Task 4: DRY up the generator — extract shared card-splitting logic

After Tasks 1-3, `generateFanout`, `generateFromObservations`, and `generateFromFailure` all share the same pattern: call LLM → split on `---CARD---` → validate. Extract a shared helper.

**Files:**
- Modify: `src/fanout/generator.ts`
- Test: `test/fanout/generator.test.ts` (run existing tests to verify refactor)

**Step 1: Extract the shared helper**

In `src/fanout/generator.ts`, add a private helper and refactor all three generate functions to use it:

```typescript
async function generateCards(
  prompt: string,
  client: LLMClient
): Promise<string[]> {
  const response = await client.chat(
    [client.userMessage(prompt)],
    [],
    "You are a QA test designer. Output story cards in markdown format."
  );

  return response.text
    .split("---CARD---")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((raw) => {
      try {
        parseStoryCard(raw);
        return true;
      } catch {
        return false;
      }
    });
}
```

Then simplify the three public functions:

```typescript
export async function generateFanout(card: StoryCard, client: LLMClient): Promise<string[]> {
  return generateCards(buildFanoutPrompt(card), client);
}

export async function generateFromObservations(result: VetResult, client: LLMClient): Promise<string[]> {
  if (result.observations.length === 0) return [];
  return generateCards(buildObservationPrompt(result), client);
}

export async function generateFromFailure(result: VetResult, client: LLMClient): Promise<string[]> {
  const prompt = buildFailurePrompt(result);
  if (!prompt) return [];
  return generateCards(prompt, client);
}
```

**Step 2: Run all tests to verify refactor is safe**

Run: `bun test test/fanout/generator.test.ts`
Expected: All tests PASS (no behavior change)

**Step 3: Commit**

```bash
git add src/fanout/generator.ts
git commit -m "refactor: extract shared generateCards helper in fanout module"
```

---

### Task 5: POST /fanout API endpoint

The design doc calls for `POST /fanout` on the REST API. This endpoint takes a scenario ID, runs fanout, writes the generated cards to the stories directory, and returns them.

**Files:**
- Create: `src/api/routes/fanout.ts`
- Modify: `src/api/server.ts`
- Create: `test/api/fanout.test.ts`

**Step 1: Write the failing test**

Create `test/api/fanout.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { createApp } from "../../src/api/server";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("POST /fanout/:id", () => {
  function setupDataDir() {
    const dataDir = mkdtempSync(join(tmpdir(), "vet-fanout-api-"));
    const storiesDir = join(dataDir, "stories");
    mkdirSync(storiesDir, { recursive: true });
    writeFileSync(
      join(storiesDir, "story-001.md"),
      "---\nid: story-001\ntitle: Test Story\nstatus: ready\n---\n\nA test story.\n\n## Acceptance Criteria\n\n- Works\n"
    );
    return { dataDir, storiesDir };
  }

  test("returns 404 for unknown scenario", async () => {
    const { dataDir } = setupDataDir();
    const app = createApp(dataDir);
    const res = await app.request("/fanout/nonexistent", { method: "POST" });
    expect(res.status).toBe(404);
  });

  test("returns 400 when no model config provided and no env var set", async () => {
    const { dataDir } = setupDataDir();
    const app = createApp(dataDir);
    // Clear env to ensure no fallback
    const saved = process.env.VET_AGENT_MODEL;
    delete process.env.VET_AGENT_MODEL;
    delete process.env.VET_FANOUT_MODEL;

    const res = await app.request("/fanout/story-001", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    // Should fail because no model is configured
    expect(res.status).toBe(400);

    if (saved) process.env.VET_AGENT_MODEL = saved;
  });

  test("generates cards and writes them to stories dir", async () => {
    const { dataDir, storiesDir } = setupDataDir();

    // We need to mock the LLM client. The cleanest way: the route accepts
    // an optional clientFactory for testing.
    const { fanoutRoutes } = await import("../../src/api/routes/fanout");
    const { Hono } = await import("hono");
    const app = new Hono();
    app.route(
      "/fanout",
      fanoutRoutes(dataDir, () => ({
        async chat() {
          return {
            text: "---\nid: story-001-a\ntitle: Variation A\nstatus: draft\nparent: story-001\n---\n\nEdge case.\n\n## Acceptance Criteria\n\n- Handles edge case\n",
            toolCalls: [],
            stopReason: "end_turn" as const,
            rawAssistantMessage: null,
            usage: { inputTokens: 0, outputTokens: 0 },
          };
        },
        userMessage(content: string) {
          return { role: "user", content };
        },
        toolResultMessages() {
          return [];
        },
      }))
    );

    const res = await app.request("/fanout/story-001", { method: "POST" });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.parent).toBe("story-001");
    expect(body.generated).toBe(1);

    // Verify files were written
    const files = readdirSync(storiesDir).filter((f) => f.startsWith("story-001-"));
    expect(files.length).toBe(1);
    const content = readFileSync(join(storiesDir, files[0]), "utf-8");
    expect(content).toContain("story-001-a");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test test/api/fanout.test.ts`
Expected: FAIL — module `../../src/api/routes/fanout` does not exist.

**Step 3: Implement the fanout route**

Create `src/api/routes/fanout.ts`:

```typescript
import { Hono } from "hono";
import { readdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { parseStoryCard } from "../../format/story-card";
import { generateFanout } from "../../fanout/generator";
import type { LLMClient } from "../../models/provider";
import type { StoryCard } from "../../format/story-card";

function findCard(
  storiesDir: string,
  id: string
): { card: StoryCard; filename: string } | undefined {
  if (!existsSync(storiesDir)) return undefined;
  const files = readdirSync(storiesDir).filter((f) => f.endsWith(".md"));
  for (const filename of files) {
    const content = readFileSync(join(storiesDir, filename), "utf-8");
    try {
      const card = parseStoryCard(content);
      if (card.id === id) return { card, filename };
    } catch {
      continue;
    }
  }
  return undefined;
}

export function fanoutRoutes(
  dataDir: string,
  clientFactory?: () => LLMClient
) {
  const router = new Hono();
  const storiesDir = join(dataDir, "stories");

  router.post("/:id", async (c) => {
    const entry = findCard(storiesDir, c.req.param("id"));
    if (!entry) return c.json({ error: "not found" }, 404);

    let client: LLMClient;
    if (clientFactory) {
      client = clientFactory();
    } else {
      const model =
        process.env.VET_FANOUT_MODEL || process.env.VET_AGENT_MODEL;
      if (!model) {
        return c.json(
          { error: "No model configured. Set VET_AGENT_MODEL or VET_FANOUT_MODEL." },
          400
        );
      }
      const { createClient } = await import("../../models/resolve");
      client = createClient(model);
    }

    const cards = await generateFanout(entry.card, client);

    for (let i = 0; i < cards.length; i++) {
      const filename = `${entry.card.id}-${String.fromCharCode(97 + i)}.md`;
      writeFileSync(join(storiesDir, filename), cards[i] + "\n");
    }

    return c.json({ parent: entry.card.id, generated: cards.length });
  });

  return router;
}
```

**Step 4: Wire the route into the server**

In `src/api/server.ts`, add:

```typescript
import { fanoutRoutes } from "./routes/fanout";

export function createApp(dataDir: string) {
  const app = new Hono();
  app.route("/scenarios", scenarioRoutes(dataDir));
  app.route("/results", resultRoutes(join(dataDir, "results")));
  app.route("/fanout", fanoutRoutes(dataDir));
  return app;
}
```

**Step 5: Run test to verify it passes**

Run: `bun test test/api/fanout.test.ts`
Expected: PASS

**Step 6: Run full test suite**

Run: `bun test`
Expected: All tests PASS

**Step 7: Commit**

```bash
git add src/api/routes/fanout.ts src/api/server.ts test/api/fanout.test.ts
git commit -m "feat: add POST /fanout/:id API endpoint"
```

---

### Task 5b: Deduplicate findCard between scenarios.ts and fanout.ts

Both `src/api/routes/scenarios.ts` and `src/api/routes/fanout.ts` have their own `findCard` function. Extract to a shared helper.

**Files:**
- Create: `src/api/routes/helpers.ts`
- Modify: `src/api/routes/scenarios.ts`
- Modify: `src/api/routes/fanout.ts`

**Step 1: Extract the shared helper**

Create `src/api/routes/helpers.ts`:

```typescript
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { parseStoryCard } from "../../format/story-card";
import type { StoryCard } from "../../format/story-card";

export function loadAllCards(storiesDir: string): { card: StoryCard; filename: string }[] {
  if (!existsSync(storiesDir)) return [];
  const files = readdirSync(storiesDir)
    .filter((f) => f.endsWith(".md"))
    .sort();

  return files.map((filename) => {
    const content = readFileSync(join(storiesDir, filename), "utf-8");
    return { card: parseStoryCard(content), filename };
  });
}

export function findCard(
  storiesDir: string,
  id: string
): { card: StoryCard; filename: string } | undefined {
  return loadAllCards(storiesDir).find((entry) => entry.card.id === id);
}
```

**Step 2: Update scenarios.ts to use the shared helper**

Remove the local `loadAllCards` and `findCard` from `src/api/routes/scenarios.ts` and import from `./helpers`:

```typescript
import { loadAllCards, findCard } from "./helpers";
```

**Step 3: Update fanout.ts to use the shared helper**

Remove the local `findCard` from `src/api/routes/fanout.ts` and import from `./helpers`:

```typescript
import { findCard } from "./helpers";
```

Remove the `fs` and `parseStoryCard` imports that are no longer needed in `fanout.ts`.

**Step 4: Run full test suite to verify refactor is safe**

Run: `bun test`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/api/routes/helpers.ts src/api/routes/scenarios.ts src/api/routes/fanout.ts
git commit -m "refactor: extract shared findCard/loadAllCards into API route helpers"
```

---

### Task 6: POST /fanout/:id/observations API endpoint

Promote observations from a specific result into new story cards.

**Files:**
- Modify: `src/api/routes/fanout.ts`
- Modify: `test/api/fanout.test.ts`

**Step 1: Write the failing test**

Add to `test/api/fanout.test.ts`:

```typescript
describe("POST /fanout/:id/observations", () => {
  function setupWithResult() {
    const dataDir = mkdtempSync(join(tmpdir(), "vet-fanout-obs-"));
    const storiesDir = join(dataDir, "stories");
    const resultsDir = join(dataDir, "results", "story-001");
    mkdirSync(storiesDir, { recursive: true });
    mkdirSync(resultsDir, { recursive: true });
    writeFileSync(
      join(storiesDir, "story-001.md"),
      "---\nid: story-001\ntitle: Test Story\nstatus: ready\n---\n\nA test story.\n\n## Acceptance Criteria\n\n- Works\n"
    );
    writeFileSync(
      join(resultsDir, "result.json"),
      JSON.stringify({
        scenario: "story-001",
        status: "pass",
        summary: "Works",
        reasoning: "All good",
        observations: [
          { kind: "bug", description: "Button misaligned on mobile" },
        ],
        evidence: { screenshots: [], log: "" },
        duration_ms: 3000,
      })
    );
    return { dataDir, storiesDir };
  }

  test("promotes observations to story cards", async () => {
    const { dataDir, storiesDir } = setupWithResult();
    const { fanoutRoutes } = await import("../../src/api/routes/fanout");
    const { Hono } = await import("hono");
    const app = new Hono();
    app.route(
      "/fanout",
      fanoutRoutes(dataDir, () => ({
        async chat() {
          return {
            text: "---\nid: story-001-obs-a\ntitle: Button alignment on mobile\nstatus: draft\ntags: observation\nparent: story-001\n---\n\nVerify button alignment on mobile viewports.\n\n## Acceptance Criteria\n\n- Button is properly aligned\n",
            toolCalls: [],
            stopReason: "end_turn" as const,
            rawAssistantMessage: null,
            usage: { inputTokens: 0, outputTokens: 0 },
          };
        },
        userMessage(content: string) {
          return { role: "user", content };
        },
        toolResultMessages() {
          return [];
        },
      }))
    );

    const res = await app.request("/fanout/story-001/observations", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.parent).toBe("story-001");
    expect(body.generated).toBe(1);

    const files = readdirSync(storiesDir).filter((f) =>
      f.startsWith("story-001-obs-")
    );
    expect(files.length).toBe(1);
  });

  test("returns 404 for scenario with no result", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "vet-fanout-obs-404-"));
    const storiesDir = join(dataDir, "stories");
    mkdirSync(storiesDir, { recursive: true });
    writeFileSync(
      join(storiesDir, "story-001.md"),
      "---\nid: story-001\ntitle: Test\nstatus: ready\n---\n\nTest.\n"
    );

    const { fanoutRoutes } = await import("../../src/api/routes/fanout");
    const { Hono } = await import("hono");
    const app = new Hono();
    app.route("/fanout", fanoutRoutes(dataDir));

    const res = await app.request("/fanout/story-001/observations", {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test test/api/fanout.test.ts`
Expected: FAIL — route does not exist, likely 404.

**Step 3: Implement the observations endpoint**

Add to `src/api/routes/fanout.ts`, inside `fanoutRoutes`:

```typescript
import { readFileSync, existsSync } from "fs";
import { generateFromObservations } from "../../fanout/generator";
import type { VetResult } from "../../types";

// Inside fanoutRoutes, add this route:
router.post("/:id/observations", async (c) => {
  const id = c.req.param("id");
  const resultPath = join(dataDir, "results", id, "result.json");

  if (!existsSync(resultPath)) {
    return c.json({ error: "No result found for scenario" }, 404);
  }

  const result: VetResult = JSON.parse(readFileSync(resultPath, "utf-8"));

  if (result.observations.length === 0) {
    return c.json({ parent: id, generated: 0 });
  }

  let client: LLMClient;
  if (clientFactory) {
    client = clientFactory();
  } else {
    const model = process.env.VET_FANOUT_MODEL || process.env.VET_AGENT_MODEL;
    if (!model) {
      return c.json(
        { error: "No model configured. Set VET_AGENT_MODEL or VET_FANOUT_MODEL." },
        400
      );
    }
    const { createClient } = await import("../../models/resolve");
    client = createClient(model);
  }

  const cards = await generateFromObservations(result, client);

  for (let i = 0; i < cards.length; i++) {
    const filename = `${id}-obs-${String.fromCharCode(97 + i)}.md`;
    writeFileSync(join(storiesDir, filename), cards[i] + "\n");
  }

  return c.json({ parent: id, generated: cards.length });
});
```

**Step 4: Run test to verify it passes**

Run: `bun test test/api/fanout.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/api/routes/fanout.ts test/api/fanout.test.ts
git commit -m "feat: add POST /fanout/:id/observations endpoint"
```

---

### Task 7: POST /fanout/:id/failure API endpoint

Generate follow-up stories from a failed run.

**Files:**
- Modify: `src/api/routes/fanout.ts`
- Modify: `test/api/fanout.test.ts`

**Step 1: Write the failing test**

Add to `test/api/fanout.test.ts`:

```typescript
describe("POST /fanout/:id/failure", () => {
  test("generates follow-up stories from a failed run", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "vet-fanout-fail-"));
    const storiesDir = join(dataDir, "stories");
    const resultsDir = join(dataDir, "results", "story-002");
    mkdirSync(storiesDir, { recursive: true });
    mkdirSync(resultsDir, { recursive: true });
    writeFileSync(
      join(storiesDir, "story-002.md"),
      "---\nid: story-002\ntitle: Checkout\nstatus: ready\n---\n\nCheckout flow.\n\n## Acceptance Criteria\n\n- Payment succeeds\n"
    );
    writeFileSync(
      join(resultsDir, "result.json"),
      JSON.stringify({
        scenario: "story-002",
        status: "fail",
        summary: "Payment rejected",
        reasoning: "Valid card rejected",
        observations: [],
        evidence: { screenshots: [], log: "" },
        duration_ms: 5000,
      })
    );

    const { fanoutRoutes } = await import("../../src/api/routes/fanout");
    const { Hono } = await import("hono");
    const app = new Hono();
    app.route(
      "/fanout",
      fanoutRoutes(dataDir, () => ({
        async chat() {
          return {
            text: "---\nid: story-002-fail-a\ntitle: Minimal repro\nstatus: draft\ntags: failure-analysis\nparent: story-002\n---\n\nReproduce with different card.\n\n## Acceptance Criteria\n\n- Card is accepted\n",
            toolCalls: [],
            stopReason: "end_turn" as const,
            rawAssistantMessage: null,
            usage: { inputTokens: 0, outputTokens: 0 },
          };
        },
        userMessage(content: string) {
          return { role: "user", content };
        },
        toolResultMessages() {
          return [];
        },
      }))
    );

    const res = await app.request("/fanout/story-002/failure", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.parent).toBe("story-002");
    expect(body.generated).toBe(1);
  });

  test("returns 400 when result is not a failure", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "vet-fanout-fail-pass-"));
    const resultsDir = join(dataDir, "results", "story-003");
    mkdirSync(resultsDir, { recursive: true });
    writeFileSync(
      join(resultsDir, "result.json"),
      JSON.stringify({
        scenario: "story-003",
        status: "pass",
        summary: "Works",
        reasoning: "Fine",
        observations: [],
        evidence: { screenshots: [], log: "" },
        duration_ms: 1000,
      })
    );

    const { fanoutRoutes } = await import("../../src/api/routes/fanout");
    const { Hono } = await import("hono");
    const app = new Hono();
    app.route("/fanout", fanoutRoutes(dataDir));

    const res = await app.request("/fanout/story-003/failure", {
      method: "POST",
    });
    expect(res.status).toBe(400);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test test/api/fanout.test.ts`
Expected: FAIL — route does not exist.

**Step 3: Implement the failure endpoint**

Add to `src/api/routes/fanout.ts`, inside `fanoutRoutes`:

```typescript
import { generateFromFailure } from "../../fanout/generator";

router.post("/:id/failure", async (c) => {
  const id = c.req.param("id");
  const resultPath = join(dataDir, "results", id, "result.json");

  if (!existsSync(resultPath)) {
    return c.json({ error: "No result found for scenario" }, 404);
  }

  const result: VetResult = JSON.parse(readFileSync(resultPath, "utf-8"));

  if (result.status !== "fail") {
    return c.json({ error: "Result is not a failure" }, 400);
  }

  let client: LLMClient;
  if (clientFactory) {
    client = clientFactory();
  } else {
    const model = process.env.VET_FANOUT_MODEL || process.env.VET_AGENT_MODEL;
    if (!model) {
      return c.json(
        { error: "No model configured. Set VET_AGENT_MODEL or VET_FANOUT_MODEL." },
        400
      );
    }
    const { createClient } = await import("../../models/resolve");
    client = createClient(model);
  }

  const cards = await generateFromFailure(result, client);

  for (let i = 0; i < cards.length; i++) {
    const filename = `${id}-fail-${String.fromCharCode(97 + i)}.md`;
    writeFileSync(join(storiesDir, filename), cards[i] + "\n");
  }

  return c.json({ parent: id, generated: cards.length });
});
```

**Step 4: Run test to verify it passes**

Run: `bun test test/api/fanout.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/api/routes/fanout.ts test/api/fanout.test.ts
git commit -m "feat: add POST /fanout/:id/failure endpoint"
```

---

### Task 8: DRY up the client resolution in fanout routes

After Tasks 5-7, the fanout route has the same client resolution block repeated three times. Extract it.

**Files:**
- Modify: `src/api/routes/fanout.ts`

**Step 1: Extract resolveClient helper**

Add a local helper inside `fanoutRoutes`:

```typescript
async function resolveClient(): Promise<LLMClient | null> {
  if (clientFactory) return clientFactory();
  const model = process.env.VET_FANOUT_MODEL || process.env.VET_AGENT_MODEL;
  if (!model) return null;
  const { createClient } = await import("../../models/resolve");
  return createClient(model);
}
```

Then replace all three client resolution blocks with:

```typescript
const client = await resolveClient();
if (!client) {
  return c.json(
    { error: "No model configured. Set VET_AGENT_MODEL or VET_FANOUT_MODEL." },
    400
  );
}
```

**Step 2: Run full test suite**

Run: `bun test`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add src/api/routes/fanout.ts
git commit -m "refactor: extract resolveClient helper in fanout routes"
```

---

### Task 9: CLI commands for observation and failure fanout

Extend the CLI so users can run `vet fanout --from-result <result-dir>` to trigger observation promotion or failure analysis from the command line.

**Files:**
- Modify: `src/cli/args.ts`
- Modify: `src/cli/fanout.ts`
- Modify: `src/index.ts`
- Modify: `test/cli/args.test.ts`

**Step 1: Write failing test for new args**

Add to `test/cli/args.test.ts`:

```typescript
test("fanout --from-result parses result directory", () => {
  const result = parseArgs(["bun", "script", "fanout", "--from-result", "./evidence/story-001"]);
  expect(result.command).toBe("fanout");
  expect((result as FanoutArgs).resultDir).toBe("./evidence/story-001");
});
```

**Step 2: Run test to verify it fails**

Run: `bun test test/cli/args.test.ts`
Expected: FAIL — `resultDir` is not in FanoutArgs.

**Step 3: Update FanoutArgs and parseFanoutArgs**

In `src/cli/args.ts`:

```typescript
export interface FanoutArgs {
  command: "fanout";
  scenarioPath?: string;     // was required, now optional (either scenario or result)
  resultDir?: string;        // new: path to result directory
  outDir: string;
  models: ModelConfig;
}
```

Update `parseFanoutArgs`:

```typescript
function parseFanoutArgs(args: string[]): FanoutArgs {
  const positional = extractPositional(args);
  const flags = parseFlags(args);

  const resultDir = flags["from-result"];

  if (!positional && !resultDir) {
    throw new Error(
      "Missing scenario path or --from-result\n\nUsage:\n  vet fanout <scenario.md>\n  vet fanout --from-result <result-dir>"
    );
  }

  return {
    command: "fanout",
    scenarioPath: positional,
    resultDir,
    outDir: flags.out ?? "./",
    models: parseModelFlags(flags.model ?? []),
  };
}
```

**Step 4: Update the CLI fanout handler**

In `src/cli/fanout.ts`:

```typescript
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { parseStoryCard } from "../format/story-card";
import { generateFanout, generateFromObservations, generateFromFailure } from "../fanout/generator";
import { createClient } from "../models/resolve";
import type { ModelConfig } from "../types";
import type { VetResult } from "../types";

export async function fanout(
  scenarioPath: string | undefined,
  outDir: string,
  models: ModelConfig,
  resultDir?: string
): Promise<void> {
  const model = models.fanout || models.agent;
  const client = createClient(model);

  if (resultDir) {
    // Fanout from result (observations + failure analysis)
    const resultPath = join(resultDir, "result.json");
    const result: VetResult = JSON.parse(readFileSync(resultPath, "utf-8"));
    const allCards: string[] = [];

    // Observation promotion
    if (result.observations.length > 0) {
      const obsCards = await generateFromObservations(result, client);
      allCards.push(...obsCards);
    }

    // Failure analysis
    if (result.status === "fail") {
      const failCards = await generateFromFailure(result, client);
      allCards.push(...failCards);
    }

    if (allCards.length === 0) {
      console.log(JSON.stringify({ parent: result.scenario, generated: 0 }));
      return;
    }

    mkdirSync(outDir, { recursive: true });
    for (let i = 0; i < allCards.length; i++) {
      const filename = `${result.scenario}-${String.fromCharCode(97 + i)}.md`;
      writeFileSync(join(outDir, filename), allCards[i] + "\n");
      console.error(`Generated: ${filename}`);
    }

    console.log(JSON.stringify({ parent: result.scenario, generated: allCards.length }));
  } else if (scenarioPath) {
    // Original fanout from scenario
    const content = readFileSync(scenarioPath, "utf-8");
    const card = parseStoryCard(content);
    const cards = await generateFanout(card, client);

    mkdirSync(outDir, { recursive: true });
    for (let i = 0; i < cards.length; i++) {
      const filename = `${card.id}-${String.fromCharCode(97 + i)}.md`;
      writeFileSync(join(outDir, filename), cards[i] + "\n");
      console.error(`Generated: ${filename}`);
    }

    console.log(JSON.stringify({ parent: card.id, generated: cards.length }));
  }
}
```

**Step 5: Update index.ts to pass new arg**

In `src/index.ts`, update the fanout case:

```typescript
case "fanout": {
  const { fanout } = await import("./cli/fanout");
  await fanout(args.scenarioPath, args.outDir, args.models, args.resultDir);
  break;
}
```

**Step 6: Run tests**

Run: `bun test test/cli/args.test.ts`
Expected: PASS

Run: `bun test`
Expected: All tests PASS

**Step 7: Commit**

```bash
git add src/cli/args.ts src/cli/fanout.ts src/index.ts test/cli/args.test.ts
git commit -m "feat: add --from-result flag for observation and failure fanout via CLI"
```

---

### Task 10: POST /run API endpoint

The design doc calls for `POST /run` to trigger scenario execution via the API. This is a simpler endpoint that starts a run and returns the result.

**Files:**
- Create: `src/api/routes/run.ts`
- Modify: `src/api/server.ts`
- Create: `test/api/run.test.ts`

**Step 1: Write the failing test**

Create `test/api/run.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { Hono } from "hono";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("POST /run/:id", () => {
  test("returns 404 for unknown scenario", async () => {
    const { runRoutes } = await import("../../src/api/routes/run");
    const dataDir = mkdtempSync(join(tmpdir(), "vet-run-api-"));
    mkdirSync(join(dataDir, "stories"), { recursive: true });

    const app = new Hono();
    app.route("/run", runRoutes(dataDir));

    const res = await app.request("/run/nonexistent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: "http://localhost:3000", adapter: "web" }),
    });
    expect(res.status).toBe(404);
  });

  test("returns 400 when target is missing", async () => {
    const { runRoutes } = await import("../../src/api/routes/run");
    const dataDir = mkdtempSync(join(tmpdir(), "vet-run-api-"));
    const storiesDir = join(dataDir, "stories");
    mkdirSync(storiesDir, { recursive: true });
    writeFileSync(
      join(storiesDir, "story-001.md"),
      "---\nid: story-001\ntitle: Test\nstatus: ready\n---\n\nTest.\n\n## Acceptance Criteria\n\n- Works\n"
    );

    const app = new Hono();
    app.route("/run", runRoutes(dataDir));

    const res = await app.request("/run/story-001", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test test/api/run.test.ts`
Expected: FAIL — module does not exist.

**Step 3: Implement the run route**

Create `src/api/routes/run.ts`:

```typescript
import { Hono } from "hono";
import { join } from "path";
import { findCard } from "./helpers";
import { EvidenceLogger } from "../../evidence/logger";
import { writeResultFiles } from "../../evidence/writer";
import { runAgent } from "../../agent/agent";
import type { Adapter } from "../../adapters/adapter";

export function runRoutes(dataDir: string) {
  const router = new Hono();
  const storiesDir = join(dataDir, "stories");

  router.post("/:id", async (c) => {
    const entry = findCard(storiesDir, c.req.param("id"));
    if (!entry) return c.json({ error: "not found" }, 404);

    let body: { target?: string; adapter?: string; model?: string };
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }

    const target = body.target;
    if (!target) {
      return c.json({ error: "Missing required field: target" }, 400);
    }

    const adapterType = (body.adapter ?? "web") as "web" | "cli" | "tui";
    const model = body.model || process.env.VET_AGENT_MODEL;
    if (!model) {
      return c.json(
        { error: "No model configured. Set VET_AGENT_MODEL or pass model in body." },
        400
      );
    }

    const { createClient } = await import("../../models/resolve");
    const client = createClient(model);

    const resultDir = join(dataDir, "results", entry.card.id);
    const logger = new EvidenceLogger(resultDir);

    let adapter: Adapter;
    switch (adapterType) {
      case "cli": {
        const { CLIAdapter } = await import("../../adapters/cli/adapter");
        adapter = new CLIAdapter();
        break;
      }
      case "tui": {
        const { TUIAdapter } = await import("../../adapters/tui/adapter");
        adapter = new TUIAdapter();
        break;
      }
      case "web": {
        const { WebAdapter } = await import("../../adapters/web/adapter");
        adapter = new WebAdapter();
        break;
      }
    }

    try {
      await adapter.start(target);
      const result = await runAgent(entry.card, adapter, client, logger, target);
      writeResultFiles(resultDir, result);
      return c.json(result);
    } finally {
      await adapter.close();
    }
  });

  return router;
}
```

**Step 4: Wire into server**

In `src/api/server.ts`:

```typescript
import { runRoutes } from "./routes/run";

export function createApp(dataDir: string) {
  const app = new Hono();
  app.route("/scenarios", scenarioRoutes(dataDir));
  app.route("/results", resultRoutes(join(dataDir, "results")));
  app.route("/fanout", fanoutRoutes(dataDir));
  app.route("/run", runRoutes(dataDir));
  return app;
}
```

**Step 5: Run test to verify it passes**

Run: `bun test test/api/run.test.ts`
Expected: PASS

**Step 6: Run full test suite**

Run: `bun test`
Expected: All tests PASS

**Step 7: Commit**

```bash
git add src/api/routes/run.ts src/api/server.ts test/api/run.test.ts
git commit -m "feat: add POST /run/:id API endpoint"
```

---

### Task 11: E2E test for CLI fanout command

Verify the full `vet fanout` CLI flow with a mocked LLM (or at minimum, verify args parsing and file I/O without hitting a real API).

**Files:**
- Create: `test/e2e/cli-fanout.test.ts`

**Step 1: Write the e2e test**

Create `test/e2e/cli-fanout.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, readdirSync, readFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { generateFanout } from "../../src/fanout/generator";
import { parseStoryCard } from "../../src/format/story-card";
import type { LLMClient } from "../../src/models/provider";

describe("fanout e2e", () => {
  test("generateFanout produces parseable cards that round-trip", async () => {
    const mockClient: LLMClient = {
      async chat() {
        return {
          text: [
            "---\nid: story-001-a\ntitle: Empty input edge case\nstatus: draft\ntags: edge-case\nparent: story-001\n---\n\nTest behavior with empty input.\n\n## Acceptance Criteria\n\n- Error message is shown\n",
            "---\nid: story-001-b\ntitle: Very long input\nstatus: draft\ntags: edge-case\nparent: story-001\n---\n\nTest behavior with extremely long input.\n\n## Acceptance Criteria\n\n- Input is truncated or rejected gracefully\n",
          ].join("---CARD---\n"),
          toolCalls: [],
          stopReason: "end_turn" as const,
          rawAssistantMessage: null,
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      },
      userMessage(content: string) {
        return { role: "user", content };
      },
      toolResultMessages() {
        return [];
      },
    };

    const card = parseStoryCard(
      "---\nid: story-001\ntitle: User adds todo\nstatus: ready\n---\n\nUser can add a todo item.\n\n## Acceptance Criteria\n\n- Item appears in list\n"
    );

    const generated = await generateFanout(card, mockClient);
    expect(generated.length).toBeGreaterThan(0);

    // Every generated card should parse and have parent reference
    for (const raw of generated) {
      const parsed = parseStoryCard(raw);
      expect(parsed.parent).toBe("story-001");
      expect(parsed.id).toBeTruthy();
      expect(parsed.title).toBeTruthy();
    }

    // Write and re-read to verify file round-trip
    const outDir = mkdtempSync(join(tmpdir(), "vet-fanout-e2e-"));
    for (let i = 0; i < generated.length; i++) {
      const filename = `${card.id}-${String.fromCharCode(97 + i)}.md`;
      writeFileSync(join(outDir, filename), generated[i] + "\n");
    }

    const files = readdirSync(outDir).filter((f) => f.endsWith(".md"));
    expect(files.length).toBe(generated.length);

    for (const file of files) {
      const content = readFileSync(join(outDir, file), "utf-8");
      const reparsed = parseStoryCard(content);
      expect(reparsed.parent).toBe("story-001");
    }
  });

  test("observation promotion produces parseable cards with correct parent", async () => {
    const { generateFromObservations } = await import("../../src/fanout/generator");

    const mockClient: LLMClient = {
      async chat() {
        return {
          text: "---\nid: login-obs-a\ntitle: Check mobile masking\nstatus: draft\ntags: observation\nparent: login\n---\n\nVerify password masking on mobile.\n\n## Acceptance Criteria\n\n- Password is masked\n",
          toolCalls: [],
          stopReason: "end_turn" as const,
          rawAssistantMessage: null,
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      },
      userMessage(content: string) {
        return { role: "user", content };
      },
      toolResultMessages() {
        return [];
      },
    };

    const cards = await generateFromObservations(
      {
        scenario: "login",
        status: "pass",
        summary: "Login works",
        reasoning: "OK",
        observations: [
          { kind: "bug", description: "Password not masked on mobile" },
        ],
        evidence: { screenshots: [], log: "" },
        duration_ms: 3000,
      },
      mockClient
    );

    expect(cards.length).toBe(1);
    const parsed = parseStoryCard(cards[0]);
    expect(parsed.parent).toBe("login");
    expect(parsed.tags).toContain("observation");
  });
});
```

**Step 2: Run test to verify it passes**

Run: `bun test test/e2e/cli-fanout.test.ts`
Expected: PASS (this test uses mocked clients, no real LLM calls)

**Step 3: Commit**

```bash
git add test/e2e/cli-fanout.test.ts
git commit -m "test: add e2e tests for fanout generation and observation promotion"
```
