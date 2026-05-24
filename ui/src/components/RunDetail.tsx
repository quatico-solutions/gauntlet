import { useState } from "react";
import { Link } from "react-router-dom";
import { api, type VetResult, type FanoutResult } from "../lib/api";
import type { NewRunPrefill } from "./NewRunModal";
import { RunSummaryCard } from "./RunSummaryCard";

interface RunDetailProps {
  result: VetResult;
  onFanout: () => void;
  onRunAgain?: (prefill: NewRunPrefill) => void;
}

export function RunDetail({ result, onFanout, onRunAgain }: RunDetailProps) {
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<FanoutResult["generated"] | null>(null);

  // Fanout from observations/failure reads the result.json under
  // .gauntlet/results/<runId>/, so this path segment must be the runId.
  async function handleFromObservations() {
    try {
      setActing(true);
      setError(null);
      setGenerated(null);
      const res = await api.fanout.fromObservations(result.runId);
      setGenerated(res.generated);
      onFanout();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate from observations");
    } finally {
      setActing(false);
    }
  }

  async function handleAnalyzeFailure() {
    try {
      setActing(true);
      setError(null);
      setGenerated(null);
      const res = await api.fanout.fromFailure(result.runId);
      setGenerated(res.generated);
      onFanout();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to analyze failure");
    } finally {
      setActing(false);
    }
  }

  return (
    <div className="p-6 max-w-3xl">
      {result.runSet && (
        <div className="mb-3 text-sm">
          Part of run set{" "}
          <Link to={`/run-sets/${result.runSet.runSetId}`} className="text-teal underline">
            {result.runSet.runSetId}
          </Link>
          {" — attempt "}{result.runSet.attemptNumber} of {result.runSet.passes}
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {generated && generated.length > 0 && (
        <div className="mb-4 rounded-lg bg-green-50 border border-green-200 px-4 py-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-green-800">
              Generated {generated.length} test card{generated.length !== 1 ? "s" : ""}
            </h3>
            <button
              className="text-xs text-green-600 hover:text-green-800"
              onClick={() => setGenerated(null)}
            >
              Dismiss
            </button>
          </div>
          <ul className="mt-2 space-y-1">
            {generated.map((card) => (
              <li key={card.id} className="text-sm text-green-700">
                <a href={`/cards/${card.id}`} className="hover:underline font-medium">{card.title}</a>
                <span className="text-green-500 ml-1">({card.id})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <RunSummaryCard
        result={result}
        trailingHeaderContent={
          <Link
            to={`/runs/${result.runId}/transcript`}
            className="text-xs text-teal hover:underline"
          >
            View transcript →
          </Link>
        }
      />

      <div className="flex items-center gap-3 pt-2">
        {onRunAgain && result.config && (
          <button
            className="btn-secondary"
            onClick={() => onRunAgain({
              cardId: result.scenario,
              target: result.config!.target,
              model: result.config!.model,
              chrome: result.config!.chrome,
              adapter: result.config!.adapter,
              viewport: result.config!.viewport,
              passes: result.runSet?.passes,
            })}
          >
            Run Again
          </button>
        )}
        {result.observations.length > 0 && (
          <button
            className="btn-primary"
            onClick={handleFromObservations}
            disabled={acting}
          >
            {acting ? "Generating..." : "Generate Test Cards from Observations"}
          </button>
        )}
        {result.status === "fail" && (
          <button
            className="btn-secondary"
            onClick={handleAnalyzeFailure}
            disabled={acting}
          >
            {acting ? "Generating..." : "Generate Test Cards from Failure"}
          </button>
        )}
      </div>
    </div>
  );
}
