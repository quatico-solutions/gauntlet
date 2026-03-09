import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createApp } from "../../src/api/server";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("Video serving", () => {
  let dataDir: string;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "vet-video-"));
    const resultsDir = join(dataDir, "results", "test-run");
    mkdirSync(resultsDir, { recursive: true });
    writeFileSync(join(resultsDir, "result.json"), JSON.stringify({ scenario: "test-run", status: "pass" }));
    writeFileSync(join(resultsDir, "video.webm"), "fake-video-data");
    app = createApp(dataDir);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("GET /api/results/:id/video serves video file", async () => {
    const res = await app.request("/api/results/test-run/video");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("video/webm");
  });

  test("GET /api/results/:id/video returns 404 when no video", async () => {
    const noVideoDir = join(dataDir, "results", "no-video");
    mkdirSync(noVideoDir, { recursive: true });
    writeFileSync(join(noVideoDir, "result.json"), JSON.stringify({ scenario: "no-video", status: "pass" }));

    const res = await app.request("/api/results/no-video/video");
    expect(res.status).toBe(404);
  });
});
