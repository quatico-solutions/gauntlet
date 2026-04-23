import { useEffect, useState } from "react";
import { api } from "../../lib/api";

/**
 * Mirrors `Capture` / `Cell` from src/adapters/tui/capture-parser.ts.
 * Types duplicated here because the UI tsconfig doesn't cross into src/.
 * Keep in sync with the server-side shape.
 */
interface Cell {
  ch: string;
  fg?: string;
  bg?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  width: 1 | 2;
}

interface Capture {
  cols: number;
  rows: number;
  cells: Cell[][];
}

interface Props {
  runId: string;
  /** Path to the `.ansi` file as recorded in the tool_result event. The
   * `.json` twin at the same stem is what we fetch and render. */
  ansiPath: string;
}

/** Swap `.ansi` → `.json` so we fetch the parsed grid, not the raw bytes. */
function toJsonPath(ansiPath: string): string {
  return ansiPath.endsWith(".ansi") ? ansiPath.slice(0, -5) + ".json" : ansiPath;
}

/**
 * Render a TUI screen capture as a CSS grid of explicit cells. This
 * sidesteps the "font-width lies" problem — every cell is its own DOM
 * node sized uniformly by the grid, so CJK and emoji land in the slots
 * the terminal counted for them regardless of the browser font metrics.
 *
 * The parsed grid is fetched lazily on first expand. Default state is
 * collapsed because a single capture can be 120x40 = 4,800 DOM nodes
 * and most turns have one.
 */
export function TuiCapture({ runId, ansiPath }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [capture, setCapture] = useState<Capture | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!expanded || capture || error) return;
    let cancelled = false;
    (async () => {
      try {
        const text = await api.results.fileText(runId, toJsonPath(ansiPath));
        const parsed: Capture = JSON.parse(text);
        if (!cancelled) setCapture(parsed);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expanded, capture, error, runId, ansiPath]);

  return (
    <div className="tr-tui-capture">
      <button
        type="button"
        className="tr-tui-capture-toggle"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? "Hide" : "Show"} screen capture ({ansiPath})
      </button>
      {expanded && !capture && !error && (
        <div className="tr-tui-capture-status">loading…</div>
      )}
      {expanded && error && (
        <div className="tr-tui-capture-status tr-tui-capture-error">
          Failed to load capture: {error}
        </div>
      )}
      {expanded && capture && <CaptureGrid capture={capture} />}
    </div>
  );
}

function CaptureGrid({ capture }: { capture: Capture }) {
  return (
    <div
      className="tr-tui-capture-grid"
      style={{
        gridTemplateColumns: `repeat(${capture.cols}, var(--tui-cell-w))`,
        gridTemplateRows: `repeat(${capture.rows}, var(--tui-cell-h))`,
      }}
    >
      {capture.cells.flatMap((row, y) =>
        row.map((cell, x) => {
          // Trailing half of a wide char — rendered by the preceding
          // cell's grid-column span. Skip it so we don't double-paint.
          if (cell.ch === "" && cell.width === 1) return null;
          const style: React.CSSProperties = {};
          if (cell.fg) style.color = cssColor(cell.fg);
          if (cell.bg) style.background = cssColor(cell.bg);
          if (cell.bold) style.fontWeight = 700;
          if (cell.italic) style.fontStyle = "italic";
          if (cell.underline) style.textDecoration = "underline";
          if (cell.width === 2) style.gridColumn = "span 2";
          return (
            <span
              key={`${y}:${x}`}
              className="tr-tui-cell"
              style={style}
            >
              {cell.ch === " " || cell.ch === "" ? " " : cell.ch}
            </span>
          );
        }),
      )}
    </div>
  );
}

/**
 * Parser emits a full hex string ("#rrggbb") for every color path —
 * truecolor, the 16-color base, the 6×6×6 RGB cube, and the 24-step
 * grayscale ramp are all resolved server-side. Anything that isn't a
 * hex falls through to default, which is dead code in practice but
 * defends against unknown formats from older captures on disk.
 */
function cssColor(c: string): string | undefined {
  if (c.startsWith("#")) return c;
  return undefined;
}
