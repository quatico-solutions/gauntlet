import type { ToolDefinition, ToolResult } from "../models/provider";
import type { EvidenceLogger } from "../evidence/logger";
import type { Viewport } from "../config";

export const ADAPTER_TYPES = ["web", "cli", "tui"] as const;
export type AdapterType = typeof ADAPTER_TYPES[number];

export function isAdapterType(s: unknown): s is AdapterType {
  return typeof s === "string" && (ADAPTER_TYPES as readonly string[]).includes(s);
}

export interface Adapter {
  readonly name: string;
  start(target: string): Promise<void>;
  close(): Promise<void>;
  toolDefinitions(): ToolDefinition[];
  executeTool(
    name: string,
    args: Record<string, unknown>,
    logger: EvidenceLogger
  ): Promise<ToolResult>;
  /**
   * One-line framing for the initial user message telling the agent what
   * `target` means in this adapter's world — e.g. web returns a URL to
   * visit, tui returns the already-running command. Tool descriptions
   * already cover *what the tools do*; this covers what the target IS.
   * Only called when a target is present; the adapter does not need to
   * handle the empty-target case.
   */
  describeTarget(target: string): string;
  /**
   * The adapter's native rendering surface. Web returns CSS pixels
   * (e.g. 1440×900); TUI returns character cells (e.g. 120×40). CLI has
   * no rendering surface and returns null. The snapshot recorded in
   * result.json uses this when the user did not explicitly request a
   * viewport — keeping the config honest per-adapter instead of the
   * old implicit assumption that viewport always means web pixels.
   * Units are adapter-dependent; read alongside `adapter` to interpret.
   */
  defaultViewport(): Viewport | null;
  /**
   * True when a tool call changes application state, false when it only
   * observes (screenshots, extracts, reads, waits). Drives which calls
   * appear in the reflection-checkpoint trace — informational tools are
   * frequent, non-decisional, and would dilute the trace. The agent
   * loop has no business hardcoding tool names, so each adapter owns
   * its own classification. Unknown names default to false: a noisy
   * trace from a missed classification is bounded, an over-broad
   * default would let new informational tools pollute the trace by
   * accident.
   */
  isMutatingTool(name: string): boolean;
}

/**
 * Compute the viewport that should land in the run snapshot. We ask the
 * adapter what it is actually using: web returns its constructed pixel
 * viewport (user-supplied or documented default), tui returns its tmux
 * grid, cli returns null. A null adapter viewport yields `undefined`,
 * matching the optional field shape in RunConfigSnapshot — the field is
 * simply omitted rather than recorded as a meaningless value.
 */
export function snapshotViewport(adapter: Adapter): Viewport | undefined {
  return adapter.defaultViewport() ?? undefined;
}
