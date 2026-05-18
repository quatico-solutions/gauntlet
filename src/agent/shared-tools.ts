import type { ToolDefinition, ToolResult } from "../models/provider";
import type { EvidenceLogger } from "../evidence/logger";
import type { CredentialResolverConfig } from "../config";
import { buildReadTool, type ReadTool } from "../context/read-tool";
import { buildFetchCredentialTool, type FetchCredentialTool } from "../context/credential-tool";
import { buildBashTool, type BashTool } from "./bash-tool";

export interface SharedToolsOptions {
  contextRoot?: string;
  credentialResolver?: CredentialResolverConfig;
  /**
   * Working directory for the bash tool. Optional: if omitted, the bash
   * tool's `execute()` errors. Adapters constructed only to enumerate
   * tool definitions (registry introspection) should omit this; real
   * runs always supply a `<runDir>/scratch` path.
   */
  cwd?: string;
}

export interface SharedTools {
  definitions(): ToolDefinition[];
  canExecute(name: string): boolean;
  execute(
    name: string,
    args: Record<string, unknown>,
    logger: EvidenceLogger,
  ): Promise<ToolResult> | ToolResult;
}

export function buildSharedTools(opts: SharedToolsOptions): SharedTools {
  const readTool: ReadTool | null = opts.contextRoot
    ? buildReadTool(opts.contextRoot)
    : null;
  const credentialTool: FetchCredentialTool | null = buildFetchCredentialTool(
    opts.contextRoot ?? "",
    opts.credentialResolver,
  );
  const bashTool: BashTool = buildBashTool({ cwd: opts.cwd });

  const definitions = (): ToolDefinition[] => {
    const defs: ToolDefinition[] = [];
    if (readTool) defs.push(readTool.definition);
    if (credentialTool) defs.push(credentialTool.definition);
    defs.push(bashTool.definition);
    return defs;
  };

  const canExecute = (name: string): boolean => {
    if (name === "read") return readTool !== null;
    if (name === "fetch_credential") return credentialTool !== null;
    if (name === "bash") return true;
    return false;
  };

  const execute = (
    name: string,
    args: Record<string, unknown>,
    logger: EvidenceLogger,
  ): Promise<ToolResult> | ToolResult => {
    if (name === "read" && readTool) return readTool.execute(args);
    if (name === "fetch_credential" && credentialTool) {
      return credentialTool.execute(args, logger);
    }
    if (name === "bash") return bashTool.execute(args, logger);
    throw new Error(`SharedTools: unknown or unmounted tool: ${name}`);
  };

  return { definitions, canExecute, execute };
}
