import { describe, test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runSetRoutes } from "../../src/api/routes/run-sets";

let projectRoot: string;
let runSetsDir: string;

const fakeManifest = (id: string) => ({
  schemaVersion: 1,
  runSetId: id,
  kind: "single",
  createdAt: "2026-04-30T00:00:00Z",
  completedAt: "2026-04-30T00:01:00Z",
  passes: 3,
  cards: ["card-a"],
  runs: [
    { runId: "card-a_t1_x", cardId: "card-a", attemptNumber: 1, status: "pass" },
    { runId: "card-a_t2_y", cardId: "card-a", attemptNumber: 2, status: "pass" },
    { runId: "card-a_t3_z", cardId: "card-a", attemptNumber: 3, status: "pass" },
  ],
  summary: {
    perCard: [{
      cardId: "card-a", passes: 3,
      byStatus: { pass: 3, fail: 0, investigate: 0, errored: 0, cancelled: 0 },
      cardStatus: "consistent_pass", medianTurns: 5, medianDurationMs: 4000,
    }],
    overall: {
      totalRuns: 3,
      byStatus: { pass: 3, fail: 0, investigate: 0, errored: 0, cancelled: 0 },
      overallStatus: "consistent_pass",
    },
  },
});

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "gauntlet-runsets-api-"));
  runSetsDir = join(projectRoot, ".gauntlet", "run-sets");
  mkdirSync(runSetsDir, { recursive: true });
});

describe("GET /api/run-sets/:id", () => {
  test("returns the manifest for an existing run set", async () => {
    const id = "single_20260430T000000Z_abcd";
    mkdirSync(join(runSetsDir, id));
    writeFileSync(join(runSetsDir, id, "set.json"), JSON.stringify(fakeManifest(id)));

    const app = new Hono();
    app.route("/api/run-sets", runSetRoutes(join(projectRoot, ".gauntlet")));

    const res = await app.request(`/api/run-sets/${id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.runSetId).toBe(id);
    expect(body.runs).toHaveLength(3);
    expect(body.summary.overall.overallStatus).toBe("consistent_pass");
  });

  test("returns 404 for unknown run set", async () => {
    const app = new Hono();
    app.route("/api/run-sets", runSetRoutes(join(projectRoot, ".gauntlet")));
    const res = await app.request("/api/run-sets/single_20260430T000000Z_xyz");
    expect(res.status).toBe(404);
  });

  test("rejects path-traversal attempts", async () => {
    const app = new Hono();
    app.route("/api/run-sets", runSetRoutes(join(projectRoot, ".gauntlet")));
    const res = await app.request("/api/run-sets/..%2F..%2Fetc%2Fpasswd");
    expect(res.status).toBe(400);
  });
});

describe("GET /api/run-sets/:id/summary", () => {
  test("returns just the summary block", async () => {
    const id = "single_20260430T000000Z_abcd";
    mkdirSync(join(runSetsDir, id));
    writeFileSync(join(runSetsDir, id, "set.json"), JSON.stringify(fakeManifest(id)));

    const app = new Hono();
    app.route("/api/run-sets", runSetRoutes(join(projectRoot, ".gauntlet")));

    const res = await app.request(`/api/run-sets/${id}/summary`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.overall.overallStatus).toBe("consistent_pass");
    expect(body.perCard).toHaveLength(1);
  });

  test("returns 404 if summary block is null (in-flight set)", async () => {
    const id = "single_20260430T000000Z_inflight";
    mkdirSync(join(runSetsDir, id));
    const m = fakeManifest(id);
    (m as any).summary = null;
    writeFileSync(join(runSetsDir, id, "set.json"), JSON.stringify(m));

    const app = new Hono();
    app.route("/api/run-sets", runSetRoutes(join(projectRoot, ".gauntlet")));
    const res = await app.request(`/api/run-sets/${id}/summary`);
    expect(res.status).toBe(404);
  });
});
