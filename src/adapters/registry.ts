import type { ToolDefinition } from "../models/provider";
import { WebAdapter } from "./web/adapter";
import { CLIAdapter } from "./cli/adapter";
import { TUIAdapter } from "./tui/adapter";

/**
 * Look up an adapter's tool definitions by recorded adapter name.
 * Throws if the name is unknown — silent fallback would tell the
 * revival model the run had no tools, which is misleading.
 *
 * `toolDefinitions()` is pure on a default-constructed adapter (see
 * `selectAdapter` in src/cli/show-prompt.ts for the precedent) — same
 * `{ contextRoot }`-only construction pattern.
 */
export function getAdapterToolDefinitionsByName(name: string): ToolDefinition[] {
  switch (name) {
    case "web":
      return new WebAdapter({ contextRoot: undefined }).toolDefinitions();
    case "cli":
      return new CLIAdapter({ contextRoot: undefined }).toolDefinitions();
    case "tui":
      return new TUIAdapter({ contextRoot: undefined }).toolDefinitions();
    default:
      throw new Error(
        `Adapter "${name}" is not registered. The recorded run used an adapter that no longer exists in this build.`,
      );
  }
}
