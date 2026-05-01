import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { VetResult, ActiveRun } from "../lib/api";
import { StatusBadge, formatDuration } from "./shared";
import { formatRunTimestamp } from "../lib/runId";

interface RunsListProps {
  results: VetResult[];
  activeRuns: ActiveRun[];
  /** The runId of the currently-selected row, if any. */
  selectedId?: string;
  onSelect: (runId: string) => void;
  onSelectActive: (runId: string) => void;
  /** If true, there's at least one page of older results not yet loaded. */
  hasMore?: boolean;
  /** Fetch the next page and append. No-op when `hasMore` is false. */
  onLoadMore?: () => void;
}

/**
 * One card's worth of runs, sliced from the (mixed-card) `results` list.
 * The latest run's status is what the card header shows; older runs are
 * still individually clickable. `hasActive` is true iff the card has at
 * least one in-flight run (so the header can show the spinner).
 */
interface CardGroup {
  cardId: string;
  /** Status shown on the card header: pulled from the most recent completed run. */
  latestStatus: VetResult["status"];
  runs: VetResult[]; // sorted newest-first
  activeRuns: ActiveRun[]; // sorted newest-first
}

function groupByCard(results: VetResult[], activeRuns: ActiveRun[]): CardGroup[] {
  const byCard = new Map<string, { completed: VetResult[]; active: ActiveRun[] }>();
  // Dedupe: a run may briefly appear in both lists (result.json is written
  // before the registry unregister). Active wins for the moment.
  const activeRunIds = new Set(activeRuns.map((r) => r.id));

  const touch = (cardId: string) => {
    let slot = byCard.get(cardId);
    if (!slot) {
      slot = { completed: [], active: [] };
      byCard.set(cardId, slot);
    }
    return slot;
  };

  for (const run of activeRuns) {
    touch(run.cardId).active.push(run);
  }
  for (const result of results) {
    if (activeRunIds.has(result.runId)) continue;
    touch(result.scenario).completed.push(result);
  }

  const groups: CardGroup[] = [];
  for (const [cardId, slot] of byCard.entries()) {
    // newest-first within each bucket: active by startedAt desc, completed
    // by runId desc (runId lex-desc ≈ chrono-desc per spec §id.ts).
    slot.active.sort((a, b) => b.startedAt - a.startedAt);
    slot.completed.sort((a, b) => (a.runId < b.runId ? 1 : a.runId > b.runId ? -1 : 0));

    const latest = slot.completed[0];
    groups.push({
      cardId,
      latestStatus: latest?.status ?? "investigate",
      runs: slot.completed,
      activeRuns: slot.active,
    });
  }

  // Sort groups by their most recent activity (active run wins over completed).
  groups.sort((a, b) => {
    const aKey = a.activeRuns[0]?.startedAt ?? (a.runs[0] ? runKey(a.runs[0].runId) : 0);
    const bKey = b.activeRuns[0]?.startedAt ?? (b.runs[0] ? runKey(b.runs[0].runId) : 0);
    return bKey - aKey;
  });

  return groups;
}

/**
 * Extract a chrono-orderable numeric key from a runId. The timestamp is the
 * middle `_`-separated segment; if the shape is off, fall back to 0 so the
 * group sinks to the bottom rather than crashing.
 */
function runKey(runId: string): number {
  const parts = runId.split("_");
  if (parts.length < 3) return 0;
  const ts = parts[parts.length - 2];
  const iso = ts.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z");
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

export function RunsList({
  results,
  activeRuns,
  selectedId,
  onSelect,
  onSelectActive,
  hasMore,
  onLoadMore,
}: RunsListProps) {
  const groups = useMemo(() => groupByCard(results, activeRuns), [results, activeRuns]);

  if (groups.length === 0) {
    return (
      <div className="p-3 text-sm text-slate">
        No runs yet. Use the <span className="font-medium text-ink">New Run</span> button above to start one.
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="flex-1 overflow-y-auto">
        {groups.map((group) => (
          <CardGroupRow
            key={group.cardId}
            group={group}
            selectedId={selectedId}
            onSelect={onSelect}
            onSelectActive={onSelectActive}
          />
        ))}
        {hasMore && onLoadMore && (
          <div className="border-b border-edge-light p-3">
            <button
              onClick={onLoadMore}
              className="w-full text-center text-xs text-teal hover:underline"
            >
              Load more runs
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

interface CardGroupRowProps {
  group: CardGroup;
  selectedId?: string;
  onSelect: (runId: string) => void;
  onSelectActive: (runId: string) => void;
}

function CardGroupRow({ group, selectedId, onSelect, onSelectActive }: CardGroupRowProps) {
  const hasActive = group.activeRuns.length > 0;
  const runCount = group.runs.length + group.activeRuns.length;

  return (
    <div className="border-b border-edge-light">
      {/* Card header: latest-status badge, cardId, run count. Not clickable
          itself — the rows below are. Keeps the "which cards have been
          tested" affordance without pretending a card has a single result. */}
      <div className="flex items-center justify-between gap-2 bg-panel px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-ink truncate">{group.cardId}</span>
          {hasActive && (
            <span className="relative flex h-2 w-2 flex-shrink-0" aria-label="Run in progress">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-teal" />
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {runCount > 1 && (
            <span className="text-xs text-slate">{runCount} runs</span>
          )}
          {!hasActive && <StatusBadge status={group.latestStatus} />}
        </div>
      </div>
      {/* Individual run rows: active on top, then completed, newest-first. */}
      {group.activeRuns.map((run) => (
        <button
          key={`active-${run.id}`}
          onClick={() => onSelectActive(run.id)}
          className={`w-full text-left pl-6 pr-3 py-2 border-t border-edge-light transition-colors duration-150 ${
            selectedId === run.id ? "bg-teal-wash" : "hover:bg-panel"
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <span className="text-sm text-ink leading-snug truncate">{run.title}</span>
            <span className="text-xs text-teal flex-shrink-0">running</span>
          </div>
        </button>
      ))}
      {group.runs.map((result) => {
        const when = formatRunTimestamp(result.runId);
        return (
          <button
            key={result.runId}
            onClick={() => onSelect(result.runId)}
            className={`w-full text-left pl-6 pr-3 py-2 border-t border-edge-light transition-colors duration-150 ${
              selectedId === result.runId ? "bg-teal-wash" : "hover:bg-panel"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs text-slate">
                {when ? `Run at ${when}` : result.runId}
              </span>
              <div className="flex items-center gap-2 flex-shrink-0">
                {result.runSet && (
                  <Link
                    to={`/run-sets/${result.runSet.runSetId}`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-xs text-teal underline"
                  >
                    set · {result.runSet.attemptNumber}/{result.runSet.passes}
                  </Link>
                )}
                <StatusBadge status={result.status} />
              </div>
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-slate">
              <span>{formatDuration(result.duration_ms)}</span>
              {result.observations.length > 0 && (
                <span>
                  {result.observations.length} observation{result.observations.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
