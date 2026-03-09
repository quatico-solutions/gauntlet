import { describe, test, expect, afterEach } from "bun:test";
import { CLIAdapter } from "../../../src/adapters/cli/adapter";

describe("CLIAdapter", () => {
  let adapter: CLIAdapter | null = null;

  afterEach(async () => {
    if (adapter) await adapter.close();
    adapter = null;
  });

  test("starts a shell and reads output", async () => {
    adapter = new CLIAdapter();
    await adapter.start("echo 'hello gauntlet'");
    // Give it time to produce output
    await new Promise((r) => setTimeout(r, 500));
    const output = adapter.readOutput();
    expect(output).toContain("hello gauntlet");
  });

  test("sends input and reads response", async () => {
    adapter = new CLIAdapter();
    await adapter.start("cat");
    await adapter.type("ping\n");
    await new Promise((r) => setTimeout(r, 500));
    const output = adapter.readOutput();
    expect(output).toContain("ping");
  });

  test("exposes tool definitions for the agent", () => {
    adapter = new CLIAdapter();
    const tools = adapter.toolDefinitions();
    const names = tools.map((t) => t.name);
    expect(names).toContain("type");
    expect(names).toContain("press");
    expect(names).toContain("read_output");
  });
});
