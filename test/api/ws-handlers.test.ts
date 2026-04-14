import { describe, test, expect } from "bun:test";
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

describe("handleWsOpen", () => {
  test("sends snapshot when run is registered", () => {
    const registry = new ActiveRunRegistry();
    registry.register({
      id: "story-001",
      title: "Test",
      target: "http://localhost:3000",
      model: "claude-sonnet-4-6",
      startedAt: 100,
    });
    registry.recordFrame("story-001", { data: "AAA", width: 10, height: 20 });
    registry.recordProgress("story-001", "hello");

    const broadcaster = new RunBroadcaster();
    const { ws, sent } = makeWs();
    handleWsOpen(registry, broadcaster, "story-001", ws);

    expect(sent).toHaveLength(1);
    const msg = JSON.parse(sent[0]);
    expect(msg.type).toBe("snapshot");
    expect(msg.lastFrame).toEqual({ data: "AAA", width: 10, height: 20 });
    expect(msg.progressLog).toEqual(["hello"]);
  });

  test("sends gone when run is not registered", () => {
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
});
