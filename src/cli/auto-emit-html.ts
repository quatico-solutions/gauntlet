import { renderRun as defaultRenderer } from "../render/render-run";

export interface AutoEmitDeps {
  renderer?: (runDir: string) => Promise<string>;
  stderr?: (msg: string) => void;
}

/**
 * Best-effort render of the static HTML report into the run dir. A renderer
 * failure is logged to stderr but does not propagate — the run's exit code is
 * determined by the run itself, not by this report-writing step.
 */
export async function safeEmitIndexHtml(
  runDir: string,
  deps: AutoEmitDeps = {},
): Promise<string | null> {
  const renderer = deps.renderer ?? defaultRenderer;
  const stderr =
    deps.stderr ?? ((m) => process.stderr.write(m + "\n"));
  try {
    return await renderer(runDir);
  } catch (err) {
    stderr(
      `[render] failed to write index.html: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}
