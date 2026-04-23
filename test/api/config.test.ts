import { describe, test, expect } from "bun:test";
import { configRoutes } from "../../src/api/routes/config";
import { loadConfig } from "../../src/config";
import { Hono } from "hono";

describe("Config API", () => {
  test("GET /api/config returns models from GAUNTLET_MODELS", async () => {
    const config = loadConfig({}, {
      GAUNTLET_MODELS: "claude-sonnet-4-6,claude-opus-4-6",
      GAUNTLET_AGENT_MODEL: "claude-sonnet-4-6",
    } as NodeJS.ProcessEnv);

    const app = new Hono();
    app.route("/api/config", configRoutes(config));
    const res = await app.request("/api/config");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.models).toEqual(["claude-sonnet-4-6", "claude-opus-4-6"]);
    expect(body.defaultModel).toBe("claude-sonnet-4-6");
  });

  test("GET /api/config returns empty allow-list when GAUNTLET_MODELS unset", async () => {
    // GAUNTLET_MODELS is opt-in; when unset, the available list is empty
    // (no restriction). The defaultModel still reflects the agent default.
    const config = loadConfig({}, {
      GAUNTLET_AGENT_MODEL: "claude-sonnet-4-6",
    } as NodeJS.ProcessEnv);

    const app = new Hono();
    app.route("/api/config", configRoutes(config));
    const res = await app.request("/api/config");
    const body = await res.json();
    expect(body.models).toEqual([]);
    expect(body.defaultModel).toBe("claude-sonnet-4-6");
  });

  test("GET /api/config returns defaults when no env configured", async () => {
    const config = loadConfig({}, {} as NodeJS.ProcessEnv);
    const app = new Hono();
    app.route("/api/config", configRoutes(config));
    const res = await app.request("/api/config");
    const body = await res.json();
    // GAUNTLET_MODELS is unset, so the allow-list is empty; the UI falls
    // back to a free-form text input pre-populated with defaultModel.
    expect(body.models).toEqual([]);
    expect(body.defaultModel).toBe("claude-sonnet-4-6");
  });

  test("GET /api/config reflects flag-sourced model (flag beats env)", async () => {
    const config = loadConfig(
      { models: { agent: "claude-opus-4-6" } },
      { GAUNTLET_AGENT_MODEL: "claude-sonnet-4-6" } as NodeJS.ProcessEnv,
    );
    const app = new Hono();
    app.route("/api/config", configRoutes(config));
    const res = await app.request("/api/config");
    const body = await res.json();
    expect(body.defaultModel).toBe("claude-opus-4-6");
  });

  test("GET /api/config exposes defaultSaveScreencast (false by default, true under env)", async () => {
    // UI's NewRunModal reads this to prefill the checkbox state.
    const appDefault = loadConfig({}, {} as NodeJS.ProcessEnv);
    const app1 = new Hono();
    app1.route("/api/config", configRoutes(appDefault));
    const b1 = await (await app1.request("/api/config")).json();
    expect(b1.defaultSaveScreencast).toBe(false);

    const appEnv = loadConfig({}, { GAUNTLET_SAVE_SCREENCAST: "1" } as NodeJS.ProcessEnv);
    const app2 = new Hono();
    app2.route("/api/config", configRoutes(appEnv));
    const b2 = await (await app2.request("/api/config")).json();
    expect(b2.defaultSaveScreencast).toBe(true);
  });
});
