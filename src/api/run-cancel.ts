import { Hono } from "hono";

export interface CancelToken {
  cancelled: boolean;
}

export class CancelTokenRegistry {
  private tokens = new Map<string, CancelToken>();

  register(runId: string, token: CancelToken): void {
    this.tokens.set(runId, token);
  }

  unregister(runId: string): void {
    this.tokens.delete(runId);
  }

  get(runId: string): CancelToken | undefined {
    return this.tokens.get(runId);
  }
}

export function runCancelRoutes(registry: CancelTokenRegistry) {
  const router = new Hono();
  router.delete("/:runId", (c) => {
    const token = registry.get(c.req.param("runId"));
    if (!token) return c.json({ error: "not in flight" }, 404);
    token.cancelled = true;
    return c.json({ status: "cancelling" }, 202);
  });
  return router;
}
