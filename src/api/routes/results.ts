import { Hono } from "hono";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { isSafePath } from "../safe-path";
import { getMimeType } from "../mime-types";

export function resultRoutes(resultsDir: string) {
  const router = new Hono();

  router.get("/", (c) => {
    if (!existsSync(resultsDir)) {
      return c.json([]);
    }

    const entries = readdirSync(resultsDir, { withFileTypes: true });
    const results: unknown[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const path = join(resultsDir, e.name, "result.json");
      if (!existsSync(path)) continue;
      try {
        const content = readFileSync(path, "utf-8");
        results.push(JSON.parse(content));
      } catch {
        // Skip malformed result files
      }
    }

    return c.json(results);
  });

  router.get("/:scenario", (c) => {
    const scenario = c.req.param("scenario");
    const resultPath = join(resultsDir, scenario, "result.json");

    if (!isSafePath(resultsDir, resultPath)) {
      return c.json({ error: "invalid path" }, 400);
    }

    if (!existsSync(resultPath)) {
      return c.json({ error: "not found" }, 404);
    }

    try {
      const content = readFileSync(resultPath, "utf-8");
      return c.json(JSON.parse(content));
    } catch {
      return c.json({ error: "malformed result file" }, 500);
    }
  });

  // Manifest-controlled file route: serves any file within a run directory by
  // its relative path. The manifest entries in result.json already store
  // relative paths (e.g. "screenshots/001.png"), so the client just passes
  // the manifest string through. Path traversal is blocked via isSafePath.
  // See docs/format.md for the contract.
  router.get("/:scenario/file/:path{.+}", (c) => {
    const scenario = c.req.param("scenario");
    const relPath = c.req.param("path");
    const scenarioDir = join(resultsDir, scenario);
    const filePath = join(scenarioDir, relPath);

    if (!isSafePath(scenarioDir, filePath)) {
      return c.json({ error: "invalid path" }, 400);
    }

    if (!existsSync(filePath)) {
      return c.json({ error: "not found" }, 404);
    }

    const content = readFileSync(filePath);
    const ext = relPath.split(".").pop() || "";
    return new Response(content, {
      headers: { "Content-Type": getMimeType(ext) },
    });
  });

  return router;
}
