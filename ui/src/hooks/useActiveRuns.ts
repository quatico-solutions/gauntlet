import { useState, useEffect, useCallback, useRef } from "react";
import { api, type ActiveRun } from "../lib/api";

const POLL_INTERVAL_MS = 3000;

export function useActiveRuns() {
  const [runs, setRuns] = useState<ActiveRun[]>([]);
  const [loaded, setLoaded] = useState(false);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const list = await api.activeRuns.list();
      if (mountedRef.current) {
        setRuns(list);
        setLoaded(true);
      }
    } catch {
      // best-effort; keep last known list
      if (mountedRef.current) setLoaded(true);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    const id = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [refresh]);

  return { runs, loaded, refresh };
}
