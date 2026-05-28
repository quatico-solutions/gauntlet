import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, appendFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { WatchManager } from "../../src/agent/watch-manager";

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "gauntlet-watch-test-"));
}

describe("WatchManager.addGlob", () => {
  test("returns the current glob set after registration", () => {
    const m = new WatchManager();
    expect(m.currentGlobs()).toEqual([]);
    m.addGlob("/tmp/foo/*.log");
    expect(m.currentGlobs()).toEqual(["/tmp/foo/*.log"]);
  });

  test("is idempotent for duplicate globs", () => {
    const m = new WatchManager();
    m.addGlob("/tmp/foo/*.log");
    m.addGlob("/tmp/foo/*.log");
    expect(m.currentGlobs()).toEqual(["/tmp/foo/*.log"]);
  });

  test("accumulates distinct globs in registration order", () => {
    const m = new WatchManager();
    m.addGlob("/tmp/a/*.log");
    m.addGlob("/tmp/b/*.log");
    expect(m.currentGlobs()).toEqual(["/tmp/a/*.log", "/tmp/b/*.log"]);
  });
});

describe("WatchManager.scan", () => {
  test("first scan with existing matching file returns it as new_file", () => {
    const dir = freshDir();
    const file = join(dir, "a.log");
    writeFileSync(file, "hello\n");

    const m = new WatchManager();
    m.addGlob(join(dir, "*.log"));
    const events = m.scan();

    expect(events.newFiles).toEqual([file]);
    expect(events.appended).toEqual([]);
  });

  test("second scan with no changes returns no events", () => {
    const dir = freshDir();
    writeFileSync(join(dir, "a.log"), "hello\n");

    const m = new WatchManager();
    m.addGlob(join(dir, "*.log"));
    m.scan();
    const events = m.scan();

    expect(events.newFiles).toEqual([]);
    expect(events.appended).toEqual([]);
  });

  test("append to known file fires `appended`", () => {
    const dir = freshDir();
    const file = join(dir, "a.log");
    writeFileSync(file, "hello\n");

    const m = new WatchManager();
    m.addGlob(join(dir, "*.log"));
    m.scan();
    appendFileSync(file, "world\n");
    const events = m.scan();

    expect(events.appended).toEqual([file]);
    expect(events.newFiles).toEqual([]);
  });

  test("non-existent directory at registration matches nothing, gracefully", () => {
    const m = new WatchManager();
    m.addGlob("/tmp/this-dir-does-not-exist-zxcvb/*.log");
    const events = m.scan();
    expect(events.newFiles).toEqual([]);
    expect(events.appended).toEqual([]);
  });

  test("file appearing later is picked up as new_file", () => {
    const dir = freshDir();
    const m = new WatchManager();
    m.addGlob(join(dir, "*.log"));
    m.scan();
    const file = join(dir, "late.log");
    writeFileSync(file, "x\n");
    const events = m.scan();
    expect(events.newFiles).toEqual([file]);
  });

  test("truncation also counts as activity (appended)", () => {
    const dir = freshDir();
    const file = join(dir, "a.log");
    writeFileSync(file, "hellohello\n");

    const m = new WatchManager();
    m.addGlob(join(dir, "*.log"));
    m.scan();
    writeFileSync(file, "x\n"); // shrinks
    const events = m.scan();
    expect(events.appended).toEqual([file]);
  });
});

describe("WatchManager.waitForWake", () => {
  test("returns timeout when nothing happens", async () => {
    const dir = freshDir();
    const m = new WatchManager();
    m.addGlob(join(dir, "*.log"));

    const result = await m.waitForWake({
      idleMs: 1_000_000,
      timeoutMs: 300,
      pollIntervalMs: 50,
    });
    expect(result.reason).toBe("timeout");
  });

  test("returns new_file when a matching file appears", async () => {
    const dir = freshDir();
    const m = new WatchManager();
    m.addGlob(join(dir, "*.log"));

    const wakePromise = m.waitForWake({
      idleMs: 1_000_000,
      timeoutMs: 5_000,
      pollIntervalMs: 50,
    });
    setTimeout(() => writeFileSync(join(dir, "fresh.log"), "x\n"), 100);
    const result = await wakePromise;

    expect(result.reason).toBe("new_file");
    expect(result.path).toEqual(join(dir, "fresh.log"));
  });

  test("returns idle when no activity for idleMs", async () => {
    const dir = freshDir();
    writeFileSync(join(dir, "a.log"), "x\n");
    const m = new WatchManager();
    m.addGlob(join(dir, "*.log"));
    m.scan();

    const result = await m.waitForWake({
      idleMs: 200,
      timeoutMs: 5_000,
      pollIntervalMs: 50,
    });

    expect(result.reason).toBe("idle");
    expect(result.lastActivityMsAgo).toBeGreaterThanOrEqual(200);
  });

  test("append resets the idle timer", async () => {
    const dir = freshDir();
    const file = join(dir, "a.log");
    writeFileSync(file, "x\n");
    const m = new WatchManager();
    m.addGlob(join(dir, "*.log"));
    m.scan();

    const wakePromise = m.waitForWake({
      idleMs: 400,
      timeoutMs: 5_000,
      pollIntervalMs: 50,
    });
    setTimeout(() => appendFileSync(file, "y\n"), 200);
    setTimeout(() => appendFileSync(file, "z\n"), 500);
    const start = Date.now();
    const result = await wakePromise;
    const elapsed = Date.now() - start;

    expect(result.reason).toBe("idle");
    expect(elapsed).toBeGreaterThan(700);
    expect(result.lastActivityMsAgo).toBeGreaterThanOrEqual(400);
  });

  test("directory appearing later is matched when files arrive", async () => {
    const dir = freshDir();
    const subdir = join(dir, "later");
    const m = new WatchManager();
    m.addGlob(join(subdir, "**/rollout-*.jsonl"));

    const wakePromise = m.waitForWake({
      idleMs: 1_000_000,
      timeoutMs: 5_000,
      pollIntervalMs: 50,
    });
    setTimeout(() => {
      const { mkdirSync } = require("fs");
      mkdirSync(join(subdir, "2026/05/27"), { recursive: true });
      writeFileSync(join(subdir, "2026/05/27/rollout-x.jsonl"), "{}\n");
    }, 150);
    const result = await wakePromise;

    expect(result.reason).toBe("new_file");
    expect(result.path).toEqual(join(subdir, "2026/05/27/rollout-x.jsonl"));
  });
});

describe("WatchManager concurrency", () => {
  test("second waitForWake while one is in flight returns concurrent_call", async () => {
    const dir = freshDir();
    const m = new WatchManager();
    m.addGlob(join(dir, "*.log"));

    const p1 = m.waitForWake({ idleMs: 500, timeoutMs: 5_000, pollIntervalMs: 50 });
    const r2 = await m.waitForWake({ idleMs: 1, timeoutMs: 1, pollIntervalMs: 1 });
    expect(r2.reason).toBe("concurrent_call");

    await p1;
  });
});
