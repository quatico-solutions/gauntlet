import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderRunFromTemplate } from "../../src/render/render-run";

function makeFixtureRun(): { runDir: string; templatePath: string; base: string } {
  const base = mkdtempSync(join(tmpdir(), "gauntlet-render-"));
  const runDir = join(base, "run-1");
  mkdirSync(runDir);
  writeFileSync(join(runDir, "result.json"), JSON.stringify({
    schemaVersion: 5,
    runId: "card_2026T000000Z_aaaa",
    scenario: "card",
    status: "pass",
    summary: "ok",
    reasoning: "r",
    observations: [],
    evidence: { screenshots: [], log: "run.jsonl" },
    duration_ms: 1,
  }));
  writeFileSync(join(runDir, "run.jsonl"),
    JSON.stringify({ eventId: "e1", ts: "2026-05-22T00:00:00Z", type: "run_start" }) + "\n");
  const templatePath = join(base, "template.html");
  writeFileSync(templatePath,
    `<!doctype html><html><head><script type="application/json" id="__GAUNTLET_RUN__">{}</script></head><body></body></html>`);
  return { runDir, templatePath, base };
}

describe("renderRunFromTemplate", () => {
  test("writes index.html with the data block populated", async () => {
    const { runDir, templatePath } = makeFixtureRun();
    const outPath = await renderRunFromTemplate({ runDir, templatePath });
    expect(outPath).toBe(join(runDir, "index.html"));
    expect(existsSync(outPath)).toBe(true);
    const html = readFileSync(outPath, "utf-8");
    expect(html).toContain('id="__GAUNTLET_RUN__"');
    expect(html).toContain('"runId":"card_2026T000000Z_aaaa"');
    expect(html).toContain('"status":"pass"');
    expect(html).toContain('"runJsonl"');
  });

  test("escapes </script> in run-data to prevent breaking out of the script tag", async () => {
    const { runDir, templatePath } = makeFixtureRun();
    writeFileSync(join(runDir, "run.jsonl"),
      JSON.stringify({ eventId: "e1", type: "user_message", content: "evil </script><script>alert(1)</script>" }) + "\n");
    const outPath = await renderRunFromTemplate({ runDir, templatePath });
    const html = readFileSync(outPath, "utf-8");

    // Positive: the escaped form must appear, proving .replace() actually fired
    // on the injected </script sequence.
    expect(html).toContain("<\\/script");

    // Negative: scan only the JSON region — between the end of the opening
    // <script ...> tag and the start of the legitimate closing </script>.
    // No raw </script must appear inside that region.
    const idIdx = html.indexOf('id="__GAUNTLET_RUN__"');
    const openEnd = html.indexOf(">", idIdx) + 1;          // end of opening <script ...>
    const closeStart = html.indexOf("</script>", openEnd); // legit closing tag
    const jsonRegion = html.slice(openEnd, closeStart);
    expect(jsonRegion).not.toMatch(/<\/script/i);
  });

  test("throws if result.json is missing", async () => {
    const { runDir: _runDir, templatePath, base } = makeFixtureRun();
    const badRunDir = join(base, "empty-run");
    mkdirSync(badRunDir);
    await expect(renderRunFromTemplate({ runDir: badRunDir, templatePath })).rejects.toThrow(/result\.json/);
  });

  test("uses outputName override when provided", async () => {
    const { runDir, templatePath } = makeFixtureRun();
    const outPath = await renderRunFromTemplate({ runDir, templatePath, outputName: "report.html" });
    expect(outPath).toBe(join(runDir, "report.html"));
    expect(existsSync(outPath)).toBe(true);
  });

  test("accepts placeholder with id before type (reversed attribute order)", async () => {
    const { runDir, base } = makeFixtureRun();
    const altTemplate = join(base, "alt-template.html");
    writeFileSync(altTemplate,
      `<!doctype html><html><head><script id="__GAUNTLET_RUN__" type="application/json">{}</script></head><body></body></html>`);
    const outPath = await renderRunFromTemplate({ runDir, templatePath: altTemplate });
    const html = readFileSync(outPath, "utf-8");
    expect(html).toContain('"runId":"card_2026T000000Z_aaaa"');
  });

  test("throws if template is missing the placeholder script tag", async () => {
    const { runDir, base } = makeFixtureRun();
    const noPlaceholder = join(base, "no-placeholder.html");
    writeFileSync(noPlaceholder,
      `<!doctype html><html><head></head><body></body></html>`);
    await expect(renderRunFromTemplate({ runDir, templatePath: noPlaceholder })).rejects.toThrow(/__GAUNTLET_RUN__/);
  });
});
