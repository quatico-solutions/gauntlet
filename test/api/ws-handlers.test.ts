import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { RunBroadcaster } from "../../src/api/ws";
import { ActiveRunRegistry } from "../../src/api/active-runs";
import { handleWsOpen } from "../../src/api/ws-handlers";

function makeWs() {
  const sent: string[] = [];
  const ws = {
    send: (data: string) => sent.push(data),
    readyState: 1,
  };
  return { ws, sent };
}

const RUN_ID = "story-001_20260416T142301Z_k3xm";

describe("handleWsOpen", () => {
  test("sends snapshot when run is registered (looked up by runId)", () => {
    const registry = new ActiveRunRegistry();
    registry.register({
      id: RUN_ID,
      cardId: "story-001",
      title: "Test",
      target: "http://localhost:3000",
      model: "claude-sonnet-4-6",
      startedAt: 100,
    });
    registry.recordFrame(RUN_ID, { data: "AAA", width: 10, height: 20 });
    registry.recordProgress(RUN_ID, "hello");

    const broadcaster = new RunBroadcaster();
    const { ws, sent } = makeWs();
    handleWsOpen(registry, broadcaster, RUN_ID, ws);

    expect(sent).toHaveLength(1);
    const msg = JSON.parse(sent[0]);
    expect(msg.type).toBe("snapshot");
    expect(msg.lastFrame).toEqual({ data: "AAA", width: 10, height: 20 });
    expect(msg.progressLog).toEqual(["hello"]);
  });

  test("sends gone when runId is not registered", () => {
    const registry = new ActiveRunRegistry();
    const broadcaster = new RunBroadcaster();
    const { ws, sent } = makeWs();
    handleWsOpen(registry, broadcaster, "not-running", ws);

    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0])).toEqual({ type: "gone" });
  });

  test("addClient is called before snapshot send (ordering guard)", () => {
    const registry = new ActiveRunRegistry();
    registry.register({
      id: "a",
      cardId: "card-a",
      title: "t",
      target: "x",
      model: "m",
      startedAt: 1,
    });
    const broadcaster = new RunBroadcaster();
    const { ws } = makeWs();
    handleWsOpen(registry, broadcaster, "a", ws);

    // After handleWsOpen, a subsequent broadcast should reach this ws.
    const sent2: string[] = [];
    ws.send = (d: string) => sent2.push(d);
    broadcaster.send("a", { type: "progress", message: "after" });
    expect(sent2).toHaveLength(1);
    expect(JSON.parse(sent2[0])).toEqual({ type: "progress", message: "after" });
  });

  test("gracefully handles undefined registry", () => {
    const broadcaster = new RunBroadcaster();
    const { ws, sent } = makeWs();
    handleWsOpen(undefined, broadcaster, "a", ws);
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0])).toEqual({ type: "gone" });
  });

  describe("transcriptSnapshot", () => {
    let resultsRoot: string;

    beforeEach(() => {
      resultsRoot = mkdtempSync(join(tmpdir(), "gauntlet-ws-test-"));
    });

    afterEach(() => {
      rmSync(resultsRoot, { recursive: true, force: true });
    });

    test("sends transcriptSnapshot when run.jsonl exists on disk", () => {
      mkdirSync(join(resultsRoot, RUN_ID), { recursive: true });
      const events = [
        { eventId: 1, parentEventId: 0, ts: "2026-04-21T00:00:00.000Z", type: "run_start", runId: RUN_ID },
        { eventId: 2, parentEventId: 1, ts: "2026-04-21T00:00:00.001Z", type: "system_prompt", content: "be helpful" },
      ];
      writeFileSync(
        join(resultsRoot, RUN_ID, "run.jsonl"),
        events.map((e) => JSON.stringify(e)).join("\n") + "\n",
      );

      const registry = new ActiveRunRegistry();
      const broadcaster = new RunBroadcaster();
      const { ws, sent } = makeWs();
      handleWsOpen(registry, broadcaster, RUN_ID, ws, resultsRoot);

      // Should receive `gone` (no registry entry) followed by transcriptSnapshot.
      expect(sent).toHaveLength(2);
      expect(JSON.parse(sent[0])).toEqual({ type: "gone" });
      const snap = JSON.parse(sent[1]);
      expect(snap.type).toBe("transcriptSnapshot");
      expect(snap.events).toEqual(events);
    });

    test("fires alongside snapshot for a live run with jsonl on disk", () => {
      mkdirSync(join(resultsRoot, RUN_ID), { recursive: true });
      writeFileSync(
        join(resultsRoot, RUN_ID, "run.jsonl"),
        JSON.stringify({ eventId: 1, parentEventId: 0, ts: "t", type: "run_start" }) + "\n",
      );

      const registry = new ActiveRunRegistry();
      registry.register({
        id: RUN_ID,
        cardId: "story-001",
        title: "Test",
        target: "http://localhost:3000",
        model: "claude-sonnet-4-6",
        startedAt: 100,
      });

      const broadcaster = new RunBroadcaster();
      const { ws, sent } = makeWs();
      handleWsOpen(registry, broadcaster, RUN_ID, ws, resultsRoot);

      expect(sent).toHaveLength(2);
      expect(JSON.parse(sent[0]).type).toBe("snapshot");
      expect(JSON.parse(sent[1]).type).toBe("transcriptSnapshot");
    });

    test("does not send transcriptSnapshot when run.jsonl does not exist", () => {
      const registry = new ActiveRunRegistry();
      const broadcaster = new RunBroadcaster();
      const { ws, sent } = makeWs();
      handleWsOpen(registry, broadcaster, RUN_ID, ws, resultsRoot);

      expect(sent).toHaveLength(1);
      expect(JSON.parse(sent[0])).toEqual({ type: "gone" });
    });

    test("does not send transcriptSnapshot when events list is empty", () => {
      mkdirSync(join(resultsRoot, RUN_ID), { recursive: true });
      writeFileSync(join(resultsRoot, RUN_ID, "run.jsonl"), "");

      const registry = new ActiveRunRegistry();
      const broadcaster = new RunBroadcaster();
      const { ws, sent } = makeWs();
      handleWsOpen(registry, broadcaster, RUN_ID, ws, resultsRoot);

      expect(sent).toHaveLength(1);
      expect(JSON.parse(sent[0])).toEqual({ type: "gone" });
    });

    test("skips malformed lines, keeps valid ones", () => {
      mkdirSync(join(resultsRoot, RUN_ID), { recursive: true });
      const good = { eventId: 1, parentEventId: 0, ts: "t", type: "run_start" };
      writeFileSync(
        join(resultsRoot, RUN_ID, "run.jsonl"),
        JSON.stringify(good) + "\n" + "this-is-not-json\n",
      );

      const registry = new ActiveRunRegistry();
      const broadcaster = new RunBroadcaster();
      const { ws, sent } = makeWs();
      handleWsOpen(registry, broadcaster, RUN_ID, ws, resultsRoot);

      expect(sent).toHaveLength(2);
      const snap = JSON.parse(sent[1]);
      expect(snap.type).toBe("transcriptSnapshot");
      expect(snap.events).toEqual([good]);
    });

    test("is a no-op when resultsRoot is not provided (legacy callers)", () => {
      const registry = new ActiveRunRegistry();
      const broadcaster = new RunBroadcaster();
      const { ws, sent } = makeWs();
      handleWsOpen(registry, broadcaster, RUN_ID, ws); // no resultsRoot

      expect(sent).toHaveLength(1);
      expect(JSON.parse(sent[0])).toEqual({ type: "gone" });
    });
  });
});
