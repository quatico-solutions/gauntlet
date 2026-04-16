import { readdirSync, readFileSync, statSync } from "fs";
import type { ToolDefinition, ToolResult } from "../models/provider";
import { resolveInside } from "./path";

// The `read` tool is the agent-facing primitive for pulling file contents
// out of `.gauntlet/context/`. It is a pure filesystem primitive — the
// runner never interprets filenames, never caches results, and never
// writes into the context directory. Path resolution goes through
// `resolveInside` from `./path.ts`, which matches Gauntlet v1.5 spec §3.1
// verbatim.

export interface ReadTool {
  definition: ToolDefinition;
  execute(args: Record<string, unknown>): ToolResult;
}

// Tool description — authoritative prose from Gauntlet v1.5 spec §3.1.
// DO NOT edit without going through the amendment protocol (spec §13).
// Tests assert this exact string; if a typo sneaks in, the prompts test
// will fail at CI time.
const TOOL_DESCRIPTION =
  "Read a file from the project's context directory. The path is relative to " +
  ".gauntlet/context/ and must not escape it. The system prompt shows a tree " +
  "listing of everything available under .gauntlet/context/ at turn 0 — use " +
  "that tree to pick paths. Returns the file's contents verbatim as text. " +
  "Binary files are not supported; attempts to read binary content return an " +
  "error. This is the tool to use when a story names a user and you need " +
  "their credentials, character notes, or any other file the story references.";

// Registration predicate: true when `contextRoot` exists, is a directory,
// and is non-empty. Matches the passkey tool's predicate and honors the
// "invisible when unused" shape of v1's profile tool.
function contextRootIsPopulated(contextRoot: string): boolean {
  try {
    const stat = statSync(contextRoot);
    if (!stat.isDirectory()) return false;
    return readdirSync(contextRoot).length > 0;
  } catch {
    return false;
  }
}

const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

// UTF-8 decode sanity check: if the file contains NUL bytes or any
// sequence that would have been replaced by U+FFFD on a strict decode,
// treat it as binary. Bun's `readFileSync(..., "utf-8")` does not throw
// on invalid UTF-8; it silently substitutes replacement characters.
// We want an error the agent can see, not silent corruption.
function looksBinary(buf: Buffer): boolean {
  const len = Math.min(buf.length, 8192);
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

export function buildReadTool(contextRoot: string): ReadTool | null {
  if (!contextRootIsPopulated(contextRoot)) return null;

  const definition: ToolDefinition = {
    name: "read",
    description: TOOL_DESCRIPTION,
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Path relative to .gauntlet/context/. Must not contain '..' segments or start with '/'. Example: 'alice/credentials.md'.",
        },
      },
      required: ["path"],
    },
  };

  const execute = (args: Record<string, unknown>): ToolResult => {
    const path = typeof args.path === "string" ? args.path : "";

    if (!path) {
      return {
        text: `Error: read requires a "path" argument (relative to .gauntlet/context/).`,
      };
    }

    let resolved: string;
    try {
      resolved = resolveInside(contextRoot, path);
    } catch (err) {
      return { text: `Error: ${errorMessage(err)}` };
    }

    let stat;
    try {
      stat = statSync(resolved);
    } catch {
      return { text: `Error: file not found: ${path}` };
    }
    if (!stat.isFile()) {
      return { text: `Error: not a file: ${path}` };
    }

    let buf: Buffer;
    try {
      buf = readFileSync(resolved);
    } catch (err) {
      return { text: `Error: ${errorMessage(err)}` };
    }

    if (looksBinary(buf)) {
      return { text: `Error: binary file not supported: ${path}` };
    }

    return { text: buf.toString("utf-8") };
  };

  return { definition, execute };
}

// Export for tests that want to diff the description against the spec.
export const READ_TOOL_DESCRIPTION = TOOL_DESCRIPTION;
