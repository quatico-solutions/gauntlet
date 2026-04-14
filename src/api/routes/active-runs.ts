import { Hono } from "hono";
import type { ActiveRunRegistry } from "../active-runs";

export function activeRunRoutes(registry: ActiveRunRegistry) {
  const router = new Hono();

  router.get("/", (c) => {
    return c.json({ runs: registry.list() });
  });

  router.get("/:id/snapshot", (c) => {
    const snap = registry.getSnapshot(c.req.param("id"));
    if (!snap) return c.json({ error: "not running" }, 404);
    return c.json(snap);
  });

  return router;
}
