# Server-Owned Runs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make in-flight runs discoverable and resumable from any browser tab, refresh, or reconnect. Server becomes the source of truth for "what's running right now"; the client treats its local state as a cache that can be rebuilt from the server at any time.

**Architecture:**
- New in-memory `ActiveRunRegistry` on the server tracks `{id, title, target, model, startedAt, lastFrame, progressLog}` for every run currently executing. The run handler registers on entry, unregisters in `finally`, and the registry is also fed by progress/frame events so it always holds a current snapshot.
- `POST /api/run/:id` becomes async: register the run, kick off `runAgent` as a detached task, return `202 {id}` immediately. The HTTP request no longer carries run results — the WebSocket carries a `complete` event, and `result.json` on disk is the durable record.
- New endpoints `GET /api/runs/active` and `GET /api/runs/:id/snapshot` let the client discover and hydrate runs.
- WebSocket upgrades now send a `snapshot` message as the first frame on connect (so reconnects show state immediately), or `gone` if the run isn't in the registry.
- On the client, `/runs/live` becomes `/runs/live/:id` — URL is the source of truth for *which* run. `liveRun` useState in App.tsx is replaced by a `useActiveRuns` hook that polls `/api/runs/active`. The sidebar pill and Runs list both derive from the server.

**Tech Stack:** Bun + Hono (server), React + React Router (client), `bun test` (test runner), TypeScript throughout.

---

## File Structure

**Server:**
- Create: `src/api/active-runs.ts` — `ActiveRunRegistry` class, `ActiveRunInfo` type
- Create: `src/api/routes/active-runs.ts` — `GET /active`, `GET /:id/snapshot`
- Modify: `src/api/routes/run.ts` — register run, detach `runAgent`, return 202
- Modify: `src/api/server.ts` — accept `registry` parameter, mount new route
- Modify: `src/index.ts` — construct registry, pass to `createApp`, send snapshot in WS `open`, unused-variable cleanup

**Client:**
- Modify: `ui/src/lib/api.ts` — add `activeRuns` endpoints and `ActiveRun` type
- Create: `ui/src/hooks/useActiveRuns.ts` — polling hook
- Modify: `ui/src/hooks/useRunStream.ts` — apply `snapshot` / `gone` messages
- Modify: `ui/src/App.tsx` — drop `liveRun` useState, use `useActiveRuns`, change route to `/runs/live/:id`
- Modify: `ui/src/components/LiveRun.tsx` — read `runId` from `useParams`, drop unused props
- Modify: `ui/src/components/RunsList.tsx` — accept and render active runs above completed ones

**Tests:**
- Create: `test/api/active-runs.test.ts` — registry unit tests
- Create: `test/api/active-runs-route.test.ts` — route tests
- Modify: `test/api/run.test.ts` — update for 202 response

---

## Task 1: ActiveRunRegistry (server, pure unit)

**Files:**
- Create: `src/api/active-runs.ts`
- Create: `test/api/active-runs.test.ts`

**Contract:**

```typescript
// src/api/active-runs.ts
export interface ActiveRunInfo {
  id: string;          // = cardId (last-run-wins)
  title: string;
  target: string;
  model: string;
  startedAt: number;   // ms since epoch
}

export interface RunSnapshot {
  info: ActiveRunInfo;
  lastFrame: { data: string; width: number; height: number } | null;
  progressLog: string[];  // ring buffer, most recent last
}

const PROGRESS_LOG_CAP = 200;

export class ActiveRunRegistry {
  private runs = new Map<string, RunSnapshot>();

  register(info: ActiveRunInfo): void { ... }

  unregister(id: string): void { ... }

  recordFrame(id: string, frame: { data: string; width: number; height: number }): void { ... }

  recordProgress(id: string, message: string): void { ... }

  list(): ActiveRunInfo[] { ... }   // sorted by startedAt desc

  getSnapshot(id: string): RunSnapshot | null { ... }

  has(id: string): boolean { ... }
}
```

Notes:
- `register` on an already-registered id overwrites (last-run-wins — the user explicitly confirmed this is correct).
- `recordFrame`/`recordProgress` on an unknown id silently no-op (the run may have just been unregistered).
- `progressLog` is a ring buffer: when length exceeds `PROGRESS_LOG_CAP`, drop oldest.
- No persistence — in-memory only. If the server dies, active runs are gone (consistent with current behavior).

- [ ] **Step 1: Write failing tests**

```typescript
// test/api/active-runs.test.ts
import { describe, test, expect } from "bun:test";
import { ActiveRunRegistry } from "../../src/api/active-runs";

describe("ActiveRunRegistry", () => {
  const info = (id: string, startedAt: number) => ({
    id,
    title: `Title ${id}`,
    target: "http://localhost:3000",
    model: "claude-sonnet-4-6",
    startedAt,
  });

  test("register + list + has", () => {
    const r = new ActiveRunRegistry();
    expect(r.list()).toEqual([]);
    expect(r.has("a")).toBe(false);

    r.register(info("a", 100));
    expect(r.has("a")).toBe(true);
    expect(r.list()).toEqual([info("a", 100)]);
  });

  test("list sorted by startedAt desc", () => {
    const r = new ActiveRunRegistry();
    r.register(info("a", 100));
    r.register(info("b", 300));
    r.register(info("c", 200));
    expect(r.list().map((x) => x.id)).toEqual(["b", "c", "a"]);
  });

  test("register replaces existing entry (last-run-wins)", () => {
    const r = new ActiveRunRegistry();
    r.register(info("a", 100));
    r.recordProgress("a", "old");
    r.register(info("a", 200));
    const snap = r.getSnapshot("a");
    expect(snap?.info.startedAt).toBe(200);
    expect(snap?.progressLog).toEqual([]);
  });

  test("unregister removes the entry", () => {
    const r = new ActiveRunRegistry();
    r.register(info("a", 100));
    r.unregister("a");
    expect(r.has("a")).toBe(false);
    expect(r.getSnapshot("a")).toBeNull();
  });

  test("recordFrame stores latest frame", () => {
    const r = new ActiveRunRegistry();
    r.register(info("a", 100));
    r.recordFrame("a", { data: "AAA", width: 10, height: 20 });
    r.recordFrame("a", { data: "BBB", width: 30, height: 40 });
    expect(r.getSnapshot("a")?.lastFrame).toEqual({ data: "BBB", width: 30, height: 40 });
  });

  test("recordProgress appends, capped at 200", () => {
    const r = new ActiveRunRegistry();
    r.register(info("a", 100));
    for (let i = 0; i < 250; i++) r.recordProgress("a", `msg-${i}`);
    const log = r.getSnapshot("a")!.progressLog;
    expect(log.length).toBe(200);
    expect(log[0]).toBe("msg-50");
    expect(log[199]).toBe("msg-249");
  });

  test("recordFrame/recordProgress on unknown id no-ops", () => {
    const r = new ActiveRunRegistry();
    expect(() => r.recordFrame("nope", { data: "x", width: 1, height: 1 })).not.toThrow();
    expect(() => r.recordProgress("nope", "x")).not.toThrow();
    expect(r.has("nope")).toBe(false);
  });

  test("getSnapshot returns null for unknown id", () => {
    const r = new ActiveRunRegistry();
    expect(r.getSnapshot("nope")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests, confirm failure**

`bun test test/api/active-runs.test.ts` — expect module-not-found.

- [ ] **Step 3: Implement `ActiveRunRegistry`** per the contract above in `src/api/active-runs.ts`.

- [ ] **Step 4: Run tests, confirm all pass.**

- [ ] **Step 5: Commit.**

```
git add src/api/active-runs.ts test/api/active-runs.test.ts
git commit -m "feat: add ActiveRunRegistry for tracking in-flight runs"
```

---

## Task 2: Active-runs HTTP route

**Files:**
- Create: `src/api/routes/active-runs.ts`
- Create: `test/api/active-runs-route.test.ts`

**Contract:**

```typescript
// src/api/routes/active-runs.ts
import { Hono } from "hono";
import type { ActiveRunRegistry } from "../active-runs";

export function activeRunRoutes(registry: ActiveRunRegistry) {
  const router = new Hono();

  router.get("/", (c) => {
    return c.json({ runs: registry.list() });
  });

  router.get("/:id/snapshot", (c) => {
    const snap = registry.getSnapshot(c.req.param("id"));
    if (!snap) return c.json({ error: "not running" }, 404);
    return c.json(snap);
  });

  return router;
}
```

- [ ] **Step 1: Write failing tests**

```typescript
// test/api/active-runs-route.test.ts
import { describe, test, expect } from "bun:test";
import { Hono } from "hono";
import { ActiveRunRegistry } from "../../src/api/active-runs";
import { activeRunRoutes } from "../../src/api/routes/active-runs";

describe("Active Runs API", () => {
  function makeApp() {
    const registry = new ActiveRunRegistry();
    const app = new Hono();
    app.route("/api/runs/active", activeRunRoutes(registry));
    return { app, registry };
  }

  test("GET /api/runs/active returns empty when nothing running", async () => {
    const { app } = makeApp();
    const res = await app.request("/api/runs/active");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ runs: [] });
  });

  test("GET /api/runs/active returns registered runs", async () => {
    const { app, registry } = makeApp();
    registry.register({
      id: "story-001",
      title: "Test",
      target: "http://localhost:3000",
      model: "claude-sonnet-4-6",
      startedAt: 123,
    });
    const res = await app.request("/api/runs/active");
    const body = await res.json();
    expect(body.runs).toHaveLength(1);
    expect(body.runs[0].id).toBe("story-001");
  });

  test("GET /api/runs/active/:id/snapshot returns snapshot", async () => {
    const { app, registry } = makeApp();
    registry.register({
      id: "story-001",
      title: "Test",
      target: "http://localhost:3000",
      model: "claude-sonnet-4-6",
      startedAt: 123,
    });
    registry.recordProgress("story-001", "hello");
    registry.recordFrame("story-001", { data: "AAA", width: 10, height: 20 });

    const res = await app.request("/api/runs/active/story-001/snapshot");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.info.id).toBe("story-001");
    expect(body.lastFrame).toEqual({ data: "AAA", width: 10, height: 20 });
    expect(body.progressLog).toEqual(["hello"]);
  });

  test("GET /api/runs/active/:id/snapshot returns 404 when not running", async () => {
    const { app } = makeApp();
    const res = await app.request("/api/runs/active/nope/snapshot");
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests, confirm failure.** `bun test test/api/active-runs-route.test.ts`

- [ ] **Step 3: Implement the route.**

- [ ] **Step 4: Run tests, confirm pass.**

- [ ] **Step 5: Commit.**

```
git add src/api/routes/active-runs.ts test/api/active-runs-route.test.ts
git commit -m "feat: add GET /api/runs/active and /:id/snapshot endpoints"
```

---

## Task 3: Wire the registry into server.ts and index.ts (no behavior change yet)

This task just threads the new `ActiveRunRegistry` through the plumbing so later tasks can use it. No functional change to runs.

**Files:**
- Modify: `src/api/server.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Update `createApp` signature.**

In `src/api/server.ts`:

```typescript
import { activeRunRoutes } from "./routes/active-runs";
import type { ActiveRunRegistry } from "./active-runs";

export function createApp(
  dataDir: string,
  uiDir?: string,
  broadcaster?: RunBroadcaster,
  registry?: ActiveRunRegistry,
) {
  const app = new Hono();
  const errorLog = new ErrorLog();

  const api = new Hono();
  api.route("/scenarios", scenarioRoutes(dataDir));
  api.route("/results", resultRoutes(join(dataDir, "results")));
  api.route("/fanout", fanoutRoutes(dataDir, undefined, errorLog));
  api.route("/run", runRoutes(dataDir, broadcaster, errorLog, registry));
  api.route("/config", configRoutes());
  api.route("/errors", errorRoutes(errorLog));
  if (registry) api.route("/runs/active", activeRunRoutes(registry));

  app.route("/api", api);
  // ... rest unchanged
}
```

Note: `runRoutes` gains a 4th optional argument `registry` — will be used in Task 4.

- [ ] **Step 2: Update `src/index.ts` to construct and pass the registry.**

In the `serve` case:

```typescript
const { ActiveRunRegistry } = await import("./api/active-runs");
// ...
const broadcaster = new RunBroadcaster();
const registry = new ActiveRunRegistry();
const app = createApp(dataDir, uiDir, broadcaster, registry);
```

- [ ] **Step 3: Run full test suite.** `bun test` — nothing should break (registry is plumbed but not yet used by `runRoutes`).

- [ ] **Step 4: Commit.**

```
git add src/api/server.ts src/index.ts
git commit -m "chore: thread ActiveRunRegistry through server wiring"
```

---

## Task 4: Make the run handler register + detach + return 202

This is the behavior-changing server task. Accept the same request body as today, but:
1. Register the run with the registry *before* starting the adapter.
2. Kick off the rest of the work (adapter start, screencast, `runAgent`, result write, broadcast complete) as a detached task.
3. Return `202 {id}` to the client immediately.
4. Ensure `unregister` and `adapter.close()` run in `finally` no matter what.
5. On progress/frame events, also feed the registry so its snapshot stays current.

**Files:**
- Modify: `src/api/routes/run.ts`
- Modify: `test/api/run.test.ts`

- [ ] **Step 1: Update `test/api/run.test.ts` to expect 202 for the success path.**

The existing tests assert 404 (unknown scenario) and 400 (missing target / missing model). Those stay the same — the failure paths still happen synchronously, *before* detach. Add one new test that asserts the success path returns 202 quickly and registers the run. To avoid actually hitting an LLM, stub `GAUNTLET_AGENT_MODEL` to something that will make `createClient` throw — then confirm the 202 happens *before* the failure is visible (or, better, that the registry has the entry).

Easiest: inject a stub client via env. The cleanest approach is to have the test pass an explicit `registry` and check that after `POST /api/run/:id`, `registry.has(id)` is true within a short window.

```typescript
test("POST /api/run/:id returns 202 and registers the run", async () => {
  process.env.GAUNTLET_AGENT_MODEL = "claude-sonnet-4-6";
  const registry = new ActiveRunRegistry();
  const broadcaster = new RunBroadcaster();
  const app = new Hono();
  app.route("/api/run", runRoutes(dataDir, broadcaster, undefined, registry));

  // This will fail downstream (no real Chrome) but should still return 202
  // because start is detached. We only assert the acknowledgement + registration.
  const res = await app.request("/api/run/story-001", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target: "http://localhost:3000", adapter: "cli" }),
  });
  expect(res.status).toBe(202);
  const body = await res.json();
  expect(body.id).toBe("story-001");
  // Registered synchronously before detach
  expect(registry.has("story-001")).toBe(true);
});
```

Use `adapter: "cli"` in the request body — the CLI adapter doesn't touch Chrome, so the detached work should fail fast (or complete trivially) without flakiness. If the CLI adapter happens to succeed in some path, that's fine — we're only asserting the acknowledgement.

After test, sleep briefly (`await new Promise(r => setTimeout(r, 50))`) before `afterEach` cleans up so we don't rm the data dir while the detached task is still writing. Alternatively `try { await registry... } finally { unregister }`.

- [ ] **Step 2: Run the updated test, confirm failure.** (Current handler awaits the whole run, so it won't return 202.)

- [ ] **Step 3: Rewrite `run.ts` to register + detach.**

Target shape:

```typescript
// src/api/routes/run.ts
import { Hono } from "hono";
import { join } from "path";
import { findCard } from "./helpers";
import { createClient } from "../../models/resolve";
import { EvidenceLogger } from "../../evidence/logger";
import { writeResultFiles } from "../../evidence/writer";
import { runAgent } from "../../agent/agent";
import type { Adapter } from "../../adapters/adapter";
import type { RunBroadcaster } from "../ws";
import type { ActiveRunRegistry } from "../active-runs";
import type { ScreencastStreamer as ScreencastStreamerType } from "../../streaming/screencast";
import type { ErrorLog } from "./errors";
import type { StoryCard } from "../../format/story-card";
import type { LLMClient } from "../../models/provider";

function createAdapter(type: string, chromeEndpoint?: string): Adapter {
  switch (type) {
    case "cli": {
      const { CLIAdapter } = require("../../adapters/cli/adapter");
      return new CLIAdapter();
    }
    case "tui": {
      const { TUIAdapter } = require("../../adapters/tui/adapter");
      return new TUIAdapter();
    }
    case "web": {
      const { WebAdapter } = require("../../adapters/web/adapter");
      return new WebAdapter({ chrome: chromeEndpoint });
    }
    default:
      throw new Error(`Unknown adapter type: ${type}`);
  }
}

export function runRoutes(
  dataDir: string,
  broadcaster?: RunBroadcaster,
  errorLog?: ErrorLog,
  registry?: ActiveRunRegistry,
) {
  const router = new Hono();
  const storiesDir = join(dataDir, "stories");

  router.post("/:id", async (c) => {
    const entry = findCard(storiesDir, c.req.param("id"));
    if (!entry) return c.json({ error: "not found" }, 404);

    const body = await c.req.json().catch(() => ({}));
    const target = body.target as string | undefined;
    if (!target) return c.json({ error: "target is required" }, 400);

    const adapterType = (body.adapter as string) || "web";
    const model = (body.model as string) || process.env.GAUNTLET_AGENT_MODEL;
    if (!model) {
      return c.json({ error: "no model configured (set GAUNTLET_AGENT_MODEL or pass model in body)" }, 400);
    }

    const client = createClient(model);
    const adapter = createAdapter(adapterType, body.chrome);
    const outDir = join(dataDir, "results", entry.card.id);

    if (registry) {
      registry.register({
        id: entry.card.id,
        title: entry.card.title,
        target,
        model,
        startedAt: Date.now(),
      });
    }

    // Detach: run the agent in the background. The HTTP request returns now.
    executeRun({
      card: entry.card,
      adapter,
      adapterType,
      client,
      target,
      outDir,
      broadcaster,
      registry,
      errorLog,
    }).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      errorLog?.add("run", `${entry.card.id}: ${message}`);
    });

    return c.json({ id: entry.card.id }, 202);
  });

  return router;
}

interface ExecuteRunOpts {
  card: StoryCard;
  adapter: Adapter;
  adapterType: string;
  client: LLMClient;
  target: string;
  outDir: string;
  broadcaster?: RunBroadcaster;
  registry?: ActiveRunRegistry;
  errorLog?: ErrorLog;
}

async function executeRun(opts: ExecuteRunOpts): Promise<void> {
  const { card, adapter, adapterType, client, target, outDir, broadcaster, registry, errorLog } = opts;
  const logger = new EvidenceLogger(outDir);

  if (broadcaster || registry) {
    logger.onAction = (action, params) => {
      const message = `[${action}] ${JSON.stringify(params)}`;
      broadcaster?.send(card.id, {
        type: "progress",
        message,
        status: "running",
        card: card.id,
      });
      registry?.recordProgress(card.id, message);
    };
  }

  let streamer: ScreencastStreamerType | undefined;
  try {
    await adapter.start(target);

    if (adapterType === "web" && (broadcaster || registry)) {
      const { ScreencastStreamer } = await import("../../streaming/screencast");
      const framesDir = join(outDir, "frames");
      streamer = new ScreencastStreamer(0, (frame) => {
        broadcaster?.send(card.id, {
          type: "frame",
          data: frame.data,
          width: frame.metadata.width,
          height: frame.metadata.height,
        });
        registry?.recordFrame(card.id, {
          data: frame.data,
          width: frame.metadata.width,
          height: frame.metadata.height,
        });
      }, framesDir);
      await streamer.start();
    }

    const result = await runAgent(card, adapter, client, logger, target);
    writeResultFiles(outDir, result);

    broadcaster?.send(card.id, { type: "complete", result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errorLog?.add("run", `${card.id}: ${message}`);
    broadcaster?.send(card.id, { type: "error", message });
  } finally {
    if (streamer) await streamer.stop();
    try { await adapter.close(); } catch { /* ignore */ }
    registry?.unregister(card.id);
  }
}
```

Key semantic changes:
- Success response is `202 {id}` not `200 <result>`.
- Validation (404/400) still runs synchronously — the client still sees those errors in the fetch response.
- The registry entry is created *before* detach, so the test in Step 1 can observe it the moment the fetch resolves.
- `catch` inside `executeRun` broadcasts a new `{type: "error", message}` so attached WebSocket clients can show the failure. (Client side in Task 9 will handle this.)

- [ ] **Step 4: Run the run-route tests** — `bun test test/api/run.test.ts`.

- [ ] **Step 5: Run the full test suite** — `bun test` — make sure nothing else broke.

- [ ] **Step 6: Commit.**

```
git add src/api/routes/run.ts test/api/run.test.ts
git commit -m "feat: detach run execution, return 202 from POST /api/run/:id"
```

---

## Task 5: WebSocket snapshot on open

**Files:**
- Modify: `src/index.ts`

When a client opens a WebSocket with `?run=X`, look up `registry.getSnapshot(X)`. If present, send a `snapshot` message immediately with the last frame and progress log. If absent, send `gone`.

- [ ] **Step 1: Update the `open` handler in `src/index.ts`.**

```typescript
websocket: {
  open(ws) {
    const runId = (ws.data as any).runId;
    if (!runId) return;
    broadcaster.addClient(runId, ws as any);
    const snap = registry.getSnapshot(runId);
    if (snap) {
      ws.send(JSON.stringify({
        type: "snapshot",
        lastFrame: snap.lastFrame,
        progressLog: snap.progressLog,
      }));
    } else {
      ws.send(JSON.stringify({ type: "gone" }));
    }
  },
  close(ws) {
    const runId = (ws.data as any).runId;
    if (runId) broadcaster.removeClient(runId, ws as any);
  },
  message() {},
},
```

Note: `ws.send` inside `open` runs synchronously in Bun's WS handler — the client's `onmessage` will fire with the snapshot as the first message.

- [ ] **Step 2: Manually smoke-test.**

Start the server (`bun run src/index.ts serve --data-dir ./my-project --port 4400`), open a browser to `/`, and — with a run in progress — open devtools → Network → WS → confirm the first frame received is `{"type":"snapshot",...}`. (This is a manual smoke test; a full automated test of the WS upgrade path would need a real socket harness, which is out of scope for this task.)

- [ ] **Step 3: Commit.**

```
git add src/index.ts
git commit -m "feat: send run snapshot on WebSocket open"
```

---

## Task 6: Client API types + endpoints

**Files:**
- Modify: `ui/src/lib/api.ts`

- [ ] **Step 1: Add types and endpoints.**

Add to `ui/src/lib/api.ts`:

```typescript
export interface ActiveRun {
  id: string;
  title: string;
  target: string;
  model: string;
  startedAt: number;
}

export interface RunSnapshot {
  info: ActiveRun;
  lastFrame: { data: string; width: number; height: number } | null;
  progressLog: string[];
}
```

And inside the `api` object, add a new section:

```typescript
activeRuns: {
  list: () => request<{ runs: ActiveRun[] }>("/runs/active").then((r) => r.runs),
  snapshot: (id: string) => request<RunSnapshot>(`/runs/active/${encodeURIComponent(id)}/snapshot`),
},
```

Also change the `run.start` signature to reflect the new response:

```typescript
run: {
  start: (id: string, body: { target: string; model?: string; adapter?: string; chrome?: string }) =>
    request<{ id: string }>(`/run/${id}`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
},
```

- [ ] **Step 2: Build UI** — `cd ui && bun run build` — confirm TypeScript compiles.

- [ ] **Step 3: Commit.**

```
git add ui/src/lib/api.ts
git commit -m "feat(ui): add activeRuns API client"
```

---

## Task 7: `useActiveRuns` polling hook

**Files:**
- Create: `ui/src/hooks/useActiveRuns.ts`

- [ ] **Step 1: Create the hook.**

```typescript
// ui/src/hooks/useActiveRuns.ts
import { useState, useEffect, useCallback, useRef } from "react";
import { api, type ActiveRun } from "../lib/api";

const POLL_INTERVAL_MS = 3000;

export function useActiveRuns() {
  const [runs, setRuns] = useState<ActiveRun[]>([]);
  const [loaded, setLoaded] = useState(false);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const list = await api.activeRuns.list();
      if (mountedRef.current) {
        setRuns(list);
        setLoaded(true);
      }
    } catch {
      // best-effort; keep last known list
      if (mountedRef.current) setLoaded(true);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    const id = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [refresh]);

  return { runs, loaded, refresh };
}
```

Notes:
- 3-second poll is a deliberate choice: cheap enough to feel responsive, sparse enough not to hammer the server. Tune later if needed.
- `refresh` is exposed so callers (e.g., App after starting a run) can force a refetch without waiting for the next tick.
- `loaded` flag lets the route guard for `/runs/live/:id` distinguish "haven't asked yet" from "confirmed not running" — important for avoiding a flash redirect on initial load.

- [ ] **Step 2: Commit.**

```
git add ui/src/hooks/useActiveRuns.ts
git commit -m "feat(ui): add useActiveRuns polling hook"
```

---

## Task 8: Update `useRunStream` for snapshot/gone/error messages

**Files:**
- Modify: `ui/src/hooks/useRunStream.ts`

- [ ] **Step 1: Extend the message union and handlers.**

```typescript
// ui/src/hooks/useRunStream.ts
import { useState, useEffect, useRef } from "react";
import { api, type VetResult } from "../lib/api";

type RunMessage =
  | { type: "frame"; data: string; width: number; height: number }
  | { type: "progress"; message: string }
  | { type: "complete"; result: VetResult }
  | { type: "error"; message: string }
  | {
      type: "snapshot";
      lastFrame: { data: string; width: number; height: number } | null;
      progressLog: string[];
    }
  | { type: "gone" };

export interface UseRunStreamResult {
  frame: string | null;
  messages: string[];
  result: VetResult | null;
  connected: boolean;
  error: string | null;
  /** True when the server told us the run is no longer active (and we should fall back to the completed result). */
  gone: boolean;
}

export function useRunStream(runId: string | null): UseRunStreamResult {
  const [frame, setFrame] = useState<string | null>(null);
  const [messages, setMessages] = useState<string[]>([]);
  const [result, setResult] = useState<VetResult | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!runId) return;
    // Reset state whenever runId changes so a fresh mount doesn't leak
    // stale data from a previous run.
    setFrame(null);
    setMessages([]);
    setResult(null);
    setError(null);
    setGone(false);

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws?run=${runId}`);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);

    ws.onmessage = (event) => {
      let msg: RunMessage;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      switch (msg.type) {
        case "snapshot":
          if (msg.lastFrame) {
            setFrame(`data:image/jpeg;base64,${msg.lastFrame.data}`);
          }
          setMessages(msg.progressLog);
          break;
        case "frame":
          setFrame(`data:image/jpeg;base64,${msg.data}`);
          break;
        case "progress":
          setMessages((prev) => [...prev, msg.message]);
          break;
        case "complete":
          setResult(msg.result);
          break;
        case "error":
          setError(msg.message);
          break;
        case "gone":
          setGone(true);
          // If the run already finished on disk, fetch the result so the
          // LiveRun screen can transition into RunDetail.
          api.results.get(runId).then(setResult).catch(() => { /* fall through */ });
          break;
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [runId]);

  return { frame, messages, result, connected, error, gone };
}
```

- [ ] **Step 2: Commit.**

```
git add ui/src/hooks/useRunStream.ts
git commit -m "feat(ui): handle snapshot/gone/error messages in useRunStream"
```

---

## Task 9: Rework App.tsx — URL-driven live runs

**Files:**
- Modify: `ui/src/App.tsx`
- Modify: `ui/src/components/LiveRun.tsx`

This is the client-side centerpiece. The `liveRun` useState and `liveRunError` useState go away. `useActiveRuns` replaces them. The live-run route becomes `/runs/live/:id` so a direct URL carries everything needed.

- [ ] **Step 1: Update `LiveRun.tsx` to read its id from the URL.**

```typescript
// ui/src/components/LiveRun.tsx
import { useRunStream } from "../hooks/useRunStream";
import { useEffect, useRef } from "react";
import { useParams, useNavigate, Navigate } from "react-router-dom";
import { type ActiveRun } from "../lib/api";
import { Spinner } from "./shared";

interface LiveRunProps {
  activeRuns: ActiveRun[];
  /** True once we've heard back from GET /api/runs/active at least once. */
  activeRunsLoaded: boolean;
  onComplete: (id: string) => void;
}

export function LiveRun({ activeRuns, activeRunsLoaded, onComplete }: LiveRunProps) {
  const { id: runId } = useParams();
  const navigate = useNavigate();
  const { frame, messages, result, connected, error, gone } = useRunStream(runId ?? null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (result && runId) onComplete(runId);
  }, [result, runId, onComplete]);

  if (!runId) return <Navigate to="/runs" replace />;

  // If we know the active-runs list has loaded and this id isn't there
  // *and* the server said `gone` without a result, fall through to the
  // finished-run detail page.
  const active = activeRuns.find((r) => r.id === runId);
  const title = active?.title ?? runId;

  if (activeRunsLoaded && !active && gone && !result) {
    // Run isn't active and we couldn't load a result — bounce home.
    return <Navigate to={`/runs/${runId}`} replace />;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b border-edge bg-white">
        <div>
          <h2 className="heading-display text-lg">{title}</h2>
          <span className={`text-xs ${connected ? "text-teal" : "text-slate"}`}>
            {connected ? "Connected" : "Connecting..."}
          </span>
        </div>
        {result && (
          <span className={`text-sm px-2 py-1 rounded ${
            result.status === "pass" ? "bg-green-100 text-green-800" :
            result.status === "fail" ? "bg-red-100 text-red-800" :
            "bg-yellow-100 text-yellow-800"
          }`}>
            {result.status}
          </span>
        )}
      </div>

      {error && (
        <div className="mx-4 mt-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
          <h3 className="text-sm font-medium text-red-800">Run error</h3>
          <p className="text-sm text-red-700 mt-1">{error}</p>
          <button
            className="btn-secondary mt-3"
            onClick={() => navigate("/runs")}
          >
            Back to Runs
          </button>
        </div>
      )}

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 bg-ink flex items-center justify-center p-2 min-h-0">
          {frame ? (
            <img src={frame} alt="Browser view" className="max-w-full max-h-full object-contain rounded" />
          ) : activeRunsLoaded && !active ? (
            <div className="text-slate text-sm">Run not found</div>
          ) : (
            <Spinner label="Waiting for browser..." />
          )}
        </div>

        <div
          ref={logRef}
          className="h-48 flex-shrink-0 overflow-y-auto border-t border-edge bg-white p-3 font-mono text-xs"
        >
          {messages.length === 0 && <div className="text-slate">Waiting for output...</div>}
          {messages.map((msg, i) => (
            <div key={i} className="text-ink-light whitespace-pre-wrap">{msg}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Rework `App.tsx`.**

Delete the `liveRun` / `liveRunError` useState. Replace with `useActiveRuns`. Route becomes `/runs/live/:id`. `New Run` flow: call `api.run.start` → on success (`{id}`), `refresh()` the active-runs list, then `navigate('/runs/live/:id')`. Sidebar pill derives from `activeRuns[0]` (first = most recent, by Task 1 sort).

Replace the entire `App` function (keep helper components above as-is):

```typescript
export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const activeTab = location.pathname.startsWith("/runs") ? "/runs" : "/cards";
  const { cards, loading, error, refresh: refreshCards } = useCards();
  const { results, loading: runsLoading, error: runsError, refresh: refreshResults } = useResults();
  const { runs: activeRuns, loaded: activeRunsLoaded, refresh: refreshActive } = useActiveRuns();
  const [showRunModal, setShowRunModal] = useState(false);

  const cardIdMatch = location.pathname.match(/^\/cards\/(?!new$)(.+)/);
  const selectedCardId = cardIdMatch?.[1];

  // /runs/:id (but not /runs/live or /runs/live/:id)
  const runIdMatch = location.pathname.match(/^\/runs\/(?!live(?:\/|$))(.+)/);
  const selectedRunId = runIdMatch?.[1];

  // /runs/live/:id
  const liveIdMatch = location.pathname.match(/^\/runs\/live\/(.+)/);
  const liveRunId = liveIdMatch?.[1];

  // Top of the active-runs list = the freshest in-flight run (registry sorts desc).
  const topActiveRun = activeRuns[0] ?? null;

  function handleFanout() {
    refreshCards();
    refreshResults();
  }

  function handleRunComplete(id: string) {
    refreshActive();
    refreshResults();
    navigate(`/runs/${id}`);
  }

  return (
    <>
      <AppShell
        sidebar={
          <Sidebar
            tabs={TABS}
            activeTab={activeTab}
            onTabChange={(path) => navigate(path)}
            liveRun={topActiveRun ? {
              title: topActiveRun.title,
              onClick: () => navigate(`/runs/live/${topActiveRun.id}`),
            } : null}
            action={activeTab === "/cards" ? (
              <button className="btn-primary w-full" onClick={() => navigate("/cards/new")}>
                New Card
              </button>
            ) : (
              <button className="btn-primary w-full" onClick={() => setShowRunModal(true)}>
                New Run
              </button>
            )}
          >
            {activeTab === "/cards" ? (
              <CardsSidebar
                selectedId={selectedCardId}
                cards={cards}
                loading={loading}
                error={error}
                onRetry={refreshCards}
              />
            ) : (
              <RunsSidebar
                selectedId={selectedRunId ?? liveRunId}
                results={results}
                activeRuns={activeRuns}
                loading={runsLoading}
                error={runsError}
                onRetry={refreshResults}
                onSelectActive={(id) => navigate(`/runs/live/${id}`)}
              />
            )}
          </Sidebar>
        }
      >
        <Routes>
          <Route path="/" element={<Navigate to="/cards" replace />} />
          <Route path="/cards" element={<CardsPage />} />
          <Route path="/cards/new" element={
            <NewCardPage
              onCreated={(id) => { navigate(`/cards/${id}`); refreshCards(); }}
              onCancel={() => navigate("/cards")}
            />
          } />
          <Route path="/cards/:id" element={<CardDetailPage onRefreshList={refreshCards} />} />
          <Route path="/runs" element={<RunsPage />} />
          <Route path="/runs/live" element={
            topActiveRun
              ? <Navigate to={`/runs/live/${topActiveRun.id}`} replace />
              : <Navigate to="/runs" replace />
          } />
          <Route path="/runs/live/:id" element={
            <LiveRun
              activeRuns={activeRuns}
              activeRunsLoaded={activeRunsLoaded}
              onComplete={handleRunComplete}
            />
          } />
          <Route path="/runs/:id" element={<RunDetailPage onFanout={handleFanout} />} />
        </Routes>
      </AppShell>

      {showRunModal && (
        <NewRunModal
          onClose={() => setShowRunModal(false)}
          onStarted={async (scenarioId, config) => {
            setShowRunModal(false);
            try {
              const { id } = await api.run.start(scenarioId, config);
              await refreshActive();
              navigate(`/runs/live/${id}`);
            } catch (e) {
              // Start failed synchronously — surface error via refresh so
              // any server-side error gets logged, then bounce to Runs tab.
              refreshResults();
              navigate("/runs");
              // TODO: a toast would be nicer than an alert, but not in scope
              // for this task.
              alert(e instanceof Error ? e.message : "Run failed to start");
            }
          }}
        />
      )}
    </>
  );
}
```

Import cleanups: remove the now-unused `liveRun`/`liveRunError` references. Add `import { useActiveRuns } from "./hooks/useActiveRuns";`.

Note the `RunsSidebar` now receives two additional props (`activeRuns`, `onSelectActive`). Task 10 updates the sidebar body and `RunsList` to render them.

- [ ] **Step 3: Build UI, fix type errors.** `cd ui && bun run build`

- [ ] **Step 4: Commit.**

```
git add ui/src/App.tsx ui/src/components/LiveRun.tsx
git commit -m "feat(ui): URL-driven live runs, App consumes useActiveRuns"
```

---

## Task 10: Show active runs in the Runs sidebar

**Files:**
- Modify: `ui/src/components/RunsList.tsx`
- Modify: `ui/src/App.tsx` (the `RunsSidebar` helper — if it wasn't already updated in Task 9's handoff)

Render active runs above the list of completed results, each with a pulsing dot and a distinct visual treatment. Clicking an active run navigates to `/runs/live/:id`.

- [ ] **Step 1: Update `RunsList.tsx`** to accept and render active runs.

```typescript
import type { VetResult, ActiveRun } from "../lib/api";
import { StatusBadge, formatDuration } from "./shared";

interface RunsListProps {
  results: VetResult[];
  activeRuns: ActiveRun[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onSelectActive: (id: string) => void;
}

export function RunsList({ results, activeRuns, selectedId, onSelect, onSelectActive }: RunsListProps) {
  if (results.length === 0 && activeRuns.length === 0) {
    return (
      <div className="p-3 text-sm text-slate">
        No runs yet. Use the <span className="font-medium text-ink">New Run</span> button above to start one.
      </div>
    );
  }

  // Filter completed results that are currently also active — active wins.
  const activeIds = new Set(activeRuns.map((r) => r.id));
  const completed = results.filter((r) => !activeIds.has(r.scenario));

  return (
    <div className="flex flex-col">
      <div className="flex-1 overflow-y-auto">
        {activeRuns.map((run) => (
          <button
            key={`active-${run.id}`}
            onClick={() => onSelectActive(run.id)}
            className={`w-full text-left px-3 py-2.5 border-b border-edge-light transition-colors duration-150 ${
              selectedId === run.id ? "bg-teal-wash" : "hover:bg-panel"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm font-medium text-ink leading-snug truncate">{run.title}</span>
              <span className="relative flex h-2 w-2 mt-1.5 flex-shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-teal" />
              </span>
            </div>
            <div className="mt-0.5 text-xs text-slate">running · {run.id}</div>
          </button>
        ))}
        {completed.map((result) => (
          <button
            key={result.scenario}
            onClick={() => onSelect(result.scenario)}
            className={`w-full text-left px-3 py-2.5 border-b border-edge-light transition-colors duration-150 ${
              selectedId === result.scenario ? "bg-teal-wash" : "hover:bg-panel"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm font-medium text-ink leading-snug">{result.scenario}</span>
              <StatusBadge status={result.status} />
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-slate">
              <span>{formatDuration(result.duration_ms)}</span>
              {result.observations.length > 0 && (
                <span>
                  {result.observations.length} observation{result.observations.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update `RunsSidebar`** in `ui/src/App.tsx` to pass the new props through.

```typescript
function RunsSidebar({
  selectedId,
  results,
  activeRuns,
  loading,
  error,
  onRetry,
  onSelectActive,
}: {
  selectedId?: string;
  results: ReturnType<typeof useResults>["results"];
  activeRuns: ActiveRun[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onSelectActive: (id: string) => void;
}) {
  const navigate = useNavigate();

  if (loading && activeRuns.length === 0) {
    return <div className="p-3"><Spinner label="Loading runs..." /></div>;
  }

  if (error) {
    return (
      <div className="p-3">
        <div className="text-sm text-red-700">{error}</div>
        <button onClick={onRetry} className="mt-2 text-xs text-teal hover:underline">
          Retry
        </button>
      </div>
    );
  }

  return (
    <RunsList
      results={results}
      activeRuns={activeRuns}
      selectedId={selectedId}
      onSelect={(id) => navigate(`/runs/${id}`)}
      onSelectActive={onSelectActive}
    />
  );
}
```

Import `ActiveRun` at the top of `App.tsx`.

- [ ] **Step 3: Build UI, fix type errors.** `cd ui && bun run build`

- [ ] **Step 4: Commit.**

```
git add ui/src/components/RunsList.tsx ui/src/App.tsx
git commit -m "feat(ui): show active runs in Runs sidebar with pulse indicator"
```

---

## Task 11: End-to-end manual verification

- [ ] **Step 1: Start a real server** with a test card and a real target app (the UI's own dev server works fine as a target).

```
ANTHROPIC_API_KEY=sk-... GAUNTLET_AGENT_MODEL=claude-sonnet-4-6 \
  bun run src/index.ts serve --data-dir ./my-project --port 4400
```

- [ ] **Step 2: Start a new run** from the UI. Confirm:
  - Navigation to `/runs/live/<card-id>` happens.
  - LiveRun shows "Connected", frames start arriving.

- [ ] **Step 3: Navigate away to Cards tab** mid-run.
  - Sidebar pill "Running: {title}" is visible on the Cards tab.
  - Clicking the pill returns to `/runs/live/<card-id>`.
  - The LiveRun immediately shows the last frame (snapshot) without waiting for a new frame.

- [ ] **Step 4: Full page refresh** mid-run.
  - Active runs pill reappears after initial load (within the 3s poll window, or sooner).
  - Clicking it restores the live view with the snapshot.

- [ ] **Step 5: Open a second browser tab** mid-run.
  - New tab's Runs sidebar shows the active run with the pulse indicator.
  - Clicking it opens `/runs/live/<card-id>` with snapshot.

- [ ] **Step 6: Wait for the run to complete.**
  - LiveRun transitions to `/runs/<card-id>` automatically.
  - The pill disappears from all tabs (within the poll interval).
  - The completed run appears in the Runs list.

- [ ] **Step 7: If any of the above fails, file it as a follow-up task** and fix before merging.

---

## Final verification

- [ ] Run full test suite: `bun test` — all pass.
- [ ] Run UI build: `cd ui && bun run build` — no type errors.
- [ ] Confirm server starts cleanly: `bun run src/index.ts serve --data-dir /tmp/empty --port 14400` then `curl http://localhost:14400/api/runs/active` → `{"runs":[]}`.
- [ ] Squash-merge into main (or leave as a stack — user's call).
