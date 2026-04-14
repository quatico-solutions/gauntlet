import type { RunBroadcaster } from "./ws";
import type { ActiveRunRegistry } from "./active-runs";

interface WsLike {
  send(data: string): void;
  readyState: number;
}

/**
 * Handle a new WebSocket connection for a run. Subscribes the client to
 * the broadcaster first (so no terminal event slips through the gap),
 * then sends either a `snapshot` (if the run is live in the registry) or
 * a `gone` (if not).
 */
export function handleWsOpen(
  registry: ActiveRunRegistry | undefined,
  broadcaster: RunBroadcaster,
  runId: string,
  ws: WsLike,
): void {
  broadcaster.addClient(runId, ws);
  const snap = registry?.getSnapshot(runId);
  if (snap) {
    ws.send(JSON.stringify({
      type: "snapshot",
      lastFrame: snap.lastFrame,
      progressLog: snap.progressLog,
    }));
  } else {
    ws.send(JSON.stringify({ type: "gone" }));
  }
}
