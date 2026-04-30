import { describe, test, expect } from "bun:test";
import { Hono } from "hono";
import { CancelTokenRegistry, runCancelRoutes } from "../../src/api/run-cancel";

describe("CancelTokenRegistry", () => {
  test("register/get round trip", () => {
    const r = new CancelTokenRegistry();
    const token = { cancelled: false };
    r.register("r1", token);
    expect(r.get("r1")).toBe(token);
  });

  test("unregister removes the token", () => {
    const r = new CancelTokenRegistry();
    r.register("r1", { cancelled: false });
    r.unregister("r1");
    expect(r.get("r1")).toBeUndefined();
  });
});

describe("DELETE /api/runs/:runId", () => {
  test("flips the registered cancel token; returns 202", async () => {
    const reg = new CancelTokenRegistry();
    const token = { cancelled: false };
    reg.register("r1", token);

    const app = new Hono();
    app.route("/api/runs", runCancelRoutes(reg));

    const res = await app.request("/api/runs/r1", { method: "DELETE" });
    expect(res.status).toBe(202);
    expect(token.cancelled).toBe(true);
  });

  test("returns 404 if no token registered", async () => {
    const app = new Hono();
    app.route("/api/runs", runCancelRoutes(new CancelTokenRegistry()));
    const res = await app.request("/api/runs/unknown", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});
