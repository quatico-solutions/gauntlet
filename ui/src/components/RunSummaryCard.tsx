import type { ReactNode } from "react";
import { api, type VetResult } from "../lib/api";
import { StatusBadge, formatDuration } from "./shared";
import { formatRunTimestamp } from "../lib/runId";

export interface RunSummaryCardProps {
  result: VetResult;
  /**
   * Optional content rendered at the trailing end of the heading row (e.g. a
   * "View transcript" link in the server view). The component does not know
   * what callers put here — static reports simply omit it.
   */
  trailingHeaderContent?: ReactNode;
}

/**
 * Read-only summary of a run's result: status, summary, reasoning,
 * observations, evidence (screenshots), usage, duration. No action buttons,
 * no navigation — that lives in RunDetail's wrapper.
 *
 * Renders content without an outer container; the caller is responsible for
 * layout/padding so both server and static surfaces can compose around it.
 *
 * Used by:
 * - RunDetail (server view, wrapped with action/nav UI)
 * - StaticRunPage (static HTML report, used directly)
 */
export function RunSummaryCard({ result, trailingHeaderContent }: RunSummaryCardProps) {
  const when = formatRunTimestamp(result.runId);

  return (
    <>
      <div className={`flex items-center gap-3 ${when ? "mb-2" : "mb-6"}`}>
        <h1 className="heading-display text-2xl">{result.scenario}</h1>
        <StatusBadge status={result.status} size="md" />
        {trailingHeaderContent && (
          <span className="ml-auto">{trailingHeaderContent}</span>
        )}
      </div>
      {when && (
        <p className="text-sm text-slate mb-6">Run at {when}</p>
      )}

      {/* Video playback is not yet wired up — the writer records screencast
          frames under frames/ but does not stitch them into a video. When that
          lands, add the video to result.json's evidence manifest and render it
          via api.results.fileUrl(). See docs/format.md. */}

      <div className="space-y-4">
        <div className="card p-4">
          <h2 className="section-label mb-2">Summary</h2>
          <p className="text-sm text-ink">{result.summary}</p>
        </div>

        <div className="card p-4">
          <h2 className="section-label mb-2">Reasoning</h2>
          <p className="text-sm text-ink whitespace-pre-wrap">{result.reasoning}</p>
        </div>

        {result.observations.length > 0 && (
          <div className="card p-4">
            <h2 className="section-label mb-2">
              Observations ({result.observations.length})
            </h2>
            <ul className="space-y-2">
              {result.observations.map((obs, i) => (
                <li key={i} className="text-sm">
                  <span className="inline-block rounded bg-panel px-1.5 py-0.5 text-xs font-medium text-slate mr-2">
                    {obs.kind}
                  </span>
                  <span className="text-ink">{obs.description}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {result.evidence.screenshots.length > 0 && (
          <div className="card p-4">
            <h2 className="section-label mb-2">Screenshots</h2>
            <div className="grid grid-cols-2 gap-3">
              {result.evidence.screenshots.map((relPath) => (
                <img
                  key={relPath}
                  src={api.results.fileUrl(result.runId, relPath)}
                  alt={relPath}
                  className="rounded border border-edge"
                />
              ))}
            </div>
          </div>
        )}

        {result.usage && (
          <div className="card p-4">
            <h2 className="section-label mb-2">Usage</h2>
            <div className="flex gap-4 text-sm text-slate">
              <span>Input: {result.usage.inputTokens.toLocaleString()} tokens</span>
              <span>Output: {result.usage.outputTokens.toLocaleString()} tokens</span>
              <span>{result.usage.turns} turn{result.usage.turns !== 1 ? "s" : ""}</span>
            </div>
          </div>
        )}

        <div className="text-xs text-slate">
          Duration: {formatDuration(result.duration_ms)}
        </div>
      </div>
    </>
  );
}
