import { existsSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { RenderArgs } from "./args";
import type { AppConfig } from "../config";
import { resolveRunDir } from "../paths";
import { renderRun } from "../render/render-run";

export interface RenderDeps {
  log?: (message: string) => void;
}

/**
 * Implements `gauntlet render <run-id-or-path>`. If the positional
 * resolves to an existing directory, treat it as a run-dir path. Otherwise
 * treat it as a run-id and look it up under the configured state dir.
 */
export async function render(args: RenderArgs, config: AppConfig, deps: RenderDeps = {}): Promise<void> {
  const log = deps.log ?? ((m) => process.stderr.write(m + "\n"));
  const arg = args.runIdOrPath;

  let runDir: string;
  if ((isAbsolute(arg) || arg.includes("/")) && existsSync(arg) && statSync(arg).isDirectory()) {
    runDir = arg;
  } else {
    runDir = resolveRunDir(config.projectRoot, config.stateDirName, arg);
    if (!existsSync(runDir)) {
      throw new Error(`Run dir not found: ${runDir} (looked up from run-id '${arg}')`);
    }
  }

  const outPath = await renderRun(runDir);
  log(outPath);
}
