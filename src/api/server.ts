import { Hono } from "hono";
import { join } from "path";
import { scenarioRoutes } from "./routes/scenarios";
import { resultRoutes } from "./routes/results";
import { fanoutRoutes } from "./routes/fanout";

export function createApp(dataDir: string) {
  const app = new Hono();
  app.route("/scenarios", scenarioRoutes(dataDir));
  app.route("/results", resultRoutes(join(dataDir, "results")));
  app.route("/fanout", fanoutRoutes(dataDir));
  return app;
}
