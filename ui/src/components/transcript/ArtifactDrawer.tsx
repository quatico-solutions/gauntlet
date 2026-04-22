import { useEffect, useState } from "react";
import { api } from "../../lib/api";

interface Props {
  runId: string;
  path: string | null;
  onClose: () => void;
}

export function ArtifactDrawer({ runId, path, onClose }: Props) {
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!path) {
      setText(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setText(null);
    api.results.fileText(runId, path)
      .then((t) => { if (!cancelled) setText(t); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "failed to load"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [runId, path]);

  useEffect(() => {
    if (!path) return;
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [path, onClose]);

  if (!path) return null;

  const filename = path.split("/").pop() ?? path;
  const bytes = text ? new TextEncoder().encode(text).length : 0;
  const rawUrl = api.results.fileUrl(runId, path);

  return (
    <>
      <div className="tr-drawer-backdrop" onClick={onClose} />
      <aside className="tr-drawer" role="dialog" aria-label={`Artifact ${filename}`}>
        <header className="tr-drawer-head">
          <div>
            <div className="tr-drawer-path">{filename}</div>
            <div className="tr-drawer-meta">
              {loading ? "loading…" : text ? `${bytes.toLocaleString()} bytes` : error ?? ""}
            </div>
          </div>
          <button type="button" className="tr-drawer-close" onClick={onClose} aria-label="Close drawer">
            ×
          </button>
        </header>

        <div className="tr-drawer-body">
          {text && <LineNumberedPre text={text} />}
          {error && <div style={{ color: "#a33", padding: "16px" }}>{error}</div>}
        </div>

        <footer className="tr-drawer-foot">
          <button
            type="button"
            onClick={() => {
              if (text) navigator.clipboard?.writeText(text);
            }}
            disabled={!text}
          >
            Copy
          </button>
          <a href={rawUrl} target="_blank" rel="noreferrer">Open raw</a>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={onClose}>Close</button>
        </footer>
      </aside>
    </>
  );
}

function LineNumberedPre({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="tr-artifact-lines">
      <div style={{ display: "contents" }}>
        {lines.map((line, i) => (
          <LineRow key={i} n={i + 1} content={line} />
        ))}
      </div>
    </div>
  );
}

function LineRow({ n, content }: { n: number; content: string }) {
  return (
    <>
      <span style={{ color: "var(--tr-slate-soft)", userSelect: "none", textAlign: "right", paddingRight: "8px", fontVariantNumeric: "tabular-nums" }}>{n}</span>
      <code style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{content || " "}</code>
    </>
  );
}
