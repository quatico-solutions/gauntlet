# chrome-ws-lib flatten mode + browser-WS bridge — design as shipped

**Linear:** PRI-1535

This document describes the design as it landed on `main`. It supersedes the iteration history (Phase A → A.5 → various drafts) — that history is in git, not in docs. References to the migration sequence have been compressed to the architectural decisions that actually matter going forward.

## 1. What ships

The web adapter's CDP layer (under `src/adapters/web/lib/`) moves from per-page-WebSocket transport to flatten-mode CDP — page sessions over a single browser-level WebSocket — alongside two new capabilities:

- **Live target-lifecycle visibility.** `Target.targetCreated` events flow over the browser-WS so page-spawned popups (OAuth redirects, agent-driven multi-tab sign-in flows) become addressable without polling `/json`.
- **BrowserContext-based per-test isolation.** `Target.createBrowserContext` / `Target.disposeBrowserContext` replaces the prior `Network.clearBrowserCookies + Storage.clearDataForOrigin` best-effort cleanup. Atomic teardown of cookies, storage, IndexedDB, service workers, and permissions in one CDP call.

The structural simplification is the bigger story: the per-page WS pool retires. Page actions (click, navigate, evaluate, screenshot, etc.) ride a `pageSession.send()` over the shared browser-WS. The race class behind the legacy "Pooled connection failed, using single-use" warning — WS dropping mid-command on a per-page socket and silently breaking the focus invariant — is structurally absent in the new architecture because the substrate (per-page WSes) is gone.

## 2. Architecture

```
chrome-ws-lib
├── lib/websocket-client.js         WebSocket transport (Bun-compatible)
├── lib/chrome-launcher-helpers.js  HTTP helpers, port discovery
├── lib/chrome-process.js           startChrome / killChrome
├── lib/session-state.js            per-session state bag
│
├── lib/browser-session.js          ONE browser-level WS per Chrome.
│                                   Lazy-opened on first bridge use.
│                                   Addresses /devtools/browser/<id>.
├── lib/browser-bridge.js           Target.* events + BrowserContext
│                                   create/dispose. Constructs the
│                                   cdp-router internally.
├── lib/cdp-router.js               sessionId-aware dispatcher.
│                                   Routes incoming browser-WS messages
│                                   to the right page session (or to
│                                   root listeners for sessionless
│                                   target-lifecycle events).
├── lib/page-session.js             Per-page CDP session.
│                                   Attached via Target.attachToTarget(
│                                   {flatten: true}). Exposes send /
│                                   onEvent / waitForEvent / detach /
│                                   enableDomain.
│
├── lib/tabs.js                     getTabs/newTab/closeTab. Returned
│                                   tab handles carry a lazy
│                                   getPageSession() thunk; per-target
│                                   memoization shares the session
│                                   across callers.
│
├── lib/{mouse,keyboard-input,evaluation,screenshot,navigation,
│       extraction,file-upload,select-option,viewport,cookies,
│       capture,console-logging}.js
│                                   Action libs. Take
│                                   `tabIndexOrPageSession` and route
│                                   through pageSession.send().
│
└── chrome-ws-lib.js                234-line orchestrator. Wires the
                                    above into createSession().
```

A single `WebSocket` connects to `/devtools/browser/<id>`. Every page session multiplexes onto that connection via `sessionId`-tagged messages. Per-page WebSockets at `/devtools/page/<targetId>` are no longer used for action commands — the only places they survive are deliberate per-socket-isolation cases (WebAuthn pinning).

The cdp-router owns dispatch by `sessionId`; sessionless command responses fall through to `browser-session.js`'s own pendingRequests map (single source of truth for root-session response correlation).

### 2.1 Why lazy-open on the browser-WS

The browser-WS opens the first time `session.targets.*` or `session.createBrowserContext` is called, not eagerly in `startChrome`. The reason is the remote-Chrome path (`adapter.ts`'s `this.remote = true`): when the adapter is given a `{host, port}` of an already-running Chrome, `startChrome` is skipped entirely. Lazy-open gives one code path that works in both local and remote modes.

### 2.2 Why one BrowserContext per WebAdapter

Per-test isolation in `gauntlet serve` and `gauntlet batch` previously came from a per-launch `--user-data-dir` (Chrome relaunch + profile dir mkdir/rmdir between tests, costing seconds). BrowserContext-based isolation is `Target.disposeBrowserContext` — atomic, milliseconds, no Chrome relaunch. WebAdapter still owns its Chrome process; the BrowserContext is the unit of test-state isolation within that process.

### 2.3 Why the per-page WS pool retires

The pool existed (per JRV-130) so that focus survived across `Runtime.evaluate` calls — re-attaching a fresh debugger client per call dropped DOM focus mid-flow. Page sessions on the browser-WS solve the same problem more cleanly: one persistent CDP session per page, no WS lifecycle to manage, sessionId envelope handles routing.

The "Pooled connection failed, using single-use" warning was a symptom of that pool's failure mode: when a per-page WS died mid-command (likely tied to navigation/renderer-replacement events), the pool fell back to a fresh single-use socket, which silently broke the JRV-130 focus invariant. Removing the pool removes the substrate; the warning is no longer reachable.

## 3. Empirical foundation

Two throwaway investigations grounded the design before commit:

**Live target visibility latency.** Running headless Chromium 137: a page evaluating `window.open('about:blank', '_blank')` (with `userGesture: true`) produces `Target.targetCreated` on the root browser session in **2-3ms median across 10 trials**, no flakiness. Filter the new target by `openerId`, not URL — `targetCreated` arrives with `url: ""` and the URL fills in via a follow-up `targetInfoChanged`. The popup target arrives before the `Runtime.evaluate` reply itself, so even synchronous "fire eval, then await" code never misses it.

**WebAuthn isolation across BrowserContexts.** Two `webAuthnOpenSession` instances on pages in different BrowserContexts — each opens a dedicated per-target WebSocket — were probed across the boundary. `WebAuthn.addCredential` against a foreign authenticatorId fails deterministically with "Could not find a Virtual Authenticator matching the ID" (5/5 trials). The actual binding is **per-target** (per-page), not per-socket as some upstream comments suggested: a second WS to the same page targetId can read the authenticator without re-running `WebAuthn.enable`; a WS to a different page targetId in the same BrowserContext cannot. The Phase-A.5 design relies on per-target binding being structural for cross-context isolation.

## 4. What's deliberately not in scope

Three cases keep their pre-flatten transport rather than migrating:

- **WebAuthn (`webAuthnOpenSession`).** Per-target binding (above) means a dedicated per-target WS gives free isolation. Migrating WebAuthn into a flatten-mode session would require explicit isolation handling for no functional gain.
- **Observer / screencast event streams** (`openObserverSession`, `onCdpEvent` / `offCdpEvent`). These currently route through page sessions internally (the legacy session-level `onCdpEvent` API is preserved as a thin wrapper) — but the dedicated session-level shape is retained for now. Refactoring them onto a uniform page-session-event-listener API is a follow-up (PRI-1539, Backlog).
- **PRI-1517 screenshot-during-nav `opts.timeoutMs` mitigation.** The wedge mechanism was never pinned down. The systematic flatten-mode argument applies only conditionally: if the wedge is at the per-page-WS layer, removing per-page WSes fixes it; if it's at Chrome's per-page-session command queue at the renderer, flatten same-session does not fix it (page sessions on the browser-WS still serialize commands per page sessionId). The mitigation stays load-bearing; revisit if production shows the wedge has shifted shape.

## 5. Module specifications

### 5.1 `lib/browser-session.js`

One CDP WebSocket per Chrome process, lazy-connected on first `send()` or `onEvent()` call. Discovers the WS URL via `chromeHttp('/json/version').webSocketDebuggerUrl` and pipes through `state.rewriteWsUrl`.

```
createBrowserSession({state}) → {
  send(method, params, opts),    // own pendingRequests map for root-session id correlation
  onEvent(handler),              // raw incoming messages (cdp-router subscribes here)
  close(),                       // closes WS, rejects pending
  isConnected(),
  _sendRaw(json),                // internal: page-session uses this for sessionId-enveloped messages
}
```

`send()` matches responses by `id` only when `sessionId` is unset. Page-session-tagged messages fall through `onEvent` for the cdp-router to dispatch. Connection-promise race: `ws` is assigned only after a successful connect; the resolved `connectPromise` stays in place so subsequent awaits short-circuit.

### 5.2 `lib/cdp-router.js`

Subscribes to `browser.onEvent`, routes incoming messages by `sessionId`:

- `{id, sessionId}` → page-session pendingRequests (per session, independent id-spaces)
- `{method, sessionId}` → page-session event listeners
- `{method}` (sessionless) → root listeners
- `{id}` (sessionless) → intentionally falls through; browser-session.js's pendingRequests handles root-session response correlation

```
createCdpRouter({browser}) → {
  registerSession(sessionId) → {pendingRequests, eventListeners},
  unregisterSession(sessionId),
  getRootListeners(),
}
```

No `rootPending` map — root-session response correlation lives in `browser-session.js`. Don't add one; it's an attractive nuisance.

### 5.3 `lib/page-session.js`

```
attachPageSession({browser, router}, targetId) → {
  sessionId,
  targetId,
  send(method, params, opts),    // sessionId-enveloped via browser._sendRaw
  onEvent(handler),
  waitForEvent(method, opts),
  enableDomain(name),            // idempotent — multiple callers can enableDomain('Runtime') without coordination
  detach(),                      // Target.detachFromTarget, unregister from router
}
```

Per-session message id counter — independent of other sessions on the same browser-WS. **No retry, reconnect, or fallback inside `send`.** The contract is one-shot: if the browser-WS dies, the call rejects and the run aborts. This is the deliberate property that retires the pool's silent fallback.

### 5.4 `lib/browser-bridge.js`

```
attachBrowserBridge({state, browser}) → {
  targets: {
    list(),
    onCreated(handler),
    onDestroyed(handler),
    waitForNew(predicate, {timeoutMs}),
  },
  createBrowserContext({proxyServer?}) → {
    browserContextId,
    createPage(url) → tab handle (with .targetId, .webSocketDebuggerUrl, .getPageSession()),
    dispose(),
  },
  attachPageSession(targetId) → pageSession,
}
```

`createBrowserContext` calls `Target.createBrowserContext` over the browser-WS. `createPage` calls `Target.createTarget({url, browserContextId})`, constructs the per-page WS URL (used only by page sessions and WebAuthn now), routes through `state.rewriteWsUrl`.

### 5.5 `lib/tabs.js`

`getTabs()` returns tab handles each carrying a lazy `getPageSession()` thunk. Memoized per `targetId` so concurrent callers share the same page session. `closeTab` detaches any cached page session before issuing the HTTP close.

### 5.6 Action libs

Twelve libs (`mouse`, `keyboard-input`, `evaluation`, `screenshot`, `navigation`, `extraction`, `file-upload`, `select-option`, `viewport`, `cookies`, `capture`, `console-logging`) take `(tabIndexOrPageSession, ...)` and resolve through the orchestrator's `getPageSession(arg)` resolver:

- `arg` is already a pageSession → passthrough
- `arg` is a number or numeric string → index into `getTabs()`, return that tab's `getPageSession()`
- `arg` is a `ws://...` URL → match by `rewriteWsUrl`-normalized URL against `getTabs()`, return that tab's `getPageSession()`

Each lib calls `pageSession.send(method, params)` instead of the legacy `sendCdpCommand(wsUrl, method, params)`.

`navigation.js` and `console-logging.js` are the structurally distinct migrations — they previously opened separate WebSockets to listen for `Page.loadEventFired` and `Runtime.consoleAPICalled` events respectively. Both now ride `pageSession.onEvent` over the browser-WS. The 30s navigation hard cap is preserved. `state.consoleMessages` is keyed by `sessionId`.

## 6. Adapter integration (`src/adapters/web/adapter.ts`)

`WebAdapter.start()` creates a BrowserContext, spawns the initial page in it, and seeds the focus stack with the new page's WS URL. `setViewport` and `openObserverSession` address the new page's WS URL rather than numeric tab index 0 (since `getTabs()[0]` is no longer guaranteed to be the WebAdapter's page under BrowserContext-per-instance isolation).

`WebAdapter.close()` disposes the BrowserContext after popping any side-trip tabs and before `killChrome`.

The side-trip-tab pattern (agent opens a tab to fetch auth context without disturbing the original page) uses `session.targets.waitForNew(predicate, {timeoutMs})` — push-based on `Target.targetCreated`, no polling.

## 7. Test surfaces

- `test/adapters/web/chrome-ws-lib-isolation.test.ts` — structural per-session isolation gate. Probes closure identity on `session.targets`, `session.createBrowserContext`, `session.attachPageSession` to prove no module-level shared state.
- `test/adapters/web/chrome-ws-lib-context-isolation.test.ts` — behavioral gate: two parallel `WebAdapter` instances, BrowserContext-based cleanup, cookie isolation across the cleanup boundary.
- `test/adapters/web/lib/browser-session.test.ts` — connection round-trip, event dispatch, close behavior.
- `test/adapters/web/lib/browser-bridge.test.ts` — targets list, onCreated/onDestroyed, `waitForNew` (including the `window.open` case), BrowserContext create/dispose isolation.
- `test/adapters/web/lib/page-session.test.ts` — attach round-trip, concurrent sessions on different pages, onEvent, waitForEvent.
- `test/adapters/web/lib/cdp-router.test.ts` — sessionId dispatch, root-listener routing, sessionless command responses do NOT fire root listeners (regression on the right-source-of-truth principle).
- `test/adapters/web/lib/tabs.test.ts` — tab handles return functioning `getPageSession()` thunks.
- `test/adapters/web/lib/webauthn-context.test.ts` — cross-context isolation regression, locks in the per-target binding finding.
- `test/adapters/web/side-trip-popup.test.ts` — `window.open`-spawned popup observable via `targets.waitForNew` within 1s.

Plus all pre-existing adapter / cookies / passkey / host-override tests pass unchanged.

## 8. Failure handling

Three modes:

- **Browser-WS dies mid-session.** Bridge ops fail closed (`pageSession.send` rejects). Per-target WebAuthn sockets are independent and unaffected, but the run's BrowserContext becomes unaddressable, so a single browser-WS death effectively aborts the run. No reconnection logic. Localhost CDP doesn't die in practice; remote-Chrome runs already abort the run on Chrome connectivity issues.
- **`context.dispose()` fails.** Logged, continues. Worst case: state lingers in Chrome until the process is reaped.
- **`pageSession.send` after detach.** Rejects with `"Page session detached"`. Contract: callers don't reuse detached sessions.

## 9. Out-of-scope follow-ups

- **PRI-1539** (Backlog): observer / screencast / `onCdpEvent` refactor onto a uniform page-session-event-listener API. Not blocking; the current shape works.
- **Upstream contribution** (`obra/superpowers-chrome`): the modular layout this adopted is upstream HEAD `a9e2d0c`. The page-session / cdp-router work is Gauntlet-side; future PR is a separate ticket against the proven shape.
- **PRI-1517 mechanism investigation**: if the screenshot-during-nav wedge persists in production after this lands, the `opts.timeoutMs` mitigation is still load-bearing but the architectural premise (substrate gone) didn't address it — investigate the renderer-level command-queue candidate.

## 10. Acknowledgements

Design and implementation: Vetinari (coordinator), Carthage (live-target latency investigation, per-target WebAuthn binding), Hadrian and Tacitus (design review), Augustine and Domitian (implementation-plan review), Vespasian (caught upstream-checkout staleness during a Phase B draft), Pliny (WebAuthn isolation investigation), Diogenes (browser-WS bridge implementation), Pertinax (full flatten-mode migration). All Bobs, working asynchronously with Matt over 2026-05-07 and 2026-05-08.
