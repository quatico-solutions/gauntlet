import { Hono } from "hono";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { CancelTokenRegistry } from "../run-cancel";

const RUN_SET_ID_RE = /^[a-z]+_\d{8}T\d{6}Z_[a-z0-9]+$/;

export function runSetRoutes(gauntletRoot: string, cancelTokens?: CancelTokenRegistry) {
  const router = new Hono();

  router.get("/:id", (c) => {
    const id = c.req.param("id");
    if (!RUN_SET_ID_RE.test(id)) return c.json({ error: "invalid run set id" }, 400);
    const path = join(gauntletRoot, "run-sets", id, "set.json");
    if (!existsSync(path)) return c.json({ error: "not found" }, 404);
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    return c.json(manifest);
  });

  router.get("/:id/summary", (c) => {
    const id = c.req.param("id");
    if (!RUN_SET_ID_RE.test(id)) return c.json({ error: "invalid run set id" }, 400);
    const path = join(gauntletRoot, "run-sets", id, "set.json");
    if (!existsSync(path)) return c.json({ error: "not found" }, 404);
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    if (!manifest.summary) return c.json({ error: "summary not yet computed" }, 404);
    return c.json(manifest.summary);
  });

  router.delete("/:id", (c) => {
    const id = c.req.param("id");
    if (!RUN_SET_ID_RE.test(id)) return c.json({ error: "invalid run set id" }, 400);
    const token = cancelTokens?.get(id);
    if (!token) return c.json({ error: "not in flight" }, 404);
    token.cancelled = true;
    return c.json({ status: "cancelling" }, 202);
  });

  return router;
}
