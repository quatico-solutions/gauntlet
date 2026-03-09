import { useState, useEffect, useRef } from "react";

interface RunMessage {
  type: "frame" | "progress" | "complete";
  data?: string;
  width?: number;
  height?: number;
  message?: string;
  status?: string;
  result?: any;
}

export function useRunStream(runId: string | null) {
  const [frame, setFrame] = useState<string | null>(null);
  const [messages, setMessages] = useState<string[]>([]);
  const [result, setResult] = useState<any>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!runId) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws?run=${runId}`);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);

    ws.onmessage = (event) => {
      const msg: RunMessage = JSON.parse(event.data);
      switch (msg.type) {
        case "frame":
          setFrame(`data:image/jpeg;base64,${msg.data}`);
          break;
        case "progress":
          setMessages((prev) => [...prev, msg.message || ""]);
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
