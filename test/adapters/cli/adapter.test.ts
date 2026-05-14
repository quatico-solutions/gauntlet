import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { CLIAdapter } from "../../../src/adapters/cli/adapter";
import type { EvidenceLogger } from "../../../src/evidence/logger";

const mockLogger = { logAction: () => {} } as unknown as EvidenceLogger;

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

  test("includes `read` tool when context root is non-empty", () => {
    const tmp = mkdtempSync(join(tmpdir(), "gauntlet-cli-read-wire-"));
    try {
      mkdirSync(join(tmp, ".gauntlet", "context"), { recursive: true });
      writeFileSync(join(tmp, ".gauntlet", "context", "alice.md"), "A");
      adapter = new CLIAdapter({
        contextRoot: join(tmp, ".gauntlet", "context"),
      });
      const names = adapter.toolDefinitions().map((t) => t.name);
      expect(names).toContain("read");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("executeTool(read) returns file contents via the `read` tool", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "gauntlet-cli-read-exec-"));
    try {
      mkdirSync(join(tmp, ".gauntlet", "context", "alice"), { recursive: true });
      writeFileSync(
        join(tmp, ".gauntlet", "context", "alice", "credentials.md"),
        "Username: alice\nPassword: hunter2",
      );
      adapter = new CLIAdapter({
        contextRoot: join(tmp, ".gauntlet", "context"),
      });
      const result = await adapter.executeTool(
        "read",
        { path: "alice/credentials.md" },
        mockLogger,
      );
      expect(result.text).toContain("Username: alice");
      expect(result.text).toContain("Password: hunter2");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("defaultViewport returns null — CLI has no rendering surface", () => {
    const adapter = new CLIAdapter();
    expect(adapter.defaultViewport()).toBeNull();
  });

  test("describeTarget frames the program as already running", () => {
    const adapter = new CLIAdapter();
    const msg = adapter.describeTarget("bc -q");
    expect(msg).toContain("bc -q");
    expect(msg.toLowerCase()).toContain("already running");
    expect(msg.toLowerCase()).toContain("do not retype");
  });

  test("registers fetch_credential when contextRoot and credentialResolver set", () => {
    const { mkdtempSync, writeFileSync, chmodSync, rmSync } = require("fs");
    const { tmpdir } = require("os");
    const { join } = require("path");
    const ctxTmp = mkdtempSync(join(tmpdir(), "gauntlet-cli-cred-ctx-"));
    const resTmp = mkdtempSync(join(tmpdir(), "gauntlet-cli-cred-res-"));
    try {
      writeFileSync(join(ctxTmp, "alice.md"), "anything");
      const resolverPath = join(resTmp, "r.sh");
      writeFileSync(resolverPath, "#!/bin/sh\necho ok\n");
      chmodSync(resolverPath, 0o755);
      const adapter = new CLIAdapter({
        contextRoot: ctxTmp,
        credentialResolver: { path: resolverPath, timeoutMs: 1000, includeInTranscripts: false },
      });
      expect(adapter.toolDefinitions().map((t) => t.name)).toContain("fetch_credential");
    } finally {
      rmSync(ctxTmp, { recursive: true, force: true });
      rmSync(resTmp, { recursive: true, force: true });
    }
  });

  test("omits fetch_credential when credentialResolver is undefined", () => {
    const { mkdtempSync, writeFileSync, rmSync } = require("fs");
    const { tmpdir } = require("os");
    const { join } = require("path");
    const ctxTmp = mkdtempSync(join(tmpdir(), "gauntlet-cli-cred-ctx-"));
    try {
      writeFileSync(join(ctxTmp, "alice.md"), "anything");
      const adapter = new CLIAdapter({ contextRoot: ctxTmp });
      expect(adapter.toolDefinitions().map((t) => t.name)).not.toContain("fetch_credential");
    } finally {
      rmSync(ctxTmp, { recursive: true, force: true });
    }
  });

  test("omits fetch_credential when contextRoot is empty even if resolver is set", () => {
    const { mkdtempSync, writeFileSync, chmodSync, rmSync } = require("fs");
    const { tmpdir } = require("os");
    const { join } = require("path");
    const ctxTmp = mkdtempSync(join(tmpdir(), "gauntlet-cli-cred-ctx-empty-"));
    const resTmp = mkdtempSync(join(tmpdir(), "gauntlet-cli-cred-res-"));
    try {
      const resolverPath = join(resTmp, "r.sh");
      writeFileSync(resolverPath, "#!/bin/sh\necho ok\n");
      chmodSync(resolverPath, 0o755);
      const adapter = new CLIAdapter({
        contextRoot: ctxTmp,
        credentialResolver: { path: resolverPath, timeoutMs: 1000, includeInTranscripts: false },
      });
      expect(adapter.toolDefinitions().map((t) => t.name)).not.toContain("fetch_credential");
    } finally {
      rmSync(ctxTmp, { recursive: true, force: true });
      rmSync(resTmp, { recursive: true, force: true });
    }
  });
});
