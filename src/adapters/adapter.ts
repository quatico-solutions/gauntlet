import type { ToolDefinition, ToolResult } from "../models/provider";
import type { EvidenceLogger } from "../evidence/logger";

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
}
