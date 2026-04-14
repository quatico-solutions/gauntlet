import { describe, test, expect } from "bun:test";
import { loadConfig } from "../src/config";

describe("loadConfig", () => {
  const emptyEnv = {} as NodeJS.ProcessEnv;

  test("all defaults when no args and empty env", () => {
    const c = loadConfig({}, emptyEnv);
    expect(c.dataDir).toBe(".");
    expect(c.port).toBe(4400);
    expect(c.defaultChrome).toEqual({ host: "127.0.0.1", port: 9222 });
    expect(c.models.agent).toBe("claude-sonnet-4-6");
    expect(c.models.fanout).toBeUndefined();
    expect(c.models.available).toEqual(["claude-sonnet-4-6"]);
    expect(c.apiKeys).toEqual({ anthropic: false, openai: false });
    expect(c.sources.dataDir).toBe("default");
  });

  test("env vars override defaults", () => {
    const c = loadConfig({}, {
      GAUNTLET_PORT: "5500",
      GAUNTLET_AGENT_MODEL: "gpt-4o",
      GAUNTLET_DATA_DIR: "/data",
      GAUNTLET_CHROME: "chrome-svc:9333",
      GAUNTLET_MODELS: "claude-sonnet-4-6,gpt-4o",
      ANTHROPIC_API_KEY: "sk-ant-xxx",
    } as NodeJS.ProcessEnv);
    expect(c.port).toBe(5500);
    expect(c.models.agent).toBe("gpt-4o");
    expect(c.dataDir).toBe("/data");
    expect(c.defaultChrome).toEqual({ host: "chrome-svc", port: 9333 });
    expect(c.models.available).toEqual(["claude-sonnet-4-6", "gpt-4o"]);
    expect(c.apiKeys.anthropic).toBe(true);
    expect(c.apiKeys.openai).toBe(false);
    expect(c.sources.port).toBe("env");
    expect(c.sources["models.agent"]).toBe("env");
  });

  test("CLI args override env vars", () => {
    const c = loadConfig(
      { port: 6600, dataDir: "/flag", chrome: "flag-host:9444", models: { agent: "claude-opus-4-6" } },
      { GAUNTLET_PORT: "5500", GAUNTLET_DATA_DIR: "/env", GAUNTLET_CHROME: "env:9333", GAUNTLET_AGENT_MODEL: "gpt-4o" } as NodeJS.ProcessEnv,
    );
    expect(c.port).toBe(6600);
    expect(c.dataDir).toBe("/flag");
    expect(c.defaultChrome).toEqual({ host: "flag-host", port: 9444 });
    expect(c.models.agent).toBe("claude-opus-4-6");
    expect(c.sources.port).toBe("flag");
    expect(c.sources.dataDir).toBe("flag");
    expect(c.sources.defaultChrome).toBe("flag");
    expect(c.sources["models.agent"]).toBe("flag");
  });

  test("invalid GAUNTLET_CHROME format throws", () => {
    expect(() => loadConfig({}, { GAUNTLET_CHROME: "no-port-here" } as NodeJS.ProcessEnv))
      .toThrow(/GAUNTLET_CHROME/);
  });

  test("invalid --chrome format throws", () => {
    expect(() => loadConfig({ chrome: "no-port-here" }, emptyEnv))
      .toThrow(/chrome/i);
  });

  test("invalid port in env throws", () => {
    expect(() => loadConfig({}, { GAUNTLET_PORT: "not-a-number" } as NodeJS.ProcessEnv))
      .toThrow(/GAUNTLET_PORT/);
  });

  test("available models falls back to [agent] when GAUNTLET_MODELS unset", () => {
    const c = loadConfig({}, { GAUNTLET_AGENT_MODEL: "gpt-4o" } as NodeJS.ProcessEnv);
    expect(c.models.available).toEqual(["gpt-4o"]);
  });

  test("apiKeys reflects both providers when both keys set", () => {
    const c = loadConfig({}, { ANTHROPIC_API_KEY: "sk-ant-xxx", OPENAI_API_KEY: "sk-xxx" } as NodeJS.ProcessEnv);
    expect(c.apiKeys).toEqual({ anthropic: true, openai: true });
  });
});
