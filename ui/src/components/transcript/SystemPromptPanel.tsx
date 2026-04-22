import { useState } from "react";

interface Props {
  content: string;
}

export function SystemPromptPanel({ content }: Props) {
  const [open, setOpen] = useState(false);
  const bytes = new TextEncoder().encode(content).length;
  const firstLine = content.split("\n")[0];

  return (
    <div
      className="tr-system-prompt"
      data-open={open ? "true" : "false"}
      onClick={() => setOpen((v) => !v)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setOpen((v) => !v);
        }
      }}
    >
      <div className="tr-system-prompt-label">System prompt</div>
      <div className="tr-system-prompt-meta">
        {open ? "click to collapse" : `${firstLine.slice(0, 80)}${firstLine.length > 80 ? "…" : ""} · ${(bytes / 1024).toFixed(1)}kB · click to expand`}
      </div>
      {open && (
        <pre style={{ whiteSpace: "pre-wrap", marginTop: "12px", fontFamily: "var(--tr-font-mono, ui-monospace, monospace)", fontSize: "12px", lineHeight: 1.6 }}>
          {content}
        </pre>
      )}
    </div>
  );
}
