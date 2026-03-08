import { Hono } from "hono";
import { join } from "path";
import { scenarioRoutes } from "./routes/scenarios";
import { resultRoutes } from "./routes/results";
import { fanoutRoutes } from "./routes/fanout";
import { runRoutes } from "./routes/run";

export function createApp(dataDir: string) {
  const app = new Hono();
  const api = new Hono();
  api.route("/scenarios", scenarioRoutes(dataDir));
  api.route("/results", resultRoutes(join(dataDir, "results")));
  api.route("/fanout", fanoutRoutes(dataDir));
  api.route("/run", runRoutes(dataDir));
  app.route("/api", api);
  return app;
}
