import { Hono } from "hono";

export function resultRoutes() {
  const router = new Hono();

  router.get("/", (c) => {
    return c.json([]); // TODO: implement result storage
  });

  return router;
}
