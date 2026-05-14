# fetch_credential Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new built-in Gauntlet agent tool `fetch_credential(entity, key) → markdown`, backed by a caller-provided executable invoked as `$GAUNTLET_CREDENTIAL_RESOLVER <entity> <key>`. The tool is registered only when both `contextRootIsPopulated(contextRoot)` and a resolver is configured; otherwise the agent never sees it.

**Architecture:** One new module at `src/context/credential-tool.ts` containing a pure subprocess runner (`runResolver`) and an adapter-agnostic tool builder (`buildFetchCredentialTool`), mirroring the shape of `src/context/read-tool.ts`. Config changes in `src/config.ts` add three env vars and a `credentialResolver` field on `AppConfig` / `EffectiveRunConfig`. Each of the three adapters splices the tool registration alongside `buildReadTool`. The orchestrator at `src/runs/orchestrator.ts` threads the field from `EffectiveRunConfig` into adapter options.

**Tech Stack:** Bun/TypeScript. `bun:test` for tests. `child_process.spawn` for resolver invocation (Bun-compatible). Existing patterns from `src/adapters/web/passkey.ts` (logger + step-labeled events) and `src/context/read-tool.ts` (adapter-agnostic tool, gated on `contextRootIsPopulated`).

**Spec:** `docs/superpowers/specs/2026-05-14-fetch-credential-design.md` (commit `f3bae96`).
**Ticket:** PRI-1605.

---

## File Map

**Create:**

- `src/context/credential-tool.ts` — `runResolver(config, entity, key)`, `buildFetchCredentialTool(contextRoot, resolverConfig, logger)`, `FetchCredentialTool` interface, `CredentialResolverConfig` interface, `ResolverResult` type, `FETCH_CREDENTIAL_TOOL_DESCRIPTION` const.
- `test/context/credential-tool.test.ts` — unit tests for both exports.
- `test/fixtures/credential-resolver-ok.sh` — canned-success resolver used by tests.
- `test/fixtures/credential-resolver-fail.sh` — canned-failure resolver used by tests.
- `test/fixtures/credential-resolver-slow.sh` — slow resolver for timeout tests.

**Modify:**

- `src/config.ts` — add `CredentialCredentialResolverConfig` interface, three env vars, `loadConfig` validation/population, `credentialResolver` on `AppConfig` and `EffectiveRunConfig`, `mergeRunConfig` propagation.
- `src/context/credential-tool.ts` — (created in earlier task; subsequent tasks add to it).
- `src/adapters/web/adapter.ts` — add `credentialResolver?` to `WebAdapterOptions`, splice tool registration, dispatch in `executeTool`.
- `src/adapters/cli/adapter.ts` — same.
- `src/adapters/tui/adapter.ts` — same.
- `src/runs/orchestrator.ts` — thread `credentialResolver` through `buildDefaultAdapter` to each adapter.
- `test/config.test.ts` — add resolver-config tests.
- `test/adapters/web/adapter.test.ts` — registration test for `fetch_credential`.
- `test/adapters/cli/adapter.test.ts` — registration test.
- `test/adapters/tui/adapter.test.ts` — registration test.
- `docs/credentials.md` — add `fetch_credential` section.

---

## Task 1: Add credentialResolver config field and env-var parsing

**Files:**
- Modify: `src/config.ts`
- Test: `test/config.test.ts`

Add the three env vars (`GAUNTLET_CREDENTIAL_RESOLVER`, `GAUNTLET_CREDENTIAL_RESOLVER_TIMEOUT_MS`, `GAUNTLET_CREDENTIAL_INCLUDE_IN_TRANSCRIPTS`), validate the resolver path (regular file, executable bit set), populate `AppConfig.credentialResolver` and propagate through `EffectiveRunConfig`.

- [ ] **Step 1: Write failing test — config exposes credentialResolver when env var is set**

Add to `test/config.test.ts` (after the existing `describe("loadConfig", ...)` tests, before the closing `});`):

```typescript
test("GAUNTLET_CREDENTIAL_RESOLVER populates credentialResolver", () => {
  const { mkdtempSync, writeFileSync, chmodSync, rmSync } = require("fs");
  const { tmpdir } = require("os");
  const { join } = require("path");
  const tmp = mkdtempSync(join(tmpdir(), "gauntlet-cfg-resolver-"));
  try {
    const resolverPath = join(tmp, "resolver.sh");
    writeFileSync(resolverPath, "#!/bin/sh\necho ok\n");
    chmodSync(resolverPath, 0o755);
    const c = loadConfig({}, {
      GAUNTLET_CREDENTIAL_RESOLVER: resolverPath,
    } as NodeJS.ProcessEnv);
    expect(c.credentialResolver).toEqual({
      path: resolverPath,
      timeoutMs: 10_000,
      includeInTranscripts: false,
    });
    expect(c.sources.credentialResolver).toBe("env");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("credentialResolver is undefined when env var unset", () => {
  const c = loadConfig({}, {} as NodeJS.ProcessEnv);
  expect(c.credentialResolver).toBeUndefined();
  expect(c.sources.credentialResolver).toBe("default");
});

test("GAUNTLET_CREDENTIAL_RESOLVER_TIMEOUT_MS overrides default", () => {
  const { mkdtempSync, writeFileSync, chmodSync, rmSync } = require("fs");
  const { tmpdir } = require("os");
  const { join } = require("path");
  const tmp = mkdtempSync(join(tmpdir(), "gauntlet-cfg-resolver-"));
  try {
    const resolverPath = join(tmp, "resolver.sh");
    writeFileSync(resolverPath, "#!/bin/sh\necho ok\n");
    chmodSync(resolverPath, 0o755);
    const c = loadConfig({}, {
      GAUNTLET_CREDENTIAL_RESOLVER: resolverPath,
      GAUNTLET_CREDENTIAL_RESOLVER_TIMEOUT_MS: "5000",
    } as NodeJS.ProcessEnv);
    expect(c.credentialResolver?.timeoutMs).toBe(5_000);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("GAUNTLET_CREDENTIAL_INCLUDE_IN_TRANSCRIPTS=1 sets includeInTranscripts true", () => {
  const { mkdtempSync, writeFileSync, chmodSync, rmSync } = require("fs");
  const { tmpdir } = require("os");
  const { join } = require("path");
  const tmp = mkdtempSync(join(tmpdir(), "gauntlet-cfg-resolver-"));
  try {
    const resolverPath = join(tmp, "resolver.sh");
    writeFileSync(resolverPath, "#!/bin/sh\necho ok\n");
    chmodSync(resolverPath, 0o755);
    const c = loadConfig({}, {
      GAUNTLET_CREDENTIAL_RESOLVER: resolverPath,
      GAUNTLET_CREDENTIAL_INCLUDE_IN_TRANSCRIPTS: "1",
    } as NodeJS.ProcessEnv);
    expect(c.credentialResolver?.includeInTranscripts).toBe(true);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("GAUNTLET_CREDENTIAL_RESOLVER pointing at nonexistent path throws", () => {
  expect(() =>
    loadConfig({}, {
      GAUNTLET_CREDENTIAL_RESOLVER: "/nonexistent/path/credential-resolver.sh",
    } as NodeJS.ProcessEnv),
  ).toThrow(/GAUNTLET_CREDENTIAL_RESOLVER/);
});

test("GAUNTLET_CREDENTIAL_RESOLVER pointing at non-executable file throws", () => {
  const { mkdtempSync, writeFileSync, chmodSync, rmSync } = require("fs");
  const { tmpdir } = require("os");
  const { join } = require("path");
  const tmp = mkdtempSync(join(tmpdir(), "gauntlet-cfg-resolver-"));
  try {
    const resolverPath = join(tmp, "resolver.sh");
    writeFileSync(resolverPath, "not-executable");
    chmodSync(resolverPath, 0o644);
    expect(() =>
      loadConfig({}, {
        GAUNTLET_CREDENTIAL_RESOLVER: resolverPath,
      } as NodeJS.ProcessEnv),
    ).toThrow(/GAUNTLET_CREDENTIAL_RESOLVER/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("relative GAUNTLET_CREDENTIAL_RESOLVER is resolved against projectRoot", () => {
  const { mkdtempSync, writeFileSync, chmodSync, rmSync } = require("fs");
  const { tmpdir } = require("os");
  const { join } = require("path");
  const tmp = mkdtempSync(join(tmpdir(), "gauntlet-cfg-resolver-"));
  try {
    const resolverPath = join(tmp, "resolver.sh");
    writeFileSync(resolverPath, "#!/bin/sh\necho ok\n");
    chmodSync(resolverPath, 0o755);
    const c = loadConfig({}, {
      GAUNTLET_PROJECT_ROOT: tmp,
      GAUNTLET_CREDENTIAL_RESOLVER: "resolver.sh",
    } as NodeJS.ProcessEnv);
    expect(c.credentialResolver?.path).toBe(resolverPath);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/config.test.ts`

Expected: 7 failures, all citing missing `credentialResolver` field on `AppConfig` or missing env-var handling.

- [ ] **Step 3: Add interface and constants to `src/config.ts`**

After the existing `Viewport` interface (around line 12), add:

```typescript
export interface CredentialCredentialResolverConfig {
  path: string;
  timeoutMs: number;
  includeInTranscripts: boolean;
}
```

After `const DEFAULT_AGENT_MODEL = "claude-sonnet-4-6";` (around line 286), add:

```typescript
const DEFAULT_CREDENTIAL_RESOLVER_TIMEOUT_MS = 10_000;
```

- [ ] **Step 4: Add field to `AppConfig` and `EffectiveRunConfig`**

In `AppConfig` (in `src/config.ts`), add after `apiKeys`:

```typescript
  /**
   * Caller-provided runtime credential resolver. When set, the
   * `fetch_credential` agent tool is registered and invokes this
   * executable per call with `<entity> <key>` as argv. Undefined when
   * GAUNTLET_CREDENTIAL_RESOLVER is unset. PRI-1605.
   */
  credentialResolver?: CredentialCredentialResolverConfig;
```

In `AppConfig.sources` (the sources block), add:

```typescript
    credentialResolver: "default" | "env";
```

In `EffectiveRunConfig`, add after `reflectionInterval`:

```typescript
  /**
   * Caller-provided credential resolver, threaded through from
   * AppConfig. Adapters use this to register the fetch_credential
   * tool when set. PRI-1605.
   */
  credentialResolver?: CredentialCredentialResolverConfig;
```

- [ ] **Step 5: Add resolver-path validator to `src/config.ts`**

Add this helper function near the other parse helpers (around line 337):

```typescript
function resolveCredentialResolver(
  rawPath: string,
  projectRoot: string,
): CredentialCredentialResolverConfig["path"] {
  const { resolve, isAbsolute } = require("path");
  const { statSync } = require("fs");
  const absolute = isAbsolute(rawPath) ? rawPath : resolve(projectRoot, rawPath);
  let stat;
  try {
    stat = statSync(absolute);
  } catch (err) {
    throw new Error(
      `Invalid GAUNTLET_CREDENTIAL_RESOLVER "${rawPath}": cannot stat "${absolute}" (${(err as Error).message})`,
    );
  }
  if (!stat.isFile()) {
    throw new Error(
      `Invalid GAUNTLET_CREDENTIAL_RESOLVER "${rawPath}": "${absolute}" is not a regular file`,
    );
  }
  // Any execute bit set (owner, group, or other).
  if ((stat.mode & 0o111) === 0) {
    throw new Error(
      `Invalid GAUNTLET_CREDENTIAL_RESOLVER "${rawPath}": "${absolute}" is not executable (mode ${(stat.mode & 0o777).toString(8)})`,
    );
  }
  return absolute;
}
```

- [ ] **Step 6: Wire env-var parsing into `loadConfig`**

In `loadConfig` (in `src/config.ts`), find the `apiKeys` block (around line 558). Immediately before `return {`, add:

```typescript
  // credentialResolver — caller-provided fetch_credential backend (PRI-1605).
  let credentialResolver: CredentialCredentialResolverConfig | undefined;
  let credentialResolverSource: "default" | "env" = "default";
  if (env.GAUNTLET_CREDENTIAL_RESOLVER) {
    const resolvedPath = resolveCredentialResolver(
      env.GAUNTLET_CREDENTIAL_RESOLVER,
      projectRoot,
    );
    const timeoutMs = parseNonNegIntEnv(
      env.GAUNTLET_CREDENTIAL_RESOLVER_TIMEOUT_MS,
      "GAUNTLET_CREDENTIAL_RESOLVER_TIMEOUT_MS",
      DEFAULT_CREDENTIAL_RESOLVER_TIMEOUT_MS,
    );
    const includeInTranscripts = env.GAUNTLET_CREDENTIAL_INCLUDE_IN_TRANSCRIPTS
      ? parseBoolEnv(env.GAUNTLET_CREDENTIAL_INCLUDE_IN_TRANSCRIPTS, "GAUNTLET_CREDENTIAL_INCLUDE_IN_TRANSCRIPTS")
      : false;
    credentialResolver = { path: resolvedPath, timeoutMs, includeInTranscripts };
    credentialResolverSource = "env";
  }
```

In the `return { ... }` block, add `credentialResolver,` after `apiKeys,` and add `credentialResolver: credentialResolverSource,` inside the `sources: { ... }` block.

- [ ] **Step 7: Propagate `credentialResolver` from AppConfig to EffectiveRunConfig**

In `mergeRunConfig` (in `src/config.ts`, around line 254), add `credentialResolver: app.credentialResolver,` to the returned `EffectiveRunConfig`.

- [ ] **Step 8: Run config tests to verify they pass**

Run: `bun test test/config.test.ts`

Expected: all tests pass, including the seven new ones from Step 1.

- [ ] **Step 9: Commit**

```bash
git add src/config.ts test/config.test.ts
git commit -m "$(cat <<'EOF'
feat(config): credentialResolver field for fetch_credential tool (PRI-1605)

Three new env vars (GAUNTLET_CREDENTIAL_RESOLVER,
GAUNTLET_CREDENTIAL_RESOLVER_TIMEOUT_MS,
GAUNTLET_CREDENTIAL_INCLUDE_IN_TRANSCRIPTS) populate
AppConfig.credentialResolver, propagated through EffectiveRunConfig.
Path is validated at boot (regular file + executable bit); relative
paths resolved against projectRoot.

Co-Authored-By: Lirael@36bd0b63 (Opus 4.7)
EOF
)"
```

---

## Task 2: Implement runResolver (pure subprocess invocation)

**Files:**
- Create: `src/context/credential-tool.ts`
- Create: `test/context/credential-tool.test.ts`
- Create: `test/fixtures/credential-resolver-ok.sh`
- Create: `test/fixtures/credential-resolver-fail.sh`
- Create: `test/fixtures/credential-resolver-slow.sh`

Pure subprocess function with timeout cascade, output caps, and structured result. No tool wrapper yet.

- [ ] **Step 1: Write fixture scripts**

Create `test/fixtures/credential-resolver-ok.sh`:

```bash
#!/usr/bin/env bash
# Canned success resolver for credential-tool tests.
# argv: <entity> <key>
echo "ok-for-$1:$2"
```

Create `test/fixtures/credential-resolver-fail.sh`:

```bash
#!/usr/bin/env bash
# Canned failure resolver. Prints to stderr, exits 2.
echo "no credential '$2' for entity '$1'" >&2
exit 2
```

Create `test/fixtures/credential-resolver-slow.sh`:

```bash
#!/usr/bin/env bash
# Slow resolver for timeout tests. Prints AFTER a long sleep so the
# timeout cascade fires before any output is captured.
sleep 30
echo "should-never-print"
```

Make them executable:

```bash
chmod +x test/fixtures/credential-resolver-ok.sh test/fixtures/credential-resolver-fail.sh test/fixtures/credential-resolver-slow.sh
```

- [ ] **Step 2: Write failing tests for runResolver**

Create `test/context/credential-tool.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { runResolver } from "../../src/context/credential-tool";
import type { CredentialResolverConfig } from "../../src/config";

const FIXTURES = resolve(__dirname, "../fixtures");
const OK = resolve(FIXTURES, "credential-resolver-ok.sh");
const FAIL = resolve(FIXTURES, "credential-resolver-fail.sh");
const SLOW = resolve(FIXTURES, "credential-resolver-slow.sh");

function cfg(path: string, timeoutMs = 5_000): CredentialResolverConfig {
  return { path, timeoutMs, includeInTranscripts: false };
}

describe("runResolver", () => {
  test("success: captures stdout and exits 0", async () => {
    const result = await runResolver(cfg(OK), "alice", "otp");
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.stdout).toBe("ok-for-alice:otp\n");
      expect(result.exitCode).toBe(0);
      expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    }
  });

  test("nonzero exit: stderr captured, kind=nonzero_exit", async () => {
    const result = await runResolver(cfg(FAIL), "alice", "pin");
    expect(result.kind).toBe("nonzero_exit");
    if (result.kind === "nonzero_exit") {
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("no credential 'pin' for entity 'alice'");
    }
  });

  test("empty stdout on success is reported as empty_stdout", async () => {
    // Resolver that exits 0 but prints nothing to stdout.
    const empty = resolve(FIXTURES, "credential-resolver-empty.sh");
    const { writeFileSync, chmodSync, unlinkSync } = require("fs");
    writeFileSync(empty, "#!/usr/bin/env bash\nexit 0\n");
    chmodSync(empty, 0o755);
    try {
      const result = await runResolver(cfg(empty), "alice", "otp");
      expect(result.kind).toBe("empty_stdout");
    } finally {
      try { unlinkSync(empty); } catch {}
    }
  });

  test("timeout: SIGTERM after timeout, then SIGKILL after grace", async () => {
    const start = Date.now();
    const result = await runResolver(cfg(SLOW, 200), "alice", "otp");
    const elapsed = Date.now() - start;
    expect(result.kind).toBe("timeout");
    // Timeout (200ms) + grace (2000ms) = ~2200ms ceiling; allow slack.
    expect(elapsed).toBeLessThan(3_500);
    if (result.kind === "timeout") {
      expect(result.timeoutMs).toBe(200);
    }
  });

  test("spawn failure: missing binary returns kind=spawn_failed", async () => {
    const result = await runResolver(cfg("/nonexistent/resolver.sh"), "alice", "otp");
    expect(result.kind).toBe("spawn_failed");
    if (result.kind === "spawn_failed") {
      expect(result.error).toMatch(/ENOENT|no such file/i);
    }
  });

  test("stdout overflow: resolver writes > 64 KiB returns kind=stdout_overflow", async () => {
    // Resolver that prints 100 KiB.
    const overflow = resolve(FIXTURES, "credential-resolver-overflow.sh");
    const { writeFileSync, chmodSync, unlinkSync } = require("fs");
    writeFileSync(
      overflow,
      "#!/usr/bin/env bash\nhead -c 102400 /dev/zero | tr '\\0' 'x'\n",
    );
    chmodSync(overflow, 0o755);
    try {
      const result = await runResolver(cfg(overflow), "alice", "otp");
      expect(result.kind).toBe("stdout_overflow");
    } finally {
      try { unlinkSync(overflow); } catch {}
    }
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test test/context/credential-tool.test.ts`

Expected: failure citing missing `src/context/credential-tool.ts` module.

- [ ] **Step 4: Implement runResolver**

Create `src/context/credential-tool.ts`:

```typescript
import { spawn } from "child_process";
import type { CredentialResolverConfig } from "../config";

export type ResolverResult =
  | { kind: "ok"; stdout: string; stderr: string; exitCode: 0; elapsedMs: number }
  | { kind: "nonzero_exit"; stdout: string; stderr: string; exitCode: number; elapsedMs: number }
  | { kind: "empty_stdout"; stderr: string; exitCode: 0; elapsedMs: number }
  | { kind: "timeout"; stderr: string; timeoutMs: number; elapsedMs: number }
  | { kind: "spawn_failed"; error: string }
  | { kind: "stdout_overflow"; elapsedMs: number }
  | { kind: "stderr_overflow"; elapsedMs: number };

const STDOUT_CAP_BYTES = 64 * 1024;
const STDERR_CAP_BYTES = 8 * 1024;
const KILL_GRACE_MS = 2_000;

export async function runResolver(
  config: CredentialResolverConfig,
  entity: string,
  key: string,
): Promise<ResolverResult> {
  const start = Date.now();
  let child;
  try {
    child = spawn(config.path, [entity, key], {
      detached: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    return { kind: "spawn_failed", error: (err as Error).message };
  }

  return new Promise<ResolverResult>((resolveOutcome) => {
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutOverflow = false;
    let stderrOverflow = false;
    let timedOut = false;
    let settled = false;

    const settle = (result: ResolverResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      clearTimeout(killHandle);
      resolveOutcome(result);
    };

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGTERM"); } catch {}
    }, config.timeoutMs);

    const killHandle = setTimeout(() => {
      if (!settled) {
        try { child.kill("SIGKILL"); } catch {}
      }
    }, config.timeoutMs + KILL_GRACE_MS);

    child.stdout!.on("data", (chunk: Buffer) => {
      if (stdoutOverflow) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > STDOUT_CAP_BYTES) {
        stdoutOverflow = true;
        try { child.kill("SIGKILL"); } catch {}
        settle({ kind: "stdout_overflow", elapsedMs: Date.now() - start });
        return;
      }
      stdoutChunks.push(chunk);
    });

    child.stderr!.on("data", (chunk: Buffer) => {
      if (stderrOverflow) return;
      stderrBytes += chunk.length;
      if (stderrBytes > STDERR_CAP_BYTES) {
        stderrOverflow = true;
        try { child.kill("SIGKILL"); } catch {}
        settle({ kind: "stderr_overflow", elapsedMs: Date.now() - start });
        return;
      }
      stderrChunks.push(chunk);
    });

    child.on("error", (err) => {
      settle({ kind: "spawn_failed", error: err.message });
    });

    child.on("exit", (code) => {
      if (settled) return;
      const elapsedMs = Date.now() - start;
      const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
      const stderr = Buffer.concat(stderrChunks).toString("utf-8");
      if (timedOut) {
        settle({ kind: "timeout", stderr, timeoutMs: config.timeoutMs, elapsedMs });
        return;
      }
      if (code !== 0) {
        settle({ kind: "nonzero_exit", stdout, stderr, exitCode: code ?? -1, elapsedMs });
        return;
      }
      if (stdout.length === 0) {
        settle({ kind: "empty_stdout", stderr, exitCode: 0, elapsedMs });
        return;
      }
      settle({ kind: "ok", stdout, stderr, exitCode: 0, elapsedMs });
    });
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test test/context/credential-tool.test.ts`

Expected: all 6 tests pass. The timeout test takes ~2.2 seconds; others are fast.

- [ ] **Step 6: Commit**

```bash
git add src/context/credential-tool.ts test/context/credential-tool.test.ts test/fixtures/credential-resolver-*.sh
git commit -m "$(cat <<'EOF'
feat(credential-tool): runResolver subprocess invoker (PRI-1605)

Pure subprocess function with SIGTERM → 2s grace → SIGKILL timeout
cascade, 64 KiB stdout cap, 8 KiB stderr cap, and structured
ResolverResult kinds: ok, nonzero_exit, empty_stdout, timeout,
spawn_failed, stdout_overflow, stderr_overflow.

Co-Authored-By: Lirael@36bd0b63 (Opus 4.7)
EOF
)"
```

---

## Task 3: Implement buildFetchCredentialTool wrapper

**Files:**
- Modify: `src/context/credential-tool.ts`
- Modify: `test/context/credential-tool.test.ts`

Adapter-agnostic tool wrapper. Validates args, calls `runResolver`, logs structured events, returns markdown tool results.

> **Ordering note:** Step 3 of this task returns `{ text, transcriptText }` from the tool's success path. The `transcriptText` field is added to the `ToolResult` interface in Task 3.5 below. If you complete steps 1–2 here, then jump to Task 3.5 entirely, then return for steps 3–5, TypeScript stays happy throughout. Reading both tasks before starting is recommended.

- [ ] **Step 1: Write failing tests for buildFetchCredentialTool**

Append to `test/context/credential-tool.test.ts`:

```typescript
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  buildFetchCredentialTool,
  FETCH_CREDENTIAL_TOOL_DESCRIPTION,
} from "../../src/context/credential-tool";

interface RecordedEvent { name: string; payload: Record<string, unknown>; }

function makeLogger(): { events: RecordedEvent[]; logger: { logEvent(name: string, payload: Record<string, unknown>): void } } {
  const events: RecordedEvent[] = [];
  return {
    events,
    logger: { logEvent(name, payload) { events.push({ name, payload }); } },
  };
}

function withPopulatedContextRoot<T>(fn: (root: string) => T): T {
  const tmp = mkdtempSync(join(tmpdir(), "gauntlet-credtool-"));
  writeFileSync(join(tmp, "marker.md"), "anything");
  try { return fn(tmp); } finally { rmSync(tmp, { recursive: true, force: true }); }
}

describe("buildFetchCredentialTool", () => {
  test("returns null when contextRoot is empty (no files)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "gauntlet-credtool-empty-"));
    try {
      const tool = buildFetchCredentialTool(tmp, cfg(OK), null);
      expect(tool).toBeNull();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("returns null when resolverConfig is undefined", () => {
    withPopulatedContextRoot((root) => {
      const tool = buildFetchCredentialTool(root, undefined, null);
      expect(tool).toBeNull();
    });
  });

  test("registers as `fetch_credential` with entity + key string params", () => {
    withPopulatedContextRoot((root) => {
      const tool = buildFetchCredentialTool(root, cfg(OK), null);
      expect(tool).not.toBeNull();
      expect(tool!.definition.name).toBe("fetch_credential");
      const params = tool!.definition.parameters as {
        properties: { entity: { type: string }; key: { type: string } };
        required: string[];
      };
      expect(params.properties.entity.type).toBe("string");
      expect(params.properties.key.type).toBe("string");
      expect(params.required).toEqual(["entity", "key"]);
    });
  });

  test("tool description matches exported constant", () => {
    withPopulatedContextRoot((root) => {
      const tool = buildFetchCredentialTool(root, cfg(OK), null);
      expect(tool!.definition.description).toBe(FETCH_CREDENTIAL_TOOL_DESCRIPTION);
    });
  });

  test("execute success returns resolver stdout verbatim and logs ok event", async () => {
    await withPopulatedContextRoot(async (root) => {
      const { events, logger } = makeLogger();
      const tool = buildFetchCredentialTool(root, cfg(OK), logger)!;
      const result = await tool.execute({ entity: "alice", key: "otp" });
      expect(result.text).toBe("ok-for-alice:otp\n");
      expect(events).toHaveLength(1);
      expect(events[0]?.name).toBe("fetch_credential_ok");
      expect(events[0]?.payload).toMatchObject({
        entity: "alice",
        key: "otp",
        exitCode: 0,
        stdoutLength: "ok-for-alice:otp\n".length,
      });
    });
  });

  test("execute nonzero exit returns error markdown and logs failed event", async () => {
    await withPopulatedContextRoot(async (root) => {
      const { events, logger } = makeLogger();
      const tool = buildFetchCredentialTool(root, cfg(FAIL), logger)!;
      const result = await tool.execute({ entity: "alice", key: "pin" });
      expect(result.text).toMatch(/Error: fetch_credential resolver exited 2 for alice:pin/);
      expect(result.text).toContain("no credential 'pin' for entity 'alice'");
      expect(events[0]?.name).toBe("fetch_credential_failed");
      expect(events[0]?.payload).toMatchObject({
        entity: "alice",
        key: "pin",
        step: "nonzero_exit",
      });
    });
  });

  test("execute rejects entity with path traversal", async () => {
    await withPopulatedContextRoot(async (root) => {
      const { events, logger } = makeLogger();
      const tool = buildFetchCredentialTool(root, cfg(OK), logger)!;
      const result = await tool.execute({ entity: "../escape", key: "otp" });
      expect(result.text).toMatch(/Error: fetch_credential argument "entity" rejected/);
      expect(events[0]?.payload?.step).toBe("validate_args");
    });
  });

  test("execute rejects entity with backslash", async () => {
    await withPopulatedContextRoot(async (root) => {
      const tool = buildFetchCredentialTool(root, cfg(OK), null)!;
      const result = await tool.execute({ entity: "alice\\nope", key: "otp" });
      expect(result.text).toMatch(/Error: fetch_credential argument "entity" rejected/);
    });
  });

  test("execute rejects entity with leading dot", async () => {
    await withPopulatedContextRoot(async (root) => {
      const tool = buildFetchCredentialTool(root, cfg(OK), null)!;
      const result = await tool.execute({ entity: ".hidden", key: "otp" });
      expect(result.text).toMatch(/Error: fetch_credential argument "entity" rejected/);
    });
  });

  test("execute rejects empty entity", async () => {
    await withPopulatedContextRoot(async (root) => {
      const tool = buildFetchCredentialTool(root, cfg(OK), null)!;
      const result = await tool.execute({ entity: "", key: "otp" });
      expect(result.text).toMatch(/Error: fetch_credential argument "entity" rejected/);
    });
  });

  test("execute rejects entity longer than 256 chars", async () => {
    await withPopulatedContextRoot(async (root) => {
      const tool = buildFetchCredentialTool(root, cfg(OK), null)!;
      const result = await tool.execute({ entity: "a".repeat(257), key: "otp" });
      expect(result.text).toMatch(/Error: fetch_credential argument "entity" rejected/);
    });
  });

  test("execute rejects key with disallowed chars (e.g. dot)", async () => {
    await withPopulatedContextRoot(async (root) => {
      const tool = buildFetchCredentialTool(root, cfg(OK), null)!;
      const result = await tool.execute({ entity: "alice", key: "ot.p" });
      expect(result.text).toMatch(/Error: fetch_credential argument "key" rejected/);
    });
  });

  test("execute rejects empty key", async () => {
    await withPopulatedContextRoot(async (root) => {
      const tool = buildFetchCredentialTool(root, cfg(OK), null)!;
      const result = await tool.execute({ entity: "alice", key: "" });
      expect(result.text).toMatch(/Error: fetch_credential argument "key" rejected/);
    });
  });

  test("execute accepts email-shaped entity", async () => {
    await withPopulatedContextRoot(async (root) => {
      const tool = buildFetchCredentialTool(root, cfg(OK), null)!;
      const result = await tool.execute({ entity: "alice@example.com", key: "otp" });
      expect(result.text).toBe("ok-for-alice@example.com:otp\n");
    });
  });

  test("success returns redacted transcriptText by default", async () => {
    await withPopulatedContextRoot(async (root) => {
      const tool = buildFetchCredentialTool(root, cfg(OK), null)!;
      const result = await tool.execute({ entity: "alice", key: "otp" });
      expect(result.text).toBe("ok-for-alice:otp\n");
      // Length matches the stdout returned to the agent.
      expect((result as { transcriptText?: string }).transcriptText).toBe(
        `<credential redacted: entity=alice key=otp len=${"ok-for-alice:otp\n".length}>`,
      );
    });
  });

  test("success omits transcriptText when includeInTranscripts is true", async () => {
    await withPopulatedContextRoot(async (root) => {
      const reveal: CredentialResolverConfig = {
        path: OK,
        timeoutMs: 5_000,
        includeInTranscripts: true,
      };
      const tool = buildFetchCredentialTool(root, reveal, null)!;
      const result = await tool.execute({ entity: "alice", key: "otp" });
      expect(result.text).toBe("ok-for-alice:otp\n");
      expect((result as { transcriptText?: string }).transcriptText).toBeUndefined();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/context/credential-tool.test.ts`

Expected: failures citing missing `buildFetchCredentialTool` / `FETCH_CREDENTIAL_TOOL_DESCRIPTION` exports.

- [ ] **Step 3: Add the wrapper implementation**

Append to `src/context/credential-tool.ts`:

```typescript
import type { ToolDefinition, ToolResult } from "../models/provider";
import type { EvidenceLogger } from "../evidence/logger";
import { contextRootIsPopulated } from "../paths";

export const FETCH_CREDENTIAL_TOOL_DESCRIPTION =
  "Fetch an ephemeral credential (OTP, invite code, magic link, verification code, " +
  "or other single-use or rotating secret) for a given entity. Use this for any " +
  "credential that cannot be written into a static fixture file because it " +
  "rotates, expires, or is single-use. The first argument `entity` is the " +
  "identifier for the user being acted as — typically the username or email, " +
  "whichever the system-under-test recognizes; extract it from the context file " +
  "that describes the user (use the `read` tool to fetch that file first). The " +
  "second argument `key` names which credential is being requested (e.g. \"otp\", " +
  "\"signup_verification\"). The file under .gauntlet/context/ that describes " +
  "the entity declares which `key` values are valid. Returns the credential's " +
  "current value as markdown; on failure returns an error message naming the " +
  "step that failed.";

export interface FetchCredentialTool {
  definition: ToolDefinition;
  execute(args: Record<string, unknown>): Promise<ToolResult>;
}

const ENTITY_FORBIDDEN_PATTERN = /[\/\\]/;
const KEY_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const ENTITY_MAX_LENGTH = 256;

function validateEntity(entity: unknown): { ok: true; value: string } | { ok: false; reason: string } {
  if (typeof entity !== "string" || entity.length === 0) {
    return { ok: false, reason: "must be a non-empty string" };
  }
  if (entity.length > ENTITY_MAX_LENGTH) {
    return { ok: false, reason: `must be ${ENTITY_MAX_LENGTH} characters or fewer` };
  }
  if (entity.startsWith(".")) {
    return { ok: false, reason: "must not start with '.'" };
  }
  if (entity.includes("..")) {
    return { ok: false, reason: "must not contain '..'" };
  }
  if (ENTITY_FORBIDDEN_PATTERN.test(entity)) {
    return { ok: false, reason: "must not contain '/' or '\\\\'" };
  }
  return { ok: true, value: entity };
}

function validateKey(key: unknown): { ok: true; value: string } | { ok: false; reason: string } {
  if (typeof key !== "string" || key.length === 0) {
    return { ok: false, reason: "must be a non-empty string" };
  }
  if (!KEY_PATTERN.test(key)) {
    return { ok: false, reason: "must match /^[a-zA-Z0-9_-]{1,64}$/" };
  }
  return { ok: true, value: key };
}

export function buildFetchCredentialTool(
  contextRoot: string,
  resolverConfig: CredentialResolverConfig | undefined,
  logger: EvidenceLogger | null = null,
): FetchCredentialTool | null {
  if (!resolverConfig) return null;
  if (!contextRootIsPopulated(contextRoot)) return null;

  const definition: ToolDefinition = {
    name: "fetch_credential",
    description: FETCH_CREDENTIAL_TOOL_DESCRIPTION,
    parameters: {
      type: "object",
      properties: {
        entity: {
          type: "string",
          description:
            "Identifier for the user being acted as, extracted from a context file (e.g. 'alice', 'alice@example.com').",
        },
        key: {
          type: "string",
          description:
            "Name of the ephemeral credential requested (e.g. 'otp', 'signup_verification'). The entity's context file lists the valid keys.",
        },
      },
      required: ["entity", "key"],
    },
  };

  const execute = async (args: Record<string, unknown>): Promise<ToolResult> => {
    const entityValidation = validateEntity(args.entity);
    if (!entityValidation.ok) {
      const reason = entityValidation.reason;
      logger?.logEvent("fetch_credential_failed", {
        entity: typeof args.entity === "string" ? args.entity.slice(0, 64) : "",
        key: typeof args.key === "string" ? args.key.slice(0, 64) : "",
        step: "validate_args",
        error: `entity ${reason}`,
      });
      return { text: `Error: fetch_credential argument "entity" rejected: ${reason}.` };
    }
    const keyValidation = validateKey(args.key);
    if (!keyValidation.ok) {
      const reason = keyValidation.reason;
      logger?.logEvent("fetch_credential_failed", {
        entity: entityValidation.value,
        key: typeof args.key === "string" ? args.key.slice(0, 64) : "",
        step: "validate_args",
        error: `key ${reason}`,
      });
      return { text: `Error: fetch_credential argument "key" rejected: ${reason}.` };
    }

    const entity = entityValidation.value;
    const key = keyValidation.value;
    const result = await runResolver(resolverConfig, entity, key);

    switch (result.kind) {
      case "ok":
        logger?.logEvent("fetch_credential_ok", {
          entity, key,
          exitCode: 0,
          stdoutLength: result.stdout.length,
          stderrLength: result.stderr.length,
          elapsedMs: result.elapsedMs,
        });
        // The agent's live context gets the full stdout (it needs to type
        // the value). The transcript (run.jsonl) gets a redacted marker
        // by default; the opt-in env var keeps the raw bytes.
        if (resolverConfig.includeInTranscripts) {
          return { text: result.stdout };
        }
        return {
          text: result.stdout,
          transcriptText: `<credential redacted: entity=${entity} key=${key} len=${result.stdout.length}>`,
        };
      case "nonzero_exit":
        logger?.logEvent("fetch_credential_failed", {
          entity, key, step: "nonzero_exit",
          exitCode: result.exitCode,
          stdoutLength: result.stdout.length,
          stderrLength: result.stderr.length,
          elapsedMs: result.elapsedMs,
        });
        return {
          text: `Error: fetch_credential resolver exited ${result.exitCode} for ${entity}:${key}:\n${result.stderr}`,
        };
      case "empty_stdout":
        logger?.logEvent("fetch_credential_failed", {
          entity, key, step: "empty_stdout",
          stderrLength: result.stderr.length,
          elapsedMs: result.elapsedMs,
        });
        return {
          text: `Error: fetch_credential resolver returned empty success for ${entity}:${key}.`,
        };
      case "timeout":
        logger?.logEvent("fetch_credential_failed", {
          entity, key, step: "timeout",
          timeoutMs: result.timeoutMs,
          stderrLength: result.stderr.length,
          elapsedMs: result.elapsedMs,
        });
        return {
          text: `Error: fetch_credential resolver timed out after ${result.timeoutMs}ms for ${entity}:${key}.`,
        };
      case "stdout_overflow":
        logger?.logEvent("fetch_credential_failed", {
          entity, key, step: "stdout_overflow",
          elapsedMs: result.elapsedMs,
        });
        return {
          text: `Error: fetch_credential resolver stdout exceeded 64 KiB for ${entity}:${key}.`,
        };
      case "stderr_overflow":
        logger?.logEvent("fetch_credential_failed", {
          entity, key, step: "stderr_overflow",
          elapsedMs: result.elapsedMs,
        });
        return {
          text: `Error: fetch_credential resolver stderr exceeded 8 KiB for ${entity}:${key}.`,
        };
      case "spawn_failed":
        logger?.logEvent("fetch_credential_failed", {
          entity, key, step: "spawn",
          error: result.error,
        });
        return {
          text: `Error: fetch_credential resolver failed to spawn: ${result.error}.`,
        };
    }
  };

  return { definition, execute };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/context/credential-tool.test.ts`

Expected: all tests in the file pass (including Task 2's tests).

- [ ] **Step 5: Commit**

```bash
git add src/context/credential-tool.ts test/context/credential-tool.test.ts
git commit -m "$(cat <<'EOF'
feat(credential-tool): buildFetchCredentialTool wrapper (PRI-1605)

Adapter-agnostic tool builder. Returns null when contextRoot is empty
or resolverConfig is undefined. Validates entity (no /, \\, .., leading
.; <= 256 chars) and key (^[a-zA-Z0-9_-]{1,64}$) before invoking the
resolver. Maps ResolverResult kinds to agent-readable error markdown
with step labels in fetch_credential_failed log events, matching the
install_passkey/install_cookies convention. Success path emits a
redacted transcriptText on the ToolResult by default; raw stdout
stays in `text` for the agent's live context.

Co-Authored-By: Lirael@36bd0b63 (Opus 4.7)
EOF
)"
```

---

## Task 3.5: Honor `transcriptText` in EvidenceLogger

**Files:**
- Modify: `src/models/provider.ts` — add `transcriptText?: string` to `ToolResult`.
- Modify: `src/evidence/logger.ts` — add `transcriptText?: string` to `ToolResultFields` and prefer it in `logToolResult`.
- Modify: `src/agent/agent.ts` — pass `transcriptText` from `ToolResult` through to `logToolResult`.
- Modify: `test/evidence/logger.test.ts` — verify the new behavior.

The credential tool returns a `ToolResult` with `text` (live agent value) and `transcriptText` (redacted marker). The evidence logger needs to record `transcriptText` in `tool_result.text` when present, leaving the agent's view of `text` untouched. This is a generic seam — credentials are the first user, but any tool that wants different transcript representation can use it.

- [ ] **Step 1: Write failing test for the logger plumbing**

Add to `test/evidence/logger.test.ts` (inside the `describe("EvidenceLogger", () => {` block, near the existing `logToolResult` tests around line 218):

```typescript
test("logToolResult prefers transcriptText over text when both are set", () => {
  logger.logToolResult({
    turn: 1,
    toolUseId: "tu-1",
    name: "fetch_credential",
    durationMs: 5,
    text: "raw-secret-value",
    transcriptText: "<credential redacted: entity=alice key=otp len=16>",
    error: false,
  });

  const rows = readFileSync(join(outDir, "run.jsonl"), "utf-8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  const row = rows[0];
  expect(row.type).toBe("tool_result");
  expect(row.text).toBe("<credential redacted: entity=alice key=otp len=16>");
  // The recorded row should not leak the raw text anywhere.
  expect(JSON.stringify(row)).not.toContain("raw-secret-value");
});

test("logToolResult uses text as before when transcriptText is absent", () => {
  logger.logToolResult({
    turn: 1,
    toolUseId: "tu-1",
    name: "read",
    durationMs: 5,
    text: "ordinary tool output",
    error: false,
  });
  const rows = readFileSync(join(outDir, "run.jsonl"), "utf-8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  expect(rows[0].text).toBe("ordinary tool output");
});
```

- [ ] **Step 2: Run logger tests to verify the new ones fail**

Run: `bun test test/evidence/logger.test.ts`

Expected: the first new test fails (no `transcriptText` field exists yet; logger writes raw `text`). The second test passes already (matches current behavior). TypeScript may also reject `transcriptText` on `ToolResultFields` — that's the same root cause.

- [ ] **Step 3: Add `transcriptText` to `ToolResult`**

In `src/models/provider.ts`, the existing `ToolResult` interface (around line 15) becomes:

```typescript
export interface ToolResult {
  text: string;
  /**
   * Optional alternative representation used for the run transcript /
   * evidence log. When set, `text` still goes to the agent's live
   * context (the agent must see the real value to type or paste it),
   * but `tool_result.text` in run.jsonl uses this string instead.
   * Use when the agent-visible value contains a secret that should
   * not land in the transcript by default. PRI-1605.
   */
  transcriptText?: string;
  image?: {
    data: string;
    mediaType: string;
  };
  imagePath?: string;
  artifactPath?: string;
  capturePath?: string;
}
```

- [ ] **Step 4: Add `transcriptText` to `ToolResultFields` and update `logToolResult`**

In `src/evidence/logger.ts`:

Update `ToolResultFields` (around line 73):

```typescript
export interface ToolResultFields {
  turn: number;
  toolUseId: string;
  name: string;
  durationMs: number;
  text: string;
  /**
   * Optional override for the recorded `text` field. When set,
   * tool_result.text in run.jsonl is this string instead of the raw
   * `text`. The original `text` is dropped from the row. Used for
   * transcript redaction (PRI-1605). Never written to disk under its
   * own key.
   */
  transcriptText?: string;
  image?: string;
  mediaType?: string;
  artifact?: string;
  capturePath?: string;
  textTruncated?: true;
  textBytes?: number;
  error: boolean;
}
```

Replace the entire body of `logToolResult` (currently lines ~225–266) with this rewritten version. The change is: destructure `transcriptText` off the input at the top, substitute it for `text` when present, and operate on the normalized object through the rest of the method. Every existing reference to `fields` becomes `normalized`.

```typescript
logToolResult(fields: ToolResultFields): void {
  // Transcript redaction (PRI-1605): tools may supply transcriptText to
  // record a different value in run.jsonl than the agent saw. Strip
  // transcriptText so it never appears as its own field in the row, and
  // substitute it for `text` when present. All downstream branches
  // operate on the normalized fields.
  const { transcriptText, ...rest } = fields;
  const normalized: Omit<ToolResultFields, "transcriptText"> =
    transcriptText !== undefined ? { ...rest, text: transcriptText } : rest;

  // TUI captures: the adapter has already written captures/NNN.ansi
  // and populated `capturePath`. Replace the inline text with the path
  // so run.jsonl stays lean. Consumers (UI, replay) fetch the file.
  // The LLM, which receives the in-memory ToolResult.text, is unaffected.
  if (normalized.capturePath) {
    const body: Record<string, unknown> = {
      ...normalized,
      text: normalized.capturePath,
    };
    this.writeEvent("tool_result", body);
    return;
  }

  let body: Record<string, unknown> = { ...normalized };
  if (typeof normalized.text === "string" && Buffer.byteLength(normalized.text, "utf8") > INLINE_TEXT_LIMIT) {
    const bytes = Buffer.byteLength(normalized.text, "utf8");
    const spilled = this.saveArtifact(normalized.text, "txt");
    body = {
      ...body,
      text: "",
      textTruncated: true,
      textBytes: bytes,
      artifact: normalized.artifact ?? spilled,
    };
    this.writeEvent("tool_result", body);
    this.logEvent("tool_result_text_oversize", {
      turn: normalized.turn,
      toolName: normalized.name,
      bytes,
      artifact: spilled,
    });
    return;
  }
  this.writeEvent("tool_result", body);
}
```

- [ ] **Step 5: Pass `transcriptText` through in agent.ts**

In `src/agent/agent.ts`, the `logger.logToolResult({...})` call around line 390. Add `transcriptText: result.transcriptText` to the object literal:

```typescript
logger.logToolResult({
  turn: turns,
  toolUseId: tc.id,
  name: tc.name,
  durationMs: Date.now() - started,
  text: result.text ?? "",
  transcriptText: result.transcriptText,
  image: (result as any).imagePath,
  mediaType: (result as any).image?.mediaType,
  artifact: (result as any).artifactPath,
  capturePath: (result as any).capturePath,
  error: errored,
});
```

- [ ] **Step 6: Run logger tests to verify they pass**

Run: `bun test test/evidence/logger.test.ts`

Expected: all tests pass, including the two new ones.

- [ ] **Step 7: Run the full suite to catch regressions**

Run: `bun test`

Expected: all previously-passing tests still pass.

- [ ] **Step 8: Commit**

```bash
git add src/models/provider.ts src/evidence/logger.ts src/agent/agent.ts test/evidence/logger.test.ts
git commit -m "$(cat <<'EOF'
feat(logger): honor optional transcriptText on tool results (PRI-1605)

ToolResult and ToolResultFields gain an optional transcriptText. When
set, logToolResult writes that string into tool_result.text in
run.jsonl instead of the raw text, and drops transcriptText itself
from the row. The agent's live context is untouched — only the
recorded transcript is affected. fetch_credential uses this to redact
secrets by default; the same seam is available to any future tool
that wants a transcript-specific representation.

Co-Authored-By: Lirael@36bd0b63 (Opus 4.7)
EOF
)"
```

---

## Task 4: Wire fetch_credential into WebAdapter

**Files:**
- Modify: `src/adapters/web/adapter.ts`
- Modify: `test/adapters/web/adapter.test.ts`

Add `credentialResolver` to `WebAdapterOptions`. Construct the tool conditionally. Dispatch in `executeTool`.

- [ ] **Step 1: Write failing test for tool registration**

Find the existing `install_cookies` or `read` registration test in `test/adapters/web/adapter.test.ts`. Add new test right after, with the same pattern:

```typescript
test("registers fetch_credential when contextRoot has files and credentialResolver is set", () => {
  const { mkdtempSync, writeFileSync, chmodSync, rmSync } = require("fs");
  const { tmpdir } = require("os");
  const { join } = require("path");
  const ctxTmp = mkdtempSync(join(tmpdir(), "gauntlet-web-cred-ctx-"));
  const resTmp = mkdtempSync(join(tmpdir(), "gauntlet-web-cred-res-"));
  try {
    writeFileSync(join(ctxTmp, "alice.md"), "anything");
    const resolverPath = join(resTmp, "r.sh");
    writeFileSync(resolverPath, "#!/bin/sh\necho ok\n");
    chmodSync(resolverPath, 0o755);
    const adapter = new WebAdapter({
      contextRoot: ctxTmp,
      credentialResolver: { path: resolverPath, timeoutMs: 1000, includeInTranscripts: false },
    });
    const tools = adapter.toolDefinitions();
    const names = tools.map((t) => t.name);
    expect(names).toContain("fetch_credential");
  } finally {
    rmSync(ctxTmp, { recursive: true, force: true });
    rmSync(resTmp, { recursive: true, force: true });
  }
});

test("omits fetch_credential when credentialResolver is undefined", () => {
  const { mkdtempSync, writeFileSync, rmSync } = require("fs");
  const { tmpdir } = require("os");
  const { join } = require("path");
  const ctxTmp = mkdtempSync(join(tmpdir(), "gauntlet-web-cred-ctx-"));
  try {
    writeFileSync(join(ctxTmp, "alice.md"), "anything");
    const adapter = new WebAdapter({ contextRoot: ctxTmp });
    const tools = adapter.toolDefinitions();
    const names = tools.map((t) => t.name);
    expect(names).not.toContain("fetch_credential");
  } finally {
    rmSync(ctxTmp, { recursive: true, force: true });
  }
});

test("omits fetch_credential when contextRoot is empty even if resolver is set", () => {
  const { mkdtempSync, writeFileSync, chmodSync, rmSync } = require("fs");
  const { tmpdir } = require("os");
  const { join } = require("path");
  const ctxTmp = mkdtempSync(join(tmpdir(), "gauntlet-web-cred-ctx-empty-"));
  const resTmp = mkdtempSync(join(tmpdir(), "gauntlet-web-cred-res-"));
  try {
    const resolverPath = join(resTmp, "r.sh");
    writeFileSync(resolverPath, "#!/bin/sh\necho ok\n");
    chmodSync(resolverPath, 0o755);
    const adapter = new WebAdapter({
      contextRoot: ctxTmp,
      credentialResolver: { path: resolverPath, timeoutMs: 1000, includeInTranscripts: false },
    });
    const tools = adapter.toolDefinitions();
    const names = tools.map((t) => t.name);
    expect(names).not.toContain("fetch_credential");
  } finally {
    rmSync(ctxTmp, { recursive: true, force: true });
    rmSync(resTmp, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/adapters/web/adapter.test.ts`

Expected: 3 failures citing `credentialResolver` option not recognized, or `fetch_credential` not in tools list.

- [ ] **Step 3: Add `credentialResolver` to `WebAdapterOptions`**

In `src/adapters/web/adapter.ts`, find the `WebAdapterOptions` interface (line 97). After `chromeSession?: ChromeSession;`, add:

```typescript
  /**
   * Caller-provided credential resolver. When set together with
   * contextRoot, the WebAdapter registers fetch_credential. PRI-1605.
   */
  credentialResolver?: CredentialCredentialResolverConfig;
```

At the top of the file, add the import for the config type:

```typescript
import type { CredentialCredentialResolverConfig } from "../../config";
```

(Add it near the other type imports.)

- [ ] **Step 4: Construct the tool in the WebAdapter constructor**

In `src/adapters/web/adapter.ts`, find the constructor (line 212). At the top of the file, add the import:

```typescript
import { buildFetchCredentialTool, type FetchCredentialTool } from "../../context/credential-tool";
```

Add a private field on the class near `private cookiesTool: CookiesTool | null;`:

```typescript
  private credentialTool: FetchCredentialTool | null;
```

In the constructor body, immediately after the `cookiesTool` initialization (line 252), add:

```typescript
    this.credentialTool = buildFetchCredentialTool(
      options?.contextRoot ?? "",
      options?.credentialResolver,
      this.logger,
    );
```

- [ ] **Step 5: Splice the tool into `toolDefinitions`**

Find `toolDefinitions()` in `src/adapters/web/adapter.ts`. It currently appends `readTool`, `passkeyTool`, `cookiesTool` conditionally. Add a similar conditional append for `credentialTool` (after the cookies append):

```typescript
    if (this.credentialTool) tools.push(this.credentialTool.definition);
```

(Match the exact style of the surrounding code — if it uses spread, mimic that.)

- [ ] **Step 6: Dispatch in `executeTool`**

Find `executeTool` in `src/adapters/web/adapter.ts` (around line 911). The current code handles `install_passkey` and `install_cookies`. Add a parallel branch:

```typescript
    if (name === "fetch_credential" && this.credentialTool) {
      return this.credentialTool.execute(args);
    }
```

Place it next to the existing install branches.

- [ ] **Step 7: Run tests to verify they pass**

Run: `bun test test/adapters/web/adapter.test.ts`

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/adapters/web/adapter.ts test/adapters/web/adapter.test.ts
git commit -m "$(cat <<'EOF'
feat(web-adapter): register fetch_credential when configured (PRI-1605)

WebAdapterOptions gains credentialResolver. Tool registers only when
both contextRoot is populated and credentialResolver is set, matching
the existing read/install_passkey/install_cookies gating pattern.

Co-Authored-By: Lirael@36bd0b63 (Opus 4.7)
EOF
)"
```

---

## Task 5: Wire fetch_credential into CLIAdapter

**Files:**
- Modify: `src/adapters/cli/adapter.ts`
- Modify: `test/adapters/cli/adapter.test.ts`

Same shape as Task 4. CLI adapter is much smaller; fewer lines to touch.

- [ ] **Step 1: Write failing tests**

In `test/adapters/cli/adapter.test.ts`, add the same three tests from Task 4 Step 1, but constructing `new CLIAdapter({...})` instead of `new WebAdapter({...})`. Drop the chrome/observer/viewport-related setup; CLI adapter doesn't need any of it.

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/adapters/cli/adapter.test.ts`

Expected: 2 failures.

- [ ] **Step 3: Modify `src/adapters/cli/adapter.ts`**

Add imports at the top:

```typescript
import { buildFetchCredentialTool, type FetchCredentialTool } from "../../context/credential-tool";
import type { CredentialCredentialResolverConfig } from "../../config";
```

Add to `CLIAdapterOptions`:

```typescript
  credentialResolver?: CredentialCredentialResolverConfig;
```

Add a private field next to `readTool`:

```typescript
  private credentialTool: FetchCredentialTool | null;
```

In the constructor, after the `readTool` assignment, add:

```typescript
    this.credentialTool = buildFetchCredentialTool(
      options?.contextRoot ?? "",
      options?.credentialResolver,
      null, // CLI adapter does not currently take a logger — match readTool's pattern.
    );
```

Find `toolDefinitions()` and add the conditional append matching how `readTool` is handled. Same for `executeTool`:

```typescript
    if (name === "fetch_credential" && this.credentialTool) {
      return this.credentialTool.execute(args);
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/adapters/cli/adapter.test.ts`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/cli/adapter.ts test/adapters/cli/adapter.test.ts
git commit -m "feat(cli-adapter): register fetch_credential when configured (PRI-1605)

Co-Authored-By: Lirael@36bd0b63 (Opus 4.7)"
```

---

## Task 6: Wire fetch_credential into TUIAdapter

**Files:**
- Modify: `src/adapters/tui/adapter.ts`
- Modify: `test/adapters/tui/adapter.test.ts`

Same shape as Task 5. Identical pattern.

- [ ] **Step 1: Write failing tests**

In `test/adapters/tui/adapter.test.ts`, copy the two tests from Task 5 but use `new TUIAdapter({...})`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test test/adapters/tui/adapter.test.ts`

Expected: 2 failures.

- [ ] **Step 3: Modify `src/adapters/tui/adapter.ts`**

Apply the same changes as Task 5 Step 3, but to the TUI adapter.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/adapters/tui/adapter.test.ts`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/tui/adapter.ts test/adapters/tui/adapter.test.ts
git commit -m "feat(tui-adapter): register fetch_credential when configured (PRI-1605)

Co-Authored-By: Lirael@36bd0b63 (Opus 4.7)"
```

---

## Task 7: Thread credentialResolver from EffectiveRunConfig to adapters

**Files:**
- Modify: `src/runs/orchestrator.ts`
- Test: covered by adapters' tests (already passing) + smoke via `bun test`

The orchestrator already accepts `runConfig: EffectiveRunConfig` (which has `credentialResolver` after Task 1). It calls `buildDefaultAdapter(type, contextRoot, logger, runId, chrome, viewport)`. Add a parameter and thread it through.

- [ ] **Step 1: Update `buildDefaultAdapter` signature**

In `src/runs/orchestrator.ts`, modify `buildDefaultAdapter` (line 140) to accept `credentialResolver`:

```typescript
async function buildDefaultAdapter(
  type: RunAdapterType,
  contextRoot: string,
  logger: EvidenceLogger,
  runId: string,
  chrome: ChromeEndpoint | undefined,
  viewport: Viewport | undefined,
  credentialResolver: CredentialCredentialResolverConfig | undefined,
): Promise<Adapter> {
  switch (type) {
    case "cli":
      return new CLIAdapter({ contextRoot, credentialResolver });
    case "tui": {
      const { TUIAdapter } = await import("../adapters/tui/adapter");
      return new TUIAdapter({ contextRoot, credentialResolver });
    }
    case "web": {
      const { WebAdapter } = await import("../adapters/web/adapter");
      return new WebAdapter({
        chrome,
        contextRoot,
        logger,
        chromeProfileName: `gauntlet-run-${runId}`,
        viewport,
        credentialResolver,
      });
    }
  }
}
```

Add the import at the top of the file:

```typescript
import type { CredentialCredentialResolverConfig } from "../config";
```

- [ ] **Step 2: Pass `runConfig.credentialResolver` at the call site**

Find every `buildDefaultAdapter(` call in `src/runs/orchestrator.ts`. Add `runConfig.credentialResolver` as the new final argument.

(Use grep to find them: `grep -n "buildDefaultAdapter(" src/runs/orchestrator.ts`. There may be more than one call site; update each.)

- [ ] **Step 3: Run full test suite to catch regressions**

Run: `bun test`

Expected: all previously-passing tests still pass; no new failures.

- [ ] **Step 4: Commit**

```bash
git add src/runs/orchestrator.ts
git commit -m "$(cat <<'EOF'
feat(orchestrator): thread credentialResolver into adapter options (PRI-1605)

buildDefaultAdapter accepts credentialResolver and passes it to
WebAdapter / CLIAdapter / TUIAdapter constructors. Adapter
registration of fetch_credential is now driven end-to-end from
EffectiveRunConfig, which is populated from AppConfig in Task 1.

Co-Authored-By: Lirael@36bd0b63 (Opus 4.7)
EOF
)"
```

---

## Task 8: Document fetch_credential in docs/credentials.md

**Files:**
- Modify: `docs/credentials.md`

Add a fourth section describing the resolver protocol, profile-declaration convention, and secrets handling, matching the existing prose style.

- [ ] **Step 1: Insert the new section**

Open `docs/credentials.md`. After the `install_passkey` section and before `Obtaining the values` (or wherever the section list naturally ends — match house style), add:

````markdown
## `fetch_credential` · runtime caller-provided credential resolver

Some sign-in flows depend on credentials that **cannot live in a
static file** — TOTPs that rotate every thirty seconds, invite codes
that burn on first use, magic links minted on demand. In dev
environments these are typically scraped from an InBucket-style web
inbox; in customer CI / locked-down staging that surface often
doesn't exist.

`fetch_credential` covers this case. When the caller configures
`GAUNTLET_CREDENTIAL_RESOLVER` to the path of an executable, Gauntlet
exposes a new agent tool `fetch_credential(entity, key)`. The agent
calls it; Gauntlet invokes the executable with `<entity> <key>` as
argv; the executable's stdout becomes the tool's markdown result.
When the env var is unset, the tool is invisible and runs behave
exactly as they do today.

### Resolver protocol

```
$ "$GAUNTLET_CREDENTIAL_RESOLVER" <entity> <key>
```

- Two positional argv arguments, no stdin payload.
- stdout: markdown returned to the agent.
- Exit 0 = success; non-zero = failure (stderr surfaced to the agent).
- 10-second default timeout (configurable via
  `GAUNTLET_CREDENTIAL_RESOLVER_TIMEOUT_MS`). On timeout, Gauntlet
  sends SIGTERM, waits 2 seconds, then SIGKILL.
- stdout cap: 64 KiB. stderr cap: 8 KiB. Overflow kills the process
  and is reported to the agent.

### Example resolver

```bash
#!/usr/bin/env bash
# fetch-credential.sh — caller-provided
set -euo pipefail
case "$1:$2" in
  alice:otp)
    oathtool --totp -b "$ALICE_TOTP_SECRET"
    ;;
  alice:signup_verification)
    psql "$TEST_DB" -tAc "SELECT code FROM email_codes WHERE email = 'alice@example.test' ORDER BY id DESC LIMIT 1"
    ;;
  *)
    echo "No credential '$2' known for entity '$1'" >&2
    exit 2
    ;;
esac
```

The resolver's interpretation of `entity` is entirely the caller's
choice — a username, an email, a tenant id, anything that maps
cleanly onto their auth machinery.

### Declaring what's available

The agent doesn't know which `key` values your resolver supports.
The convention is to declare them in the same context file that
describes the entity. For example, in `alice.md`:

```markdown
# Alice

Marketing manager at Acme.

## Credentials
- Username: alice@example.test
- Password: hunter2-test

## Available via fetch_credential
- `otp` — current login OTP (TOTP, 30-second window)
- `signup_verification` — code emailed at account creation
```

Gauntlet does not parse this section. It's there so the agent
reading the file knows which `key` values to ask for. Drift between
declared keys and resolver behavior surfaces as visible runtime
errors, not silent failure.

### Secrets handling

- The resolver's stdout is delivered to the agent's live context
  (the agent needs to type the value).
- The action log records only `entity`, `key`, exit code, stdout
  length, stderr length, elapsed ms — never the bytes.
- Transcripts and exported run artifacts redact the resolver
  stdout by default, leaving a marker like
  `<credential redacted: entity=alice key=otp len=6>`.
- Setting `GAUNTLET_CREDENTIAL_INCLUDE_IN_TRANSCRIPTS=1` keeps the
  raw bytes in transcripts. Intended for local debugging only; do
  not set in shared CI.

### Configuration

| Env var | Default | Purpose |
|---|---|---|
| `GAUNTLET_CREDENTIAL_RESOLVER` | unset | Path to caller-provided executable. Relative paths resolve against `projectRoot`. When unset, the tool is not registered. |
| `GAUNTLET_CREDENTIAL_RESOLVER_TIMEOUT_MS` | `10000` | Per-invocation timeout (milliseconds). |
| `GAUNTLET_CREDENTIAL_INCLUDE_IN_TRANSCRIPTS` | `0` | Boolean. Set to `1` to keep resolver stdout in transcripts. Off by default. |

Gauntlet validates the resolver path at boot: must exist, be a
regular file, and have at least one execute bit set. A misconfigured
resolver is a clean boot-time error, not a runtime surprise.
````

In the lead-in paragraph at the top of `docs/credentials.md` ("Three paths cover the common cases"), change "Three" to "Four" and add the new bullet:

```markdown
- **`fetch_credential`** — call a caller-provided executable to
  produce an ephemeral credential (OTP, invite code, magic link)
  at the moment the agent needs it. The only path that handles
  values which can't live in a static file.
```

- [ ] **Step 2: Commit**

```bash
git add docs/credentials.md
git commit -m "$(cat <<'EOF'
docs(credentials): fetch_credential section (PRI-1605)

Documents the resolver protocol (argv + stdout + exit code), example
shell resolver, the "Available via fetch_credential" declaration
convention in entity files, secrets handling (lengths in action log,
redacted transcripts by default), and the three env-var knobs.

Co-Authored-By: Lirael@36bd0b63 (Opus 4.7)
EOF
)"
```

---

## Task 9: Full-suite sanity check + merge

**Files:** none — verification + ticket transition.

- [ ] **Step 1: Run the full test suite**

Run: `bun test`

Expected: all tests pass. If anything fails, fix before proceeding.

- [ ] **Step 2: Run typecheck if the project has one**

Run: `bun run typecheck 2>/dev/null || bunx tsc --noEmit`

Expected: clean.

- [ ] **Step 3: Verify the new tool surface end-to-end with a manual smoke**

Create a temporary resolver and a minimal `.gauntlet/context/` tree under `/tmp/credtest`, set `GAUNTLET_CREDENTIAL_RESOLVER=/tmp/credtest/resolver.sh` and `GAUNTLET_PROJECT_ROOT=/tmp/credtest`, and run `bun src/cli/show-prompt.ts` (or whatever the project's "print the agent's tool list" entry point is). Confirm `fetch_credential` appears in the tools list with the expected description. (If no such entry point exists, skip this step — the unit tests cover registration.)

- [ ] **Step 4: Merge feature branch to main**

Per project convention (no PRs; merge to main with `--no-ff`):

```bash
git checkout main
git merge --no-ff matt/pri-1605-fetch-credential-tool
git push origin main
```

Leave the feature branch alone (do not delete it).

- [ ] **Step 5: Move ticket to In Review and write the reflective comment**

Use the Linear MCP tools to move PRI-1605 to **In Review** and add a `save_comment` reflection on the implementation experience — what went smoothly, what was tricky, confidence level, anything a reviewer should watch. Per the linear-ticket-lifecycle skill, the comment is mandatory and must be reflective, not status-report-shaped.
