# PRI-1517 — Navigation-aware `return_screenshot` (CONSIDERED AND REJECTED)

**Status:** rejected, kept as design record
**Date:** 2026-05-06
**Linear:** [PRI-1517](https://linear.app/prime-radiant/issue/PRI-1517)
**Author:** Wash (Bob bc258b31/Opus 4.7)
**Active spec:** see `2026-05-06-pri-1517-design.md`

## Why this was rejected

The design solves the right problem at the right layer — a Gauntlet-only per-target navigation observer that waits for `Page.lifecycleEvent` `load` before issuing `Page.captureScreenshot`. Architecturally clean, no upstream-tracked file modifications, mirrors existing precedent (WebAuthn dedicated socket).

The dealbreaker is **per-action overhead in the no-bug case**. The design adds a 150ms `Page.frameStartedLoading` probe to *every* nav-suspicious action (click, navigate, press, type, fill, doubleClick, rightClick, selectOption) — even when no navigation happens. To fix a transient 30s hang that hit once in the failing run, we'd be paying 150ms × every-such-action × every-run forever.

The smaller fix (action/screenshot decoupling + tightened screenshot CDP timeout for the `return_screenshot` path) captures ~80% of the value for ~5% of the cost. It makes the agent's life better in *every* corner case (truthful action results) rather than only the navigation race. It pays no per-action overhead in the no-bug case.

This design is kept as a record because the thinking is reusable. If the navigation race becomes more frequent — e.g., when more multi-page-app tests land or Gauntlet starts targeting form-heavy apps — pull this off the shelf and revisit.

---


## Problem

A bundled `click(button:contains('Post'), return_screenshot:true)` against a trivial Bun.serve form-post fixture takes exactly 30,003 ms and returns:

```
Error: CDP command timeout: Page.captureScreenshot
```

Repro: `examples/tutorial/.gauntlet/results/tutorial-06-post-and-verify_20260505T233203Z_s2pr/run.jsonl` events 37→38.

Two independent bugs present together:

1. **Navigation race.** `takeReturnScreenshot` issues `Page.captureScreenshot` immediately after `click` returns. The button's submit handler fires synchronously in the renderer, and the form POST → 303 → GET / navigation begins before the screenshot request is processed. Chrome keeps the page target's WebSocket alive (so `ws.isConnected()` is true and the pool reuses it) but silently drops the in-flight `Page.captureScreenshot` request — no response, no error frame. The pooled client's `pendingRequests` entry sits there until the 30,000 ms timer fires (`chrome-ws-lib.js:221-224`). Distinct from PRI-1446's "Connection closed" path: the WS does not close.

2. **Action-result coupling.** `adapter.ts:884-903` chains `...await takeReturnScreenshot()` into the click result. A screenshot timeout becomes the click's tool result text: `Error: CDP command timeout: ...`. The click itself succeeded — the post was created and visible to the agent later — but the agent reads "click failed."

## Goals

- `return_screenshot:true` on a navigating action returns a clean post-navigation screenshot with sub-second latency in the typical case.
- The action's tool result reports the *action's* success/failure independently of the screenshot's success/failure. A screenshot failure degrades to a note in the action text; it never poisons the action result.
- Worst-case wall-time for a click+return_screenshot tool call stays comfortably under any reasonable agent `toolTimeoutMs` (<10s).
- No modifications to upstream-tracked `chrome-ws-lib.js`. All new code lives in Gauntlet-only files.

## Non-goals

- Refactoring the connection pool's single-slot `eventHandler` (works for current users; a multi-listener refactor would help observer/screencast/nav-observer share one socket but is out of scope and risks regressing PRI-1446).
- Changing `humanType`'s per-character keystroke timing (the 26s typing cost in the failing run is by design for bot-detection resistance, not the bug being fixed here).
- General pool flakiness, single-use fallback semantics, retry policy.
- Tool name / shape / arguments contract for any web tool.

## Decision summary

- **Stability signal:** `Page.lifecycleEvent` name `load`. Not `networkIdle` — apps with persistent sockets (LiveView, HMR, polling) may never reach networkIdle.
- **Cap behavior on no `load` within budget:** skip screenshot, return action result with a `(screenshot unavailable: navigation did not settle within 3000ms)` note. Per Q2 decision: do *not* attempt screenshot on cap-hit.
- **Caps:** 3000ms nav-stability cap; 5000ms CDP timeout for the screenshot when invoked from `return_screenshot` path. The default 30000ms CDP timeout remains for explicit `screenshot` tool calls.
- **Nav-detection probe:** 150ms after the action, check whether `Page.frameStartedLoading` fired since `actionStartTs`. If not, no navigation happened — resolve immediately. If yes, wait for `load` up to cap.
- **Nav-suspicious actions:** `click`, `navigate`, `press`, `type`, `fill`, `doubleClick`, `rightClick`, `selectOption`. Skipped: `hover`, `scroll`, `drag`, `mouseMove`, `screenshot`, `extract`, `eval`, etc.
- **Observer placement:** dedicated per-target WebSocket in a new Gauntlet-only module `src/adapters/web/nav-observer.ts`. Mirrors the WebAuthn precedent in `chrome-ws-lib.js:3160-3170` ("CDP's WebAuthn domain is scoped to the specific DevTools session"). Avoids fighting the pool's single-slot `eventHandler` (used by `openObserverSession` and `onCdpEvent`).

## Architecture

```
adapter.ts                        nav-observer.ts (NEW)        chrome-ws-lib.js (untouched)
─────────────                     ──────────────────           ──────────────────────────
takeReturnScreenshot()            createNavObserver(wsUrl)     pool / sendCdpCommand /
  ├── waitForStable(...)          ├── opens dedicated WS         screenshot / click / ...
  ├── try { screenshot(...) }     ├── Page.enable
  └── catch → degrade text        ├── Page.setLifecycleEvents…
                                   ├── waitForStable({since,cap})
case "click" / "navigate" /       └── close()
case "press" / etc:
  record actionStartTs
  call action
  await observer.waitForStable
  takeReturnScreenshot
```

### `src/adapters/web/nav-observer.ts` (new)

Gauntlet-only TypeScript module.

```ts
export interface WaitForStableOpts {
  since: number;          // CDP-comparable monotonic timestamp (seconds, like Page.lifecycleEvent.timestamp)
  cap?: number;           // default 3000ms
  probeMs?: number;       // default 150ms
}

export interface WaitForStableResult {
  stable: boolean;
  navigated: boolean;     // false if no frameStartedLoading fired since `since`
  capHit: boolean;        // true iff stable === false
  observerDead?: boolean; // true if the observer's WS dropped
}

export interface NavObserver {
  waitForStable(opts: WaitForStableOpts): Promise<WaitForStableResult>;
  close(): Promise<void>;
}

export interface CreateNavObserverOpts {
  wsFactory?: (url: string) => WebSocketLike;  // DI seam for tests
}

export function createNavObserver(wsUrl: string, opts?: CreateNavObserverOpts): Promise<NavObserver>;
```

Internal behavior:
- On creation: open dedicated WS to `wsUrl`. Send `Page.enable`. Send `Page.setLifecycleEventsEnabled({ enabled: true })`. Send `Page.getFrameTree` and cache the top-level `frameId`.
- Subscribe to incoming messages. For events with `method === 'Page.lifecycleEvent'` and `params.frameId === topLevelFrameId`:
  - On `params.name === 'init'` or first `frameStartedLoading` since last load → record `lastNavStartTs = params.timestamp`.
  - On `params.name === 'load'` → record `lastLoadEventTs = params.timestamp`. Resolve any parked listeners whose `since <= timestamp`.
- For events with `method === 'Page.frameStartedLoading'` and matching `frameId` → record `lastNavStartTs = monotonicNow()`.
- `waitForStable({ since, cap = 3000, probeMs = 150 })`:
  - If observer is dead → resolve `{ stable:true, navigated:false, capHit:false, observerDead:true }`.
  - If `lastLoadEventTs` is comparable to `since` and `>= since` → resolve `{ stable:true, navigated:true, capHit:false }`.
  - Sleep `probeMs`.
  - If no `lastNavStartTs >= since` → resolve `{ stable:true, navigated:false, capHit:false }`.
  - Park a one-shot listener for `load` events ≥ `since`. Race against a `cap`-ms timer.
    - Listener wins → `{ stable:true, navigated:true, capHit:false }`.
    - Timer wins → `{ stable:false, navigated:true, capHit:true }`.
- `close()`: closes the dedicated WS. Idempotent. Subsequent `waitForStable` calls resolve immediately as `observerDead`.

Notes on timestamp comparability: CDP `Page.lifecycleEvent.timestamp` is monotonic seconds since process start. We use a small helper `cdpNow()` that captures the same clock domain (or simply uses `performance.now() / 1000` paired with a one-time offset measurement on observer init). The exact basis matters less than internal consistency: all `since` values are sourced from the same `cdpNow()` helper that the observer compares against incoming events.

### `src/adapters/web/adapter.ts` changes

1. WebAdapter holds `private navObservers: Map<string, Promise<NavObserver>>` keyed by wsUrl. Lazy-create on first use per tab.
2. `takeReturnScreenshot` rewritten:
   ```ts
   async function takeReturnScreenshot(opts: {
     args: ToolArgs;
     actionStartTs?: number; // omit for non-nav-suspicious actions
   }): Promise<{ image?; imagePath?; screenshotSkipped?: string }>
   ```
   - If `args.return_screenshot` is falsy → `{}`.
   - If `actionStartTs` is provided → `await observer.waitForStable({ since: actionStartTs })`.
     - On `capHit` → `{ screenshotSkipped: 'navigation did not settle within 3000ms' }`.
     - On `observerDead` → proceed to screenshot anyway (best-effort).
   - `try { screenshot(...) } catch (e) { return { screenshotSkipped: e.message } }` — always with the 5s CDP timeout when called from this path.
3. Action case-handlers for nav-suspicious actions record `actionStartTs = cdpNow()` immediately before the action call, pass it to `takeReturnScreenshot`. Other actions call `takeReturnScreenshot` without `actionStartTs` (skip the wait).
4. Result-text composition helper: if `screenshotSkipped` is set, append ` (screenshot unavailable: ${screenshotSkipped})` to the action text. Otherwise return text + image as today.

## Data flow (the failing case, post-fix)

```
1. Adapter receives click(button:contains('Post'), return_screenshot:true).
2. Adapter resolves activeTab → wsUrl. Looks up observer; lazily creates one.
3. Observer (per target, one-time): open dedicated WS, Page.enable,
   Page.setLifecycleEventsEnabled, Page.getFrameTree → cache topLevelFrameId.
4. Adapter records actionStartTs = cdpNow().
5. Adapter calls chrome.click(tab, "button:contains('Post')") over pooled WS.
   Returns once mouseReleased acked.
6. Renderer fires submit handler synchronously. Browser navigates.
   Observer's WS receives:
     Page.frameStartedLoading       → lastNavStartTs = cdpNow()
     Page.lifecycleEvent name='init'
     Page.lifecycleEvent name='DOMContentLoaded'
     Page.lifecycleEvent name='load' → lastLoadEventTs = ts
7. Adapter awaits observer.waitForStable({since: actionStartTs}).
   - If load already fired (rare, fast nav) → resolves immediately.
   - Else sleep 150ms.
   - If lastNavStartTs < actionStartTs → no nav, resolve {navigated:false}.
   - Else wait for next load event ≥ actionStartTs, cap 3000ms.
   Tutorial app: load fires within ~10ms of nav commit; resolves after probe.
8. Adapter calls chrome.screenshot(tab, ...) over pooled WS, 5s CDP timeout.
   Renderer is post-load; screenshot returns ~50ms.
9. Returns { text: "clicked button:contains('Post')", image, imagePath }.
```

## Error handling

**Observer-side:**
- WS connect fails: `createNavObserver` rejects. Adapter catches once per tab, logs at warn level, falls back to "no observer" mode for that tab — `waitForStable` is treated as a no-op. Bug returns for that tab (acceptable degradation; we are no worse than today).
- WS drops mid-run: observer marks itself dead. Subsequent `waitForStable` calls resolve immediately as `observerDead`. Adapter logs warn once. We do **not** auto-reconnect — re-enabling Page domain on a fresh socket loses event history.
- `Page.enable` / `Page.setLifecycleEventsEnabled` / `Page.getFrameTree` rejects during init: surface as observer creation failure, same handling.

**Screenshot-side (bug 2 fix):**
- `takeReturnScreenshot` wraps `chrome.screenshot()` in try/catch. Any thrown error becomes `screenshotSkipped: <message>`.
- Action handlers compose final text: action result + ` (screenshot unavailable: <reason>)` when applicable. Action's primary text (`clicked X`, `navigated`, etc.) stays truthful.

**Cap-hit:** treated as "navigation in progress, page not screenshot-ready, skip screenshot." Per Q2 decision, no screenshot attempt on cap-hit.

**Tool-timeout interaction:**
- Worst case, cap-hit path: 150ms probe + 3000ms cap = 3.15s. No screenshot CDP call.
- Worst case, screenshot attempted: 150ms probe + ≤3000ms wait + 5000ms screenshot = 8.15s. Comfortably under any reasonable `toolTimeoutMs`.

## Testing

### T1 — Observer unit tests (no Chrome required)

`test/adapters/web/nav-observer.test.ts`. DI a fake `wsFactory` that emits scripted CDP messages. Verify:

- `waitForStable` resolves immediately when `lastLoadEventTs >= since`.
- `waitForStable` resolves on next matching `load` event when navigation is pending.
- `capHit:true` after configured cap with no `load` event.
- Probe correctly distinguishes "no nav" (resolves `navigated:false`) from "nav in flight" (waits for load).
- Top-frame events trigger nav state; subframe events ignored.
- Observer dead → `waitForStable` resolves `{observerDead:true}`.
- `close()` is idempotent. Post-close `waitForStable` resolves with `observerDead:true`.

### T2 — Adapter wiring unit tests

`test/adapters/web/adapter.test.ts` additions. Mock `chrome` and `observer` interfaces. Verify:

- Nav-suspicious action handlers (`click`, `navigate`, `press`, `type`, `fill`, `doubleClick`, `rightClick`, `selectOption`) record `actionStartTs` and call `waitForStable`.
- Non-nav-suspicious handlers (`hover`, `scroll`, `drag`, `mouseMove`) skip the wait.
- `screenshotSkipped` produces `(screenshot unavailable: …)` text composition.
- Action's primary text remains truthful regardless of screenshot outcome.

### T3 — End-to-end regression test

`test/e2e/web-form-post-nav.test.ts`. Bun.serve fixture: single button that POSTs and 303-redirects. Scripted client: one `click(button, return_screenshot:true)`.

Assertions:
- Tool result returns within ~1s wall-time.
- Tool result contains an image.
- Tool result text is `clicked button` (no `Error:` prefix, no `(screenshot unavailable)` note).

This is the regression gate. Without the fix it takes 30s and fails on text content.

### T4 — Tutorial repro re-run (manual sanity)

Re-run `tutorial-06-post-and-verify` post-fix. Confirm the click action drops from 30s to <1s wall-time.

## Files affected

- **New:** `src/adapters/web/nav-observer.ts`.
- **New:** `test/adapters/web/nav-observer.test.ts`.
- **New:** `test/e2e/web-form-post-nav.test.ts` (+ matching fixture story card under `test/fixtures/stories/`).
- **Modified:** `src/adapters/web/adapter.ts` — observer wiring, `takeReturnScreenshot` rewrite, action-handler `actionStartTs` plumbing, result-text composition.
- **Modified:** `test/adapters/web/adapter.test.ts` — wiring assertions.
- **Untouched:** `src/adapters/web/lib/chrome-ws-lib.js`.

## Risks

- **Lifecycle-event timestamp domain mismatch.** CDP `timestamp` semantics need verification against `performance.now()`. If they're incompatible we either capture timestamps from observed events only (compare event-vs-event, not event-vs-wallclock) or we add a one-time offset measurement at observer startup. T1 tests will surface this immediately.
- **150ms probe under-cuts a slow renderer.** If a real app fires `frameStartedLoading` more than 150ms after the click commit, we'll miss the nav and screenshot too early. Mitigation: emit the chosen probe value in observer warn logs when a screenshot is taken with `navigated:false` and a navigation later appears in the same tab. Tune up if seen.
- **Observer leaks across `new_tab` / `close_tab`.** Adapter must close observers on `close_tab` and `adapter.close()`. Map cleanup must match tab lifecycle.
- **Bug-2 try/catch hides real CDP issues.** Mitigation: warn-level log on every `screenshotSkipped` so we can spot trends. Don't silently swallow.
