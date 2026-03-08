import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { fanoutRoutes } from "../../src/api/routes/fanout";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Hono } from "hono";
import type { LLMClient } from "../../src/models/provider";

const STORY_MD = `---
id: story-001
title: Test story
status: draft
tags: core
---

A test story.

## Acceptance Criteria
- Something works
`;

function makeFakeClient(responseText: string): LLMClient {
  return {
    chat: async () => ({
      text: responseText,
      toolCalls: [],
      stopReason: "end_turn" as const,
      rawAssistantMessage: null,
      usage: { inputTokens: 0, outputTokens: 0 },
    }),
    userMessage: (content: string) => ({ role: "user", content }),
    toolResultMessages: () => [],
  };
}

const GENERATED_CARD_A = `---
id: story-001-a
title: Edge case empty input
status: draft
tags: core
parent: story-001
---

Tests empty input handling.

## Acceptance Criteria
- Handles empty input gracefully
`;

const GENERATED_CARD_B = `---
id: story-001-b
title: Error path network failure
status: draft
tags: core
parent: story-001
---

Tests network failure scenario.

## Acceptance Criteria
- Shows error message on network failure
`;

describe("Fanout API", () => {
  let dataDir: string;
  let storiesDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "vet-fanout-api-"));
    storiesDir = join(dataDir, "stories");
    mkdirSync(storiesDir, { recursive: true });
    writeFileSync(join(storiesDir, "story-001-test.md"), STORY_MD);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("POST /fanout/:id returns 404 for unknown scenario", async () => {
    const app = new Hono();
    app.route("/fanout", fanoutRoutes(dataDir, () => makeFakeClient("")));

    const res = await app.request("/fanout/story-999", { method: "POST" });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("not found");
  });

  test("POST /fanout/:id returns 400 when no model configured", async () => {
    const savedFanout = process.env.VET_FANOUT_MODEL;
    const savedAgent = process.env.VET_AGENT_MODEL;
    delete process.env.VET_FANOUT_MODEL;
    delete process.env.VET_AGENT_MODEL;

    try {
      const app = new Hono();
      app.route("/fanout", fanoutRoutes(dataDir));

      const res = await app.request("/fanout/story-001", { method: "POST" });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("no model configured");
    } finally {
      if (savedFanout !== undefined) process.env.VET_FANOUT_MODEL = savedFanout;
      if (savedAgent !== undefined) process.env.VET_AGENT_MODEL = savedAgent;
    }
  });

  test("POST /fanout/:id generates cards and writes to stories dir", async () => {
    const responseText = `${GENERATED_CARD_A}---CARD---${GENERATED_CARD_B}`;
    const client = makeFakeClient(responseText);

    const app = new Hono();
    app.route("/fanout", fanoutRoutes(dataDir, () => client));

    const res = await app.request("/fanout/story-001", { method: "POST" });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.parent).toBe("story-001");
    expect(body.generated).toHaveLength(2);
    expect(body.generated[0].id).toBe("story-001-a");
    expect(body.generated[1].id).toBe("story-001-b");

    // Verify files were written to disk
    const files = readdirSync(storiesDir).sort();
    expect(files).toContain("story-001-a.md");
    expect(files).toContain("story-001-b.md");

    const contentA = readFileSync(join(storiesDir, "story-001-a.md"), "utf-8");
    expect(contentA).toContain("Edge case empty input");
  });
});
