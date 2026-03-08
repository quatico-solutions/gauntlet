import type { ToolDefinition, ToolResult } from "../models/provider";
import type { EvidenceLogger } from "../evidence/logger";

export interface Adapter {
  start(target: string): Promise<void>;
  close(): Promise<void>;
  toolDefinitions(): ToolDefinition[];
  executeTool(
    name: string,
    args: Record<string, unknown>,
    logger: EvidenceLogger
  ): Promise<ToolResult>;
}
