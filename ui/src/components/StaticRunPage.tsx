import type { StaticRunPayload } from "../lib/api";
import { RunSummaryCard } from "./RunSummaryCard";
import { TranscriptView } from "./transcript";

/**
 * Reads `window.__GAUNTLET_RUN__` if available. Pure and SSR-safe.
 */
export function getStaticRunPayload(): StaticRunPayload | null {
  if (typeof window === "undefined") return null;
  return window.__GAUNTLET_RUN__ ?? null;
}

/**
 * Renders a self-contained run report from the static payload injected at
 * build time. Composes display-only components — no action buttons, no
 * navigation. The transcript is inline below the summary.
 *
 * Data source: window.__GAUNTLET_RUN__ (set by the HTML generator).
 */
export function StaticRunPage() {
  const payload = getStaticRunPayload();

  if (!payload) {
    return (
      <div className="p-6 text-slate">
        No run data available. This report may not have been generated correctly.
      </div>
    );
  }

  return (
    <div className="static-run-report">
      <div className="p-6 max-w-3xl">
        <RunSummaryCard result={payload.result} />
      </div>
      <hr className="my-6 border-slate-300" />
      <section className="p-6 max-w-3xl">
        <h2 className="text-lg font-semibold mb-2">Transcript</h2>
        <TranscriptView mode="posthoc" runId={payload.result.runId} />
      </section>
    </div>
  );
}
