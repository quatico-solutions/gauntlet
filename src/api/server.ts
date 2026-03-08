import { Hono } from "hono";
import { scenarioRoutes } from "./routes/scenarios";
import { resultRoutes } from "./routes/results";

export function createApp(dataDir: string) {
  const app = new Hono();
  app.route("/scenarios", scenarioRoutes(dataDir));
  app.route("/results", resultRoutes());
  return app;
}
