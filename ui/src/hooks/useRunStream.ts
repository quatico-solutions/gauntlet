import { useState, useEffect, useRef } from "react";
import type { VetResult } from "../lib/api";

type RunMessage =
  | { type: "frame"; data: string; width: number; height: number }
  | { type: "progress"; message: string }
  | { type: "complete"; result: VetResult };

export function useRunStream(runId: string | null) {
  const [frame, setFrame] = useState<string | null>(null);
  const [messages, setMessages] = useState<string[]>([]);
  const [result, setResult] = useState<VetResult | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!runId) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws?run=${runId}`);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);

    ws.onmessage = (event) => {
      let msg: RunMessage;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      switch (msg.type) {
        case "frame":
          setFrame(`data:image/jpeg;base64,${msg.data}`);
          break;
        case "progress":
          setMessages((prev) => [...prev, msg.message]);
          break;
        case "complete":
          setResult(msg.result);
          break;
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [runId]);

  return { frame, messages, result, connected };
}
