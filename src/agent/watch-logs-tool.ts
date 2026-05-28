import { textResult, type ToolDefinition, type ToolResult } from "../models/provider";
import type { EvidenceLogger } from "../evidence/logger";
import type { WatchManager } from "./watch-manager";

const WATCH_LOGS_DESCRIPTION =
  "Register a file path or glob to monitor for activity. Required before " +
  "wake_on_idle_log can observe those paths. Idempotent and additive — " +
  "calls accumulate; the result echoes the full watch set.";

export interface WatchLogsTool {
  definition: ToolDefinition;
  execute(args: Record<string, unknown>, logger: EvidenceLogger): Promise<ToolResult>;
}

export function buildWatchLogsTool(opts: { manager: WatchManager }): WatchLogsTool {
  const definition: ToolDefinition = {
    name: "watch_logs",
    description: WATCH_LOGS_DESCRIPTION,
    parameters: {
      type: "object",
      properties: {
        glob: {
          type: "string",
          description:
            "Absolute path or glob pattern (supports `**` for recursive). " +
            "Example: $CODEX_HOME/sessions/**/rollout-*.jsonl",
        },
      },
      required: ["glob"],
    },
  };

  const execute = async (
    args: Record<string, unknown>,
    _logger: EvidenceLogger,
  ): Promise<ToolResult> => {
    const glob = args.glob;
    if (typeof glob !== "string" || glob.length === 0) {
      return textResult(JSON.stringify({ error: "glob (string) is required" }));
    }
    opts.manager.addGlob(glob);
    return textResult(JSON.stringify({ watching: opts.manager.currentGlobs() }));
  };

  return { definition, execute };
}
