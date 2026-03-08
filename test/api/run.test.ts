import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { runRoutes } from "../../src/api/routes/run";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Hono } from "hono";

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

describe("Run API", () => {
  let dataDir: string;
  let storiesDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "vet-run-api-"));
    storiesDir = join(dataDir, "stories");
    mkdirSync(storiesDir, { recursive: true });
    writeFileSync(join(storiesDir, "story-001-test.md"), STORY_MD);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("POST /run/:id returns 404 for unknown scenario", async () => {
    const app = new Hono();
    app.route("/run", runRoutes(dataDir));

    const res = await app.request("/run/story-999", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: "http://localhost:3000" }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("not found");
  });

  test("POST /run/:id returns 400 when target is missing", async () => {
    const app = new Hono();
    app.route("/run", runRoutes(dataDir));

    const res = await app.request("/run/story-001", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("target");
  });

  test("POST /run/:id returns 400 when no model configured", async () => {
    const savedAgent = process.env.VET_AGENT_MODEL;
    delete process.env.VET_AGENT_MODEL;

    try {
      const app = new Hono();
      app.route("/run", runRoutes(dataDir));

      const res = await app.request("/run/story-001", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: "http://localhost:3000" }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("no model configured");
    } finally {
      if (savedAgent !== undefined) process.env.VET_AGENT_MODEL = savedAgent;
    }
  });
});
