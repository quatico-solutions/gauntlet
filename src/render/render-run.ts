import { readFile, writeFile, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface RenderRunOptions {
  /** Absolute path to the run dir (must contain result.json and run.jsonl). */
  runDir: string;
  /** Absolute path to the static HTML template. */
  templatePath: string;
  /** Override output filename. Defaults to "index.html". */
  outputName?: string;
}

/**
 * Render a run's HTML report using a caller-supplied template. Reads
 * result.json + run.jsonl from runDir, splices them into the template's
 * <script id="__GAUNTLET_RUN__"> tag, and writes the result to runDir.
 *
 * The renderer is the single source of truth for the data shape the
 * static page reads from window.__GAUNTLET_RUN__.
 */
export async function renderRunFromTemplate(opts: RenderRunOptions): Promise<string> {
  const resultPath = join(opts.runDir, "result.json");
  const jsonlPath = join(opts.runDir, "run.jsonl");

  try {
    await access(resultPath);
  } catch {
    throw new Error(`renderRun: missing result.json at ${resultPath}`);
  }

  const [template, resultText, runJsonl] = await Promise.all([
    readFile(opts.templatePath, "utf-8"),
    readFile(resultPath, "utf-8"),
    readFile(jsonlPath, "utf-8").catch(() => ""),
  ]);

  const payload = { result: JSON.parse(resultText), runJsonl };
  // Escape any </script in the JSON to prevent breaking out of the
  // surrounding <script> tag. JSON.stringify handles other concerns.
  const json = JSON.stringify(payload).replace(/<\/script/gi, "<\\/script");

  // Lookaheads confirm both attributes are present without prescribing order.
  const re = /(<script\b(?=[^>]*\btype="application\/json")(?=[^>]*\bid="__GAUNTLET_RUN__")[^>]*>)([\s\S]*?)(<\/script>)/i;
  if (!re.test(template)) {
    throw new Error("renderRun: template is missing the __GAUNTLET_RUN__ script tag");
  }
  const rendered = template.replace(re, (_match, open, _body, close) => `${open}${json}${close}`);

  const outPath = join(opts.runDir, opts.outputName ?? "index.html");
  await writeFile(outPath, rendered);
  return outPath;
}

/**
 * Convenience wrapper: locate the bundled template (shipped at
 * <repo>/ui/dist-static/static.html) and render. Throws a clear error
 * if the template is missing — likely means `bun run build:ui` was not
 * run after install.
 */
export async function renderRun(runDir: string, outputName?: string): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/render/render-run.ts → ../../ui/dist-static/static.html
  const templatePath = join(here, "..", "..", "ui", "dist-static", "static.html");
  try {
    await access(templatePath);
  } catch {
    throw new Error(`renderRun: static template not found at ${templatePath}. Did you run 'bun run build:ui'?`);
  }
  return renderRunFromTemplate({ runDir, templatePath, outputName });
}
