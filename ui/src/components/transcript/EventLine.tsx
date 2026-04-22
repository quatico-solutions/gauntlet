import type { AnomalyEvent } from "../../lib/transcript";

interface Props {
  event: AnomalyEvent;
}

function isWarn(name: string): boolean {
  return (
    name.includes("oversize") ||
    name.toLowerCase().includes("error") ||
    name.toLowerCase().includes("warn")
  );
}

function summarize(event: AnomalyEvent): string {
  const { eventId: _eid, parentEventId: _pid, ts: _ts, type: _t, name: _n, ...rest } = event;
  void _eid; void _pid; void _ts; void _t; void _n;
  const keys = Object.keys(rest);
  if (keys.length === 0) return "";
  return JSON.stringify(rest);
}

export function EventLine({ event }: Props) {
  const warn = isWarn(event.name);
  const time = new Date(event.ts).toLocaleTimeString();
  return (
    <div className={`tr-event-line${warn ? " tr-warn" : ""}`}>
      <code style={{ fontFamily: "var(--tr-font-mono, ui-monospace, monospace)", color: "var(--tr-slate-soft)" }}>{time}</code>
      {" "}
      <strong>{event.name}</strong>
      {" "}
      <span style={{ color: "var(--tr-slate)" }}>{summarize(event)}</span>
    </div>
  );
}
