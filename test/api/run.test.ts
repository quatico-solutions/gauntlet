import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { runRoutes } from "../../src/api/routes/run";
import { ActiveRunRegistry } from "../../src/api/active-runs";
import { RunBroadcaster } from "../../src/api/ws";
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
    dataDir = mkdtempSync(join(tmpdir(), "gauntlet-run-api-"));
    storiesDir = join(dataDir, "stories");
    mkdirSync(storiesDir, { recursive: true });
    writeFileSync(join(storiesDir, "story-001-test.md"), STORY_MD);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("POST /api/run/:id returns 404 for unknown scenario", async () => {
    const app = new Hono();
    app.route("/api/run", runRoutes(dataDir));

    const res = await app.request("/api/run/story-999", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: "http://localhost:3000" }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("not found");
  });

  test("POST /api/run/:id returns 400 when target is missing", async () => {
    const app = new Hono();
    app.route("/api/run", runRoutes(dataDir));

    const res = await app.request("/api/run/story-001", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("target");
  });

  test("POST /api/run/:id returns 202 and registers the run", async () => {
    process.env.GAUNTLET_AGENT_MODEL = "claude-sonnet-4-6";
    const registry = new ActiveRunRegistry();
    const broadcaster = new RunBroadcaster();
    const app = new Hono();
    app.route("/api/run", runRoutes(dataDir, broadcaster, undefined, registry));

    // This will fail downstream (no real Chrome) but should still return 202
    // because start is detached. We only assert the acknowledgement + registration.
    const res = await app.request("/api/run/story-001", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: "http://localhost:3000", adapter: "cli" }),
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.id).toBe("story-001");
    // Registered synchronously before detach
    expect(registry.has("story-001")).toBe(true);

    // Give the detached task time to finish writing before afterEach rm's the dir.
    await new Promise((r) => setTimeout(r, 100));
  });

  test("POST /api/run/:id returns 400 when no model configured", async () => {
    const savedAgent = process.env.GAUNTLET_AGENT_MODEL;
    delete process.env.GAUNTLET_AGENT_MODEL;

    try {
      const app = new Hono();
      app.route("/api/run", runRoutes(dataDir));

      const res = await app.request("/api/run/story-001", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: "http://localhost:3000" }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("no model configured");
    } finally {
      if (savedAgent !== undefined) process.env.GAUNTLET_AGENT_MODEL = savedAgent;
    }
  });
});
