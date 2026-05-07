# chrome-ws-lib flatten-mode migration — upstream-bound PR plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to drive this plan stage-by-stage. Each stage is one upstream PR. Stages are deliberately *not* TDD task lists — the executor designs each PR's task breakdown when they pick it up. The plan is the *sequence and acceptance criteria*, not the implementation steps.

**Goal:** Migrate Gauntlet's web adapter and its upstream `obra/superpowers-chrome` library from per-target-WebSocket routing to flatten-mode CDP routing (`Target.attachToTarget({flatten: true})` + sessionId), staged as a sequence of upstream-bound PRs from `mhat` into `obra/superpowers-chrome`. The work lands upstream first; Gauntlet's fork sync recipe pulls it in.

**Why upstream-first:** PR #33 (per-session factory, merged 2026-05-05) confirms upstream is collaborative and willing to absorb Gauntlet's multi-tenant requirements. Carrying the flatten-mode migration as a permanent Gauntlet divergence would compound the sync cost every cycle. Landing it upstream means future syncs continue to be cheap.

**Spec / design framework:** `cc-plugin-primeradiant-ops/skills/chrome-devtools-protocol/SKILL.md` and its `reference/library-comparison.md` (the "incremental capability bridges" section is the plan's spine).

**House terms:** "flatten mode" = single browser-WS + sessionId routing. "Per-target-WS" = one WS per page. These are the canonical CDP terms. "Browser-WS bridge" = an interim shape where a browser-level WS is opened *alongside* the existing per-target-WS pool (gives flatten-mode capabilities without retiring the pool). "Full flatten mode" = Page sessions also moved onto the browser WS, per-target-WS pool gone.

---

## 1. Goal and rationale

### What we get

1. **Live target lifecycle visibility** (Pliny's #1 concern; design-review-checklist Q2.1). A `window.open`, OAuth redirect popup, or page-spawned `target=_blank` becomes addressable the instant Chrome notifies us — no `/json` polling, no `waitForNewTab` helpers. PRI-1439's side-trip pattern stops being agent-initiated-only.
2. **`Target.createBrowserContext` isolation** (Pliny's #2 concern; checklist Q3.1). Per-test isolation in milliseconds rather than seconds (no Chrome relaunch, no `--user-data-dir` rm-rf). Cookies, IndexedDB, CacheStorage, service workers, permissions, per-context proxy — all scoped, all disposable atomically. Replaces Gauntlet's spec §5.1 strategy 3 (per-launch profile dir) with strategy 4.
3. **Native concurrent-target ops on one WS** (checklist Q1.1, Q4.1). Two sessionIds on one browser WS can drive two tabs in parallel with no shared message queue. Today Gauntlet has one WS per tab plus one screencast WS plus one observer WS plus one WebAuthn WS — the count grows with every Gauntlet-only feature.
4. **Cleaner extension hooks for Gauntlet-only features.** `openObserverSession`, `webAuthnOpenSession`, `onCdpEvent`/`offCdpEvent`, and the screencast pattern are all hand-rolled "open another WS, route events ourselves" — they recreate flatten-mode's session model on top of per-target-WS. In flatten mode they become "attach a session, register a listener" — supported APIs, not bypass code.
5. **Smaller per-sync delta.** Each upstream sync currently hand-ports diffs through ~15 lines of `GAUNTLET DIVERGENCE` markers. Once flatten mode is upstream and Gauntlet's extensions ride on supported hooks, several markers retire.

### What we lose

1. **Per-socket WebAuthn isolation comes for free in per-target-WS; in flatten mode it requires explicit handling.** The `webAuthnOpenSession` pinned-socket pattern survives — it just becomes a deliberate workaround instead of an accidental feature. Stage 6 covers this.
2. **Wrapper-layer complexity goes up.** Flatten mode requires sessionId routing, target-lifecycle bookkeeping, attach/detach sequencing on navigation. A few hundred LOC of plumbing the per-target-WS layout doesn't need. SKILL.md's table calls this honestly: "wrapper-layer code volume — higher in flatten mode" — but in a codebase where agents can audit a few hundred LOC of session/target plumbing in a single pass, the cost is negligible.
3. **Single point of failure.** Today, if a tab WS dies, only that tab is lost. In flatten mode the browser WS is shared — if it dies, every active session goes with it. Stage 4 spells out the reconnection contract.
4. **Single CDP message bus.** Today every per-target WS has its own ordered queue. In flatten mode, all sessions share the browser WS. A noisy session (firehose `Network.*` events) can in theory delay another session's responses. We mitigate by enabling only the domains we need per session, but this is a real difference worth tracking.

### Who is blocking what

- **Gauntlet's adapter** depends on `chrome-ws-lib`'s `createSession()` exporting flatten-mode session objects. The adapter's TS types loosen (`ChromeSession = Record<string, any>`) but the call shape changes (e.g. `screenshot(0, ...)` becomes `screenshot(pageSession, ...)`). This is a hard cutover at the consumer level — we cannot incrementally migrate the adapter file by file because the session shape changes.
- **Upstream's MCP server and CLI** (`mcp/src/index.ts`, `skills/browsing/chrome-ws`) are the other consumers. They share the call shape with Gauntlet today; they will share it after the migration too. Each upstream PR must keep them green or migrate them in lock-step.
- **Pliny's review** explicitly recommends *not* doing this migration unless the test corpus demonstrably needs flatten-mode capabilities. Matt's authorization here overrides that — the corpus is growing and the demos that pop-up windows / federated auth flows / iframe-embedded checkout will hit the wall Pliny names. Better to migrate before the failures than after.

---

## 2. End-state sketch

```js
// chrome-ws-lib.js (post-migration, ~100 LOC orchestrator analogous to upstream's
// 234-line current shape)

const { createBrowserSession } = require('./lib/browser-session');
const { attachPageSession }    = require('./lib/page-session');
const { attachTargets }        = require('./lib/targets');
// ... plus all the existing extracted libs (mouse, keyboard, evaluation, ...)

function createSession({ host, port } = {}) {
  const state   = createState({ host, port });

  // Single browser-level WebSocket. Routes both root-session messages
  // (no sessionId) and all per-target session messages (sessionId set).
  const browser = createBrowserSession({ state });
  // Manages target-lifecycle events from the root session and exposes
  // a discoverable, awaitable surface for new tabs/popups/workers.
  const targets = attachTargets({ state, browser });

  // Page actions accept a `pageSession` (the object returned from
  // `targets.attachPage(targetId)`) instead of a tabIndex/wsUrl. Internally
  // each pageSession knows its sessionId; sendCdp routes by it.
  const click  = attachMouse   ({ browser });
  const fill   = attachKeyboardInput({ browser });
  const screenshot = attachScreenshot({ browser });
  // ...

  // BrowserContext = Target.createBrowserContext on the root session.
  // Returned object exposes createPage() and dispose(), reuses the same
  // browser WS for everything inside it.
  function createBrowserContext({ proxyServer, disposeOnDetach = true } = {}) { ... }

  return {
    // New: target lifecycle
    targets: { onCreated, onDestroyed, waitForNew, list, attachPage },

    // New: BrowserContext
    createBrowserContext,

    // Compatibility shim — preserves the current call shape during
    // migration. Resolves a tabIndex/wsUrl to a pageSession, then
    // dispatches. Can be deleted once the consumer has cut over.
    getTabs, newTab, closeTab, navigate, click, fill, screenshot, ...,

    // Existing: chrome lifecycle, profiles, viewport, cookies — unchanged
    startChrome, killChrome, setViewport, ...,

    // Gauntlet-only extension hooks (post-migration shape — see §5)
    onObserverEvent,         // replaces openObserverSession; per-page-session listener registration
    webAuthn: { open },      // replaces webAuthnOpenSession; opens a deliberately-isolated socket
    screencast: { start, stop, onFrame },  // replaces onCdpEvent + sendCdpCommand for screencast
  };
}

module.exports = { createSession };
```

**Key shape changes from today:**
- `tabIndex`/`wsUrl` arguments become `pageSession` objects. Pageless ops (browser-wide `Network.clearBrowserCookies`, `Storage.clearDataForOrigin` on a context) become methods on the browser/context, not on a tab.
- `getTabs()` keeps returning the array, but each entry now carries a `targetId` and a `pageSession` (or a way to materialize one), not just a `webSocketDebuggerUrl`.
- `Page.navigate` waits on `Page.frameNavigated`/`Page.loadEventFired` events delivered on the page session, not on a separate listener WS opened ad-hoc (today's `lib/navigation.js` pattern).

**Where Gauntlet's extensions plug in:** as supported callbacks on the session/context APIs, registered at construction time. See §5.

---

## 3. Sequenced stages (= upstream PRs)

Each stage is one PR into `obra/superpowers-chrome`. Stages 1-4 build the bridge; stages 5-8 retire per-target-WS; stage 9 is the Gauntlet-side adoption.

> **Effort sizing:** S = ~1 working day, M = ~2-3 days, L = ~1 week. Stages 1-4 are landable independently and unblock Gauntlet capability gains even if 5-8 stall.

> **Honest stop-points are flagged per-stage in §8.** Read those before authorizing the executor — there are two valid end-states ("browser-WS bridge with per-target-WS retained" and "full flatten mode") and the team may choose to stop after Stage 4.

> **Each stage requires human review on the upstream PR before the next stage starts.** That is the load-bearing not-overnight-compatible step. Stages 1-2 may be wrapped into one PR if review feedback wants tighter scoping, but otherwise treat them separately.

---

### Stage 1 — Browser-level WebSocket primitive

**Title:** `chrome-ws-lib: introduce createBrowserSession() — a per-instance browser-level WS`

**Motivation.** Today every CDP call opens or pools a per-target WS keyed by `webSocketDebuggerUrl`. Adding a single browser-level WS gives us the *root session* — the one that can call `Target.*`, `Browser.*`, `Storage.*` (browser-scoped), `SystemInfo.*`. No existing call sites change; this PR just adds the primitive other PRs will build on. The pattern is taken straight from `library-comparison.md` "Bridge: live tab/popup discovery."

**Scope.**
- New file: `lib/browser-session.js`. Exports `createBrowserSession({ state })` returning `{ send(method, params, opts), onEvent(handler), close(), isConnected() }`.
- Connects to `ws://<host>:<port>/devtools/browser/<id>` (resolved from `chromeHttp('/json/version').webSocketDebuggerUrl`).
- Reuses `WebSocketClient`, request/pending-promise pattern, timeout default — copy the shape from `lib/cdp-connection.js`. ID counter is per-WS.
- Adds the browser-WS lifecycle into `state` (`browserWs`, set lazily on first use, cleared in `closeAllConnections`).
- No changes to per-target-WS pool. The two coexist.

**Acceptance criteria.**
- [ ] Test `lib/browser-session.test.js` (new): given a launched Chrome, `createBrowserSession` connects, calls `Browser.getVersion`, returns a non-empty product string.
- [ ] Test: calls `Target.getTargets`, returns an array including at least the `about:blank` page Chrome auto-creates.
- [ ] Test: registers `onEvent` handler, calls `Target.setDiscoverTargets({discover: true})`, `newTab(...)` creates a target, the handler observes a `Target.targetCreated` event with `targetInfo.type === 'page'`. (This is the contract Stage 2 builds on.)
- [ ] Test: `close()` rejects all pending requests with `'Browser session closed'`, clears the listener list.
- [ ] Bundle drift detection (upstream's `npm test` already gates this) stays green.
- [ ] No existing test changes shape. The 140-test upstream suite stays green.

**Dependencies.** None. First PR in the chain.

**Risks.**
- **Origin allowlist on Chrome 111+** (checklist Q8.1): the Bun WebSocket client doesn't send `Origin` by default, so locally this works. Remote Chrome over Tailscale needs `--remote-allow-origins=*` — already user's responsibility for any per-target-WS connection too. Document in commit.
- **`/devtools/browser/<id>` URL vs IPv4/IPv6 resolution**: upstream `a9e2d0c` just landed an IPv4/IPv6 fix in `isPortFree`. If the JSON endpoint returns a hostname that resolves to `::1`, the WS connect can fail. Mitigation: rewrite host through `state.hostOverride.rewriteWsUrl` exactly as `getTabs()` already does for page WS URLs.

**Rollback.** Delete `lib/browser-session.js`. The PR is purely additive — nothing else depends on it yet.

**Effort:** S.

**Pause for review:** Yes — this is the foundation; if upstream pushes back on the file layout / naming, every later PR is affected.

---

### Stage 2 — `targets` API: live tab discovery

**Title:** `chrome-ws-lib: targets API for live tab/popup/worker discovery`

**Motivation.** PRI-1439's side-trip-tab pattern works only because the agent is the one creating tabs. The moment a page does `window.open`, an OAuth provider redirects through a popup, or a third-party login opens a child window, the per-target-WS driver is blind until the next `/json` poll. Pliny named this as the highest-priority gap. Stage 2 closes it on top of Stage 1's primitive.

**Scope.**
- New file: `lib/targets.js`. Exports `attachTargets({ state, browser })` returning:
  - `list()` — synchronous snapshot of known targets (proxies to `Target.getTargets` cache plus live event-driven updates).
  - `onCreated(handler)` / `onDestroyed(handler)` — register listeners.
  - `waitForNew(predicate, { timeoutMs = 15000 })` — promise-based async primitive (shape from `library-comparison.md`).
- The `attachTargets` constructor sends `Target.setDiscoverTargets({discover: true})` once on the browser session, then dispatches `Target.targetCreated` / `Target.targetDestroyed` / `Target.targetInfoChanged` events to registered listeners.
- `getTabs()` (in `lib/tabs.js`) optionally consults the targets cache to avoid an extra `/json` HTTP call. Behavior unchanged when targets API isn't initialized.
- `lib/tabs.js`'s `newTab()` is unchanged at this stage — still goes through `/json/new`. Future stages may swap to `Target.createTarget`.

**Acceptance criteria.**
- [ ] Test `lib/targets.test.js` (new): `await waitForNew(t => t.url.includes('localhost'))` resolves when a separate test-harness call opens that URL via `chromeHttp('/json/new?...')`.
- [ ] Test: `await waitForNew(...)` rejects after `timeoutMs` if no matching target appears.
- [ ] Test: `onDestroyed` fires when a tab is closed via `closeTab`.
- [ ] Test: a real `window.open` from a page (set up by the test harness via `evaluate('window.open(...)')`) is observed by `onCreated`. **This is the load-bearing test** — it's the failure mode per-target-WS structurally cannot solve.
- [ ] Existing `getTabs()` tests stay green.

**Dependencies.** Stage 1.

**Risks.**
- Listener-leak if a caller registers `onCreated` without ever closing the browser session. Mitigation: `close()` on browser session iterates and clears.
- Race: a target created between `Target.setDiscoverTargets` ack and `attachTargets` returning. Mitigation: send `setDiscoverTargets` synchronously with the constructor, queue any listeners until ack returns.

**Rollback.** Delete `lib/targets.js`. Stage 1 stays.

**Effort:** S.

**Pause for review:** Yes.

---

### Stage 3 — BrowserContext API

**Title:** `chrome-ws-lib: createBrowserContext for per-test isolation`

**Motivation.** Gauntlet's spec §5.1 strategy 3 (per-launch `--user-data-dir`) costs seconds-per-test — a Chrome relaunch and a profile-dir mkdir/rmdir each test. Strategy 4 (`Target.createBrowserContext`) is milliseconds — no new process, isolated cookies/storage/IDB/SW/permissions/per-context-proxy, atomic dispose. This is the second of the two Pliny-named gaps. Upstream's MCP server and CLI don't currently need contexts, but they shouldn't break — the API is additive, callers opt in.

**Scope.**
- Extend `lib/targets.js` (or a new `lib/browser-context.js`, executor's call): `createBrowserContext({ proxyServer, disposeOnDetach = true })` calls `Target.createBrowserContext` on the browser session and returns:
  ```js
  {
    browserContextId,
    async createPage(url = 'about:blank') { /* Target.createTarget with this contextId */ },
    async dispose() { /* Target.disposeBrowserContext */ },
  }
  ```
- `createPage` returns the same shape `getTabs()`'s entries do today (so existing per-target-WS code keeps working — the page is just attached via its `webSocketDebuggerUrl`, same as a `/json/new`-created page).
- This stage **does not yet plumb context isolation into Gauntlet's spec §5.1.** That's Stage 9. This PR just adds the API.

**Acceptance criteria.**
- [ ] Test `lib/browser-context.test.js`: a context-A page sets `document.cookie = "test=A"`; a context-B page reads `document.cookie` and sees no `test=` entry. (The structural isolation test.)
- [ ] Test: `dispose()` makes subsequent `createPage` calls on that context throw.
- [ ] Test: opening 10 contexts concurrently, doing one `Network.clearBrowserCookies` per page, all succeed without serializing through a single CDP queue.
- [ ] `proxyServer` is plumbed through `Target.createBrowserContext({proxyServer})` correctly. (Test against a local mock proxy if upstream has one; otherwise, a smoke test that Chrome accepts the param without erroring is fine.)
- [ ] Existing tests stay green.

**Dependencies.** Stage 1, Stage 2.

**Risks.**
- **WebAuthn-on-context** is per-context per-CDP-session in flatten mode, but the per-target-WS path still binds it per-socket. Stage 6 disambiguates; this stage just notes that mixing WebAuthn calls and BrowserContexts on the per-target-WS path is undefined. Document in the PR's CHANGELOG.
- **Memory:** every BrowserContext keeps state in Chrome's process. The MCP server's typical use is one context — fine. Gauntlet's serve mode running 10 stories in parallel is 10 contexts — also fine. 1000 stories is a research question, not a v1 concern.

**Rollback.** Delete the new exports. Stage 1, 2 stay.

**Effort:** M.

**Pause for review:** Yes.

---

### Stage 4 — Browser-WS bridge ships in upstream + first stop-point

**Title:** `chrome-ws-lib: opt-in flatten-mode bridge — wire targets + BrowserContext`

**Motivation.** Stages 1-3 ship the primitives. Stage 4 wires them into `createSession()` so callers actually see them on the returned session object: `session.targets.*`, `session.createBrowserContext`. The per-target-WS pool is **untouched**. This is the "full Pattern B + browser-WS bridge" end state. **It is a defensible permanent end state** — see §8 for the case for stopping here.

**Scope.**
- `chrome-ws-lib.js` (the orchestrator): construct `browser = createBrowserSession({state})` lazily on first access, attach `targets`, expose `targets` and `createBrowserContext` on the returned session object.
- Update upstream's `mcp/src/index.ts` to expose `Target.targetCreated` and `BrowserContext.dispose` shapes through new MCP actions only if the executor and Jesse both think they're useful. Otherwise just expose at the lib level — that's enough to ship Stage 5+ on top.
- Update upstream's `skills/browsing/chrome-ws` CLI similarly: add `chrome-ws targets` (list), `chrome-ws context create/dispose` if there's appetite. Otherwise lib-only.
- README + CHANGELOG: document the new APIs as "opt-in flatten-mode capabilities; existing per-target-WS code unchanged."

**Acceptance criteria.**
- [ ] `session.targets.waitForNew(...)` works end-to-end through the public API.
- [ ] `session.createBrowserContext()` works end-to-end.
- [ ] `session.getTabs()` and existing per-target-WS commands work unchanged. (Regression gate: upstream's full real-Chrome smoke suite passes.)
- [ ] No new mandatory call shape changes for existing consumers (MCP server, CLI). Migration guide in CHANGELOG describes how to opt in.
- [ ] **Gauntlet's regression gate** (`chrome-ws-lib-isolation.test.ts` and the broader adapter test suite) passes on the post-sync fork. See Stage 9 for the sync side.

**Dependencies.** Stage 1, 2, 3.

**Risks.**
- **Concurrency regression**: introducing a shared browser WS in a session that previously had only per-target WSes means a new failure mode (browser-WS dies). Mitigation: the browser WS is opt-in — if a caller never touches `targets.*` or `createBrowserContext`, the WS is never opened. PR-1436's `chrome-ws-lib-isolation.test.ts` regression gate validates per-session isolation; we should add a parallel `chrome-ws-lib-bridge.test.ts` that does two concurrent `createSession()`s, opens the bridge in both, runs targets+contexts in each, and verifies no cross-talk.
- **Resource exhaustion**: upstream's existing 140 tests don't stress the bridge. Add a stage-4 stress test that opens N=20 contexts in one session and disposes them, verifying no leaks (file descriptors, Chrome process memory).

**Rollback.** Revert the orchestrator changes — primitives stay.

**Effort:** M.

**Pause for review:** Yes — and **this is a designated honest stop-point**. After this PR lands and Gauntlet syncs, Gauntlet has the live-tab and BrowserContext capabilities it needs without losing per-target-WS's WebAuthn-isolation-for-free. See §8.

---

### Stage 5 — Page sessions over the browser WS (the real flatten cutover)

**Title:** `chrome-ws-lib: page sessions ride the browser WS via Target.attachToTarget(flatten:true)`

**Motivation.** This is the migration. Today every `Page.navigate`, `Runtime.evaluate`, `Page.captureScreenshot` rides a per-target WS. After Stage 5, those rides on the browser WS with a `sessionId` envelope. Per-target-WS code paths still exist (used by the legacy `getTabs()/wsUrl` shape) but new code prefers page sessions.

**Scope.**
- New file: `lib/page-session.js`. Exports `attachPage({ browser, targets }, targetId)` returning:
  ```js
  {
    sessionId,
    targetId,
    async send(method, params, opts) { /* routes through browser.send with sessionId */ },
    onEvent(handler),
    detach() { /* Target.detachFromTarget */ },
  }
  ```
- `browser.send(method, params, { sessionId })` routes the message envelope: top-level `sessionId` field on the JSON-RPC, response/event matching by `sessionId`+`id`. Events without `sessionId` go to root listeners (Stage 2's `onCreated` etc.); events with `sessionId` go to that page session's listener.
- `attachPage` calls `Target.attachToTarget({targetId, flatten: true})`, captures the returned `sessionId`, returns the page-session object.
- New `lib/cdp-router.js` (or extend `browser-session.js`): the dispatch logic that splits incoming messages by sessionId. ID counter is per-session.
- All existing extracted libs (`mouse.js`, `keyboard-input.js`, `evaluation.js`, `screenshot.js`, `navigation.js`, `console-logging.js`, `extraction.js`, `select-option.js`, `file-upload.js`) gain an "accepts a `pageSession`" code path alongside the existing "accepts a wsUrl" path. **This is the file-by-file diff that is the migration's bulk.** Each file is a small change but there are many.
- `chrome-ws-lib.js` orchestrator: when `getTabs()` is called, return entries that carry both `webSocketDebuggerUrl` (legacy) and a lazy `pageSession` getter (new). Page actions accept either.

**Acceptance criteria.**
- [ ] `lib/page-session.test.js` (new): a page session can `Page.navigate`, see `Page.loadEventFired` on its onEvent handler, run `Runtime.evaluate`, get `Page.captureScreenshot` — all over the browser WS.
- [ ] `lib/page-session-concurrency.test.js` (new): two page sessions on the same browser session run interleaved `Runtime.evaluate` calls; responses correlate to the right session even when sessionA's evaluate is slow and sessionB's is fast.
- [ ] **Stale execution-context regression**: Q6.1's `executionContextDestroyed` listener test — a page session navigates, the previous document's V8 context is destroyed, a stale `objectId` use surfaces a clear error rather than a silent garbage result.
- [ ] **Screenshot-during-nav fix**: Pliny's named structural failure mode (Q5.2). With page sessions, `Page.captureScreenshot` and `Page.navigate` ride different sessionIds — no head-of-line block. Add a regression test that issues a screenshot mid-navigation and asserts it returns within 5s instead of 30s. **This is the test that validates the "what we get" claim.**
- [ ] All existing per-target-WS tests stay green. The new path is additive.
- [ ] PRI-1517's `screenshot(opts.timeoutMs)` divergence becomes unnecessary for page sessions — the wedge is fixed at the architectural level. The opt parameter survives but its primary motivation goes away. (See §4 Divergence Audit.)

**Dependencies.** Stage 1, 2, 4.

**Risks. (This is the highest-risk stage.)**
- **Wide blast radius.** Every action library (`mouse`, `keyboard`, etc.) gets touched. A bug in the routing layer fails all of them at once. Mitigation: keep both code paths live (per-target-WS + page-session), gate switching with a parameter, and run the full upstream test suite under both modes.
- **Domain-enable-state correctness.** Each `Page.enable` / `Runtime.enable` / `Network.enable` is per-session state. If `getTabs()` returns a cached page session, the caller might assume a domain is enabled when it isn't. Mitigation: record per-session enabled domains in the session object, and have helper functions that enable-if-needed.
- **The MCP server and CLI are upstream's primary consumers.** Both go through this file, both must keep working without API change at the consumer level. Page sessions need a compat wrapper that exposes the same `session.click(tabIndex, ...)` shape as today's API.

**Rollback.** This PR is the largest. Rollback strategy: keep the per-target-WS codepath intact and *also-pathed* throughout. The PR is technically additive — page-session code sits beside per-target-WS code. Reverting deletes the new files and the orchestrator's wiring of them. Gauntlet's fork can disable the new path with a flag if a regression slips post-merge.

**Effort:** L.

**Pause for review:** Yes. **This is the stage that actually changes the architecture** — review here is critical.

---

### Stage 6 — WebAuthn explicit-isolation in flatten mode

**Title:** `chrome-ws-lib: webAuthn explicit-isolation API for flatten-mode users`

**Motivation.** WebAuthn's `WebAuthn.*` domain binds to the underlying CDP socket, not the protocol session (skill SKILL.md:226 + checklist Q3.3). In per-target-WS today, every page has its own socket — isolation is structural and free. In flatten mode, every page session shares the same socket, so two concurrent tests that both install virtual authenticators see each other's state. Gauntlet's `webAuthnOpenSession` already opens a pinned dedicated socket explicitly bypassing the pool — that pattern survives, it just becomes the canonical answer instead of a workaround.

**Scope.**
- New file: `lib/webauthn.js`. Exports `attachWebAuthn({ state })` returning:
  ```js
  {
    async open(targetId) {
      // Opens a NEW WebSocket directly to /devtools/page/<targetId>
      // (per-target-WS endpoint), enables WebAuthn on it, returns a
      // pinned-socket session object. Closing it disposes the socket.
    }
  }
  ```
- The pinned socket explicitly does **not** ride the browser WS — every WebAuthn instance gets its own. The shape mirrors today's `webAuthnOpenSession` exactly; it just lives in upstream and has a documented rationale.
- Document the rule in upstream's CHANGELOG and the SKILL.md docs: "WebAuthn requires per-socket isolation. Use `session.webAuthn.open(targetId)` rather than the page session's send."

**Acceptance criteria.**
- [ ] Two concurrent `webAuthn.open(...)` instances install different virtual authenticators, neither sees the other's authenticatorId.
- [ ] Closing one's session does not affect the other's.
- [ ] After Stage 5's page-session migration, calling `WebAuthn.enable` on a regular page session **fails clearly** (`Cannot enable WebAuthn on a flatten-mode page session — use session.webAuthn.open() instead`). Don't let it silently work-and-break-under-concurrency.
- [ ] Existing Gauntlet `passkey.test.ts` regression gates pass after Stage 9 sync.

**Dependencies.** Stage 5.

**Risks.** WebAuthn behavior is one of the most lightly-documented corners of CDP. The per-socket binding is well-understood but the concrete failure mode (state-mixing under concurrency) is hard to test deterministically. Mitigation: structural test — install authenticator A in instance 1, install authenticator B in instance 2, list authenticators in instance 1, assert B is not present.

**Rollback.** Delete `lib/webauthn.js`. Stage 5 stays — WebAuthn just goes back to "undefined under concurrency in flatten mode."

**Effort:** S.

**Pause for review:** Yes.

---

### Stage 7 — Observer / streaming as supported callback APIs

**Title:** `chrome-ws-lib: page-session event streaming via per-domain listener registration`

**Motivation.** Gauntlet's `openObserverSession` opens a dedicated WS and enables `Runtime`/`Log`/`Network` to stream `console`, `exception`, `log`, `network-ws` events to a handler. In per-target-WS world this is *necessary* because the existing pool can't have a long-lived event stream attached without polluting the request/response flow (which is exactly what `lib/console-logging.js` and `lib/navigation.js` solve by opening a *second* WS per use). In flatten mode, page sessions natively support listener registration on their own session — a single `pageSession.onEvent(handler)` plus `pageSession.send('Domain.enable')` is the supported pattern.

This stage replaces three workarounds with one supported API:
1. The per-tab pool's `conn.eventHandler` (the `onCdpEvent`/`offCdpEvent` Gauntlet-only divergence).
2. `lib/console-logging.js`'s separate WS for `Runtime.consoleAPICalled`.
3. `lib/navigation.js`'s separate WS for `Page.loadEventFired`.

All three become `pageSession.onEvent(predicate, handler)` registrations.

**Scope.**
- Add `pageSession.onEvent(handler)` to Stage 5's `attachPage`. Multiple handlers allowed; routed by sessionId from the browser WS dispatcher.
- Add `pageSession.waitForEvent(method, { timeoutMs })` returning a promise — a building block for navigation `loadEventFired` waits and similar.
- Refactor `lib/console-logging.js`: drop the second WS, register a handler on the page session.
- Refactor `lib/navigation.js`: drop the second WS, await `pageSession.waitForEvent('Page.loadEventFired', ...)`.
- Define a stable "observer subscription" pattern as an upstream API: `session.observers.attach(pageSession, { categories: ['console', 'exception', 'log', 'network-ws'], onEvent })`. This is the Gauntlet `openObserverSession` shape, generalized.
- Screencast streaming (Gauntlet's `screencast.ts` + `onCdpEvent`/`offCdpEvent`) shifts to `pageSession.onEvent(e => e.method === 'Page.screencastFrame', handler)` plus `pageSession.send('Page.screencastFrameAck', ...)`. Cleaner than the current shape.

**Acceptance criteria.**
- [ ] After refactor, `lib/console-logging.js` has no `WebSocketClient` import — events ride the page session.
- [ ] After refactor, `lib/navigation.js` has no second-WS construction — navigate awaits via the page session.
- [ ] Observer pattern, exposed as a public API: a smoke test where a caller registers for `console` and `exception` categories, the page logs and throws, both events arrive.
- [ ] Gauntlet's screencast (post-sync, Stage 9) drops to fewer LOC because the `onCdpEvent`/`offCdpEvent` indirection retires.

**Dependencies.** Stage 5.

**Risks.**
- Refactoring `lib/navigation.js` is non-trivial — its "open a second WS so Page.enable doesn't pollute the pool" pattern is itself a documented upstream fix (CHANGELOG mentions navigation hang fix). Be careful not to regress that. Mitigation: the regression gate is upstream's existing `lib/navigation.test.js`. Add a fast-loading-page test that asserts no 30s timeout.

**Rollback.** Keep the second-WS pattern in place; only ship the new observer API. Gauntlet's `openObserverSession` would survive as-is.

**Effort:** M.

**Pause for review:** Yes.

---

### Stage 8 — Retire per-target-WS pool

**Title:** `chrome-ws-lib: deprecate per-target-WS pool; flatten mode is the default`

**Motivation.** With Stages 5-7 in, every command can ride a page session over the browser WS. The per-target-WS pool is now dead code paths kept for backwards-compatibility shims. This PR retires it: the pool is removed, the legacy `wsUrl`-accepting overloads on action libraries are removed, `getTabs()`'s entries no longer include `webSocketDebuggerUrl` as the routing primitive (just as descriptive metadata).

**Scope.**
- Remove `lib/cdp-connection.js`'s `getPooledConnection`, `sendCdpCommandPooled`, `sendCdpCommandSingle`, `closePooledConnection`. Keep a thin `sendCdp` that routes through the browser WS + page session.
- Remove the legacy "accepts wsUrl" path from each action library.
- Update the MCP server and CLI to use page sessions exclusively.
- Major version bump (v3.0.0) — this is breaking for any external caller still using `wsUrl`-flavored call sites.
- CHANGELOG migration guide.

**Acceptance criteria.**
- [ ] `grep -r "/devtools/page/" lib/` returns nothing in the lib (only Stage 6's `webauthn.js` retains the per-target-WS endpoint, deliberately).
- [ ] `grep -r "sendCdpCommandPooled\|connectionPool" lib/` returns nothing.
- [ ] All upstream tests pass.
- [ ] Performance test: doing N=100 concurrent `Runtime.evaluate` calls across N pages takes <2× the time of N=1, evidence that the single browser WS isn't a bottleneck.

**Dependencies.** Stages 5, 6, 7.

**Risks.**
- **External callers break.** Anyone using `obra/superpowers-chrome` outside Gauntlet who happened to pass a `wsUrl` string sees a hard error. Mitigate via 6-month deprecation window: ship Stage 8 with the legacy paths still present but emitting `console.warn`, in a v2.X release; do the retirement in a separate v3.0.0 PR after the deprecation window closes.

**Rollback.** Trivial — keep the legacy paths around indefinitely. Stage 8 is the cleanup PR; not landing it just means the lib is a bit fatter.

**Effort:** M.

**Pause for review:** Yes — major version bump requires Jesse's sign-off.

**This stage may be deferred.** If upstream's appetite for v3 is low, stop after Stage 7 and live with the slightly-larger lib. Gauntlet gets all the capability gains either way.

---

### Stage 9 — Gauntlet sync + adapter migration

**Title (Gauntlet-side, not upstream):** `web-adapter: adopt flatten-mode chrome-ws-lib (post-stage-8 sync)`

**Motivation.** Stages 1-8 are upstream PRs. Stage 9 is the Gauntlet-side adoption: pull through the upstream sync recipe, migrate `src/adapters/web/adapter.ts` to the new call shape, retire Gauntlet-only divergences that flatten mode obviates (see §4), and convert spec §5.1 strategy 3 (per-launch profile) to strategy 4 (BrowserContext).

**Scope.**
- Run the upstream-sync recipe (`gauntlet/docs/upstream-sync.md`) for the v3 release. Hand-port the post-stage-8 baseline into `src/adapters/web/lib/chrome-ws-lib.js`.
- Update `src/adapters/web/adapter.ts`:
  - `tab` arguments become `pageSession` references. The focus-stack data structure (PRI-1439) stores `pageSession` objects instead of `wsUrl` strings.
  - `clearBrowserData(0)` (remote-Chrome path) becomes `context.dispose()` for the per-test BrowserContext that the adapter creates in `start()`.
  - `webAuthnOpenSession(0)` becomes `session.webAuthn.open(targetId)`. The driver shape stays, just the entry point differs.
  - `openObserverSession(0, handler)` becomes `session.observers.attach(pageSession, { categories: [...], onEvent: handler })`.
  - `screencast.ts` drops `onCdpEvent`/`offCdpEvent` calls in favor of `pageSession.onEvent`.
- Update `chrome-ws-lib-isolation.test.ts` to verify per-session isolation in flatten mode (browser WS is per-session, page sessions don't bleed).
- Update `gauntlet/docs/upstream-sync.md`: drop now-obsolete divergences, update sync state, bump fork-point and last-synced-HEAD.
- Linear ticket: Pliny's "two follow-ons" recommendation gets its third option — a real fix instead of the polling-loop / debug-flag bandages.

**Acceptance criteria.**
- [ ] All Gauntlet adapter tests pass: `bun test test/adapters/web/`.
- [ ] `chrome-ws-lib-isolation.test.ts` extended to assert flatten-mode isolation; passes.
- [ ] PRI-1517's `screenshot(opts.timeoutMs)` divergence is removed (the cap is no longer load-bearing). Smoke test: screenshot mid-navigation succeeds within 5s on a synthetic slow-page test.
- [ ] PRI-1439's side-trip-tab pattern handles a page-JS-spawned tab via `targets.waitForNew(...)`. **This is the test that validates the "Pliny's #1" claim.** Add a story-card that does `window.open` and asserts the agent can drive the popup.
- [ ] Spec §5.1 strategy 3 → strategy 4 migration: per-test setup time drops from seconds to <100ms in benchmark.
- [ ] PRI-1436's `chrome-ws-lib-isolation.test.ts` continues to pass — concurrent `gauntlet serve` runs still don't share state.
- [ ] `gauntlet batch` of N=10 stories runs to completion with the new isolation strategy. (Real workload smoke.)

**Dependencies.** Upstream Stage 8 merged.

**Risks.**
- **The adapter cutover is a big diff.** Migrating ~20 `chrome.X(0, ...)` call sites in `adapter.ts`, plus screencast.ts, plus passkey.ts is mechanical but error-prone. Mitigation: treat the adapter migration as its own stage (9.A); the sync of the lib is 9.B.
- **Gauntlet-only tests** that mock the chrome session at a flat-record-of-callable-methods level (search for `Record<string, any>` in test files) will need shape changes. Mitigation: a richer typed seam (see §5).

**Rollback.** Don't sync. Gauntlet stays on v2.0.0 of upstream indefinitely. The sync recipe is set up exactly for this — divergence accumulation is the cost.

**Effort:** L.

**Pause for review:** Yes — and the whole point is that Matt sees the migration land before authorizing the next batch run.

---

## 4. Divergence audit

For each of the six surviving Gauntlet divergences in `gauntlet/docs/upstream-sync.md`, classify:

| # | Divergence | Classification | Justification |
|---|---|---|---|
| 1 | `WebSocketClient` (standard WS API for Bun compat) | **(c) Survives as Gauntlet-only with a clean extension hook.** | Upstream uses Node's `http.request` + hand-rolled frame parser. Bun's standard `WebSocket` is the right API for Gauntlet. **Hook design (Stage 1):** `lib/browser-session.js` and `lib/page-session.js` accept an injected `WebSocketClient` constructor in their factory args. Gauntlet's fork passes its Bun-compat client; upstream defaults pass the Node-compat one. This retires the verbatim-preserve-this-class divergence and makes the Bun fork a 5-line config in the orchestrator. |
| 2 | `host-override.js` re-exports legacy constants | **(d) Needs rethinking.** | Upstream's `51d0d68` removed these; Gauntlet kept them deliberately to keep unmodified upstream code working. Once Gauntlet adopts the post-flatten lib (which has had ~6 months to migrate off the legacy snapshots), the re-exports become unnecessary. **Action:** remove in Stage 9 as part of the sync cleanup. |
| 3 | `pickFreePort` (replaces upstream `findAvailablePort` 9222 scan) | **(b) Survives as upstream contribution.** | The race-free `--remote-debugging-port=0 + DevToolsActivePort` pattern is *better* than upstream's scan. Already mentioned as a candidate upstream contribution in the Pliny review and the `library-comparison.md` note. **Action:** propose as an independent upstream PR (call it Stage 0; can run in parallel with Stages 1-4 since it touches an unrelated file). |
| 4 | `parseContains` + `:contains('text')` selector translation | **(c) Survives as Gauntlet-only with a clean extension hook.** | LLM agents emit `:contains` selectors as a jQuery convention; Gauntlet translates. Upstream doesn't need this — the use case is agent-specific. **Hook design:** `lib/element-selector.js`'s `getElementSelector(selector)` should accept an optional `selectorTranslators` array. Each translator is a `(selector) => translatedSelector | null` function. Gauntlet's fork registers `parseContains` as a translator. Retires the divergence to a fork-side configuration. |
| 5 | Appended Gauntlet-only functions: `clearBrowserData`, `webAuthnOpenSession`, `openObserverSession`, `onCdpEvent`/`offCdpEvent` | **Mostly (a) and (b).** Per-function: |
| | • `clearBrowserData` | (a) becomes unnecessary | Replaced by BrowserContext disposal (Stage 3 / Stage 9). The remote-Chrome case stops needing best-effort CDP-level reset because contexts dispose atomically. |
| | • `webAuthnOpenSession` | (b) survives as upstream contribution | Stage 6 lands the canonical version of this in upstream as `session.webAuthn.open`. Gauntlet's becomes a one-line call-site change. |
| | • `openObserverSession` | (b) survives as upstream contribution | Stage 7 generalizes it as `session.observers.attach(pageSession, {categories, onEvent})`. The four event categories (console, exception, log, network-ws) become defaults in upstream's API. |
| | • `onCdpEvent` / `offCdpEvent` | (a) becomes unnecessary | Replaced by `pageSession.onEvent(handler)` in Stage 7. The hand-rolled `conn.eventHandler` pattern in `lib/cdp-connection.js`'s pooled connection retires with Stage 8. |
| 6 | `screenshot` accepts `opts.timeoutMs` (PRI-1517) | **(a) becomes unnecessary at the architectural level — but (c) survives the API.** | Stage 5 fixes the underlying screenshot-during-nav wedge by routing screenshot and navigate through different sessionIds. The `opts.timeoutMs` parameter survives as a useful per-call-timeout knob — upstream may want it for unrelated reasons. **Action:** propose as an independent upstream PR after Stage 5 lands (any-stage-after-5 is fine; not a sequencing dependency). |

**Plus three undocumented divergences I found while writing this plan** (worth noting for `upstream-sync.md` — flag for Matt):
- `GAUNTLET_CHROME_VERBOSE` env-flag silencing per-run lifecycle banners (chrome-ws-lib.js:48). **Classification: (c).** Hook design: factory accepts `verbose` flag; default true upstream, defaults false in the Gauntlet fork's call to `createSession({verbose: false})`.
- Default profile name `'gauntlet'` (chrome-ws-lib.js:2428, 2445, 2451) instead of upstream's `'superpowers-chrome'`. **Classification: (c).** Already configurable via `setProfileName`; the divergence is just the default. Pass `profileName: 'gauntlet'` in the Gauntlet fork's `createSession` call.
- `setCookies` Gauntlet-only function (chrome-ws-lib.js:3240) — not noted in upstream-sync.md's divergence list. **Classification: (b).** Useful upstream — agentic scenarios need cookie installation. Propose as upstream PR alongside Stage 4 or later.

---

## 5. Extension-hook design

Goal: Gauntlet's fork-only features ride on supported upstream APIs, not monkey-patches on `lib/*.js` internals. Concrete shapes:

### 5.1 Constructor-injected dependencies

```js
// upstream's lib/chrome-ws-lib.js
function createSession(opts = {}) {
  const {
    host, port,
    profileName = 'superpowers-chrome',
    verbose = true,
    WebSocketClient = require('./lib/websocket-client').WebSocketClient,  // Bun-fork override
    selectorTranslators = [],   // Gauntlet's parseContains plugs in here
  } = opts;
  // ...
}
```

This retires divergences 1, 4, plus the two undocumented ones (banner-silence, profile-name default). Each fork-side need becomes a constructor argument.

### 5.2 Page-session event listener registration (Stage 7)

```js
// pageSession is what Stage 5's attachPage returns
const pageSession = await session.targets.attachPage(targetId);

// Register a typed event listener (Stage 7 API)
pageSession.onEvent(handler);                          // all events on this session
pageSession.onEvent('Page.loadEventFired', handler);   // a single event
pageSession.onEvent(e => e.method.startsWith('Network.'), handler);  // predicate
```

Gauntlet's screencast retires `onCdpEvent`/`offCdpEvent` and uses this directly.

### 5.3 Observer subscription as a first-class API (Stage 7)

```js
// upstream lib API
const observer = await session.observers.attach(pageSession, {
  categories: ['console', 'exception', 'log', 'network-ws'],
  onEvent: (category, payload) => { /* ... */ },
});
// observer.close() to tear down
```

Direct port of `openObserverSession` to upstream. Same four categories, same callback shape, same close() semantics. Gauntlet's `openObserverSession` divergence retires.

### 5.4 WebAuthn isolated session (Stage 6)

```js
// upstream lib API
const wa = await session.webAuthn.open(targetId);  // pinned per-target-WS, NOT routed via browser WS
const authId = await wa.addVirtualAuthenticator(options);
await wa.addCredential(authId, credential);
// wa.close() disposes the socket; Chrome auto-disposes the authenticator
```

Direct port of `webAuthnOpenSession`. Gauntlet's `passkey.ts` migrates trivially.

### 5.5 Screencast hooks (already supported via §5.2)

Today Gauntlet's screencast does:
```js
await chrome.onCdpEvent(tabIndex, handler);
await chrome.sendCdpCommand(wsUrl, 'Page.startScreencast', {...});
```

Post-migration:
```js
const pageSession = await session.targets.attachPage(targetId);
pageSession.onEvent('Page.screencastFrame', handler);
await pageSession.send('Page.startScreencast', {...});
```

No new upstream API needed — screencast just uses the page-session API. Gauntlet's `streaming/screencast.ts` becomes ~10 lines shorter and stops poking `chrome.onCdpEvent`/`chrome.sendCdpCommand`.

### 5.6 BrowserContext-aware tools (Stage 9 adapter migration)

Gauntlet's `WebAdapter.start()` should be:

```ts
const session = createSession({...});
await session.startChrome({...});

// One BrowserContext per WebAdapter instance — replaces per-launch profile dir
this.context = await session.createBrowserContext({ disposeOnDetach: true });
this.pageSession = await this.context.createPage(target);
// ...
// teardown:
await this.context.dispose();   // millisecond-scale, atomic
```

Replaces spec §5.1 strategy 3 with strategy 4. The remote-Chrome path (where Gauntlet doesn't own the profile dir) becomes the same code: BrowserContext works the same against any Chrome.

### 5.7 Typed seam for tests (TS side)

The current `ChromeSession = Record<string, any>` is intentionally loose to mirror the JS lib's `any` shape. Stage 9 should ship a real TS type (in `gauntlet/src/adapters/web/types.ts` or upstream as a `.d.ts` if upstream wants types):

```ts
export interface ChromeSession {
  targets: TargetsApi;
  createBrowserContext(opts?): Promise<BrowserContext>;
  webAuthn: WebAuthnApi;
  observers: ObserversApi;
  startChrome(opts): Promise<void>;
  killChrome(): Promise<void>;
  setViewport(target, vp): Promise<void>;
  getTabs(): Promise<Tab[]>;
  // ... etc
}
```

Tests that currently mock `ChromeSession` via `Proxy({}, { get: ... })` (`side-trip-tabs-plan.md` lines 9-25) get a real type to assert against, which prevents shape regressions.

---

## 6. Failure-mode policy for the executor

For each stage, when a failure occurs, the executor's policy:

### General rules (apply unless overridden per-stage)

- **Test fails on a stage's acceptance criteria:** stop, do not move to the next stage. Open a thinking-out-loud comment on the upstream PR if it's already up; otherwise, note in `gauntlet/docs/upstream-sync.md` and ping Matt.
- **Upstream review pushback (substantive — Jesse asks for design changes):** stop. Update the plan file (this doc) with the new shape, get re-authorized by Matt before re-pushing.
- **Upstream review pushback (cosmetic — naming, file layout, doc tweaks):** apply, push, do not stop.
- **Unanticipated complexity (a stage is taking >2× the sized effort):** stop, ping Matt with a "stage X is bigger than scoped" message. Do not silently expand scope.
- **A stage's PR sits unmerged for >7 calendar days with no maintainer response:** stop. Don't open dependent PRs; ping Matt to escalate or pivot to "fork is the temporary home of this stage."
- **A test for an earlier stage starts failing during a later stage's work:** stop. The earlier stage's regression gate exists exactly for this reason.

### Per-stage overrides

| Stage | If… | Then… |
|---|---|---|
| 1 | Stage 1's tests can't reach a real Chrome (CI lacks Chrome) | Skip, leave a TODO. The smoke suite is gated already in upstream — same gate applies. |
| 2 | `Target.targetCreated` for a `window.open` doesn't fire under flatten mode in upstream's headless Chrome | **STOP. Investigate.** This is the load-bearing test of the whole migration. If it doesn't work, the migration's premise is wrong. Probably a Chrome-version issue; pin and document. |
| 3 | BrowserContext + `proxyServer` fails on macOS but works on Linux (or vice versa) | Document the platform-specific bug, ship without proxy support, note as known-issue in the PR. |
| 4 | Stage 4 ships the bridge but Gauntlet's adapter test suite (post-sync via Stage 9 mini-sync) reveals a regression | Stop. **This is a designated honest stop-point.** §8 covers when to stay here permanently. |
| 5 | Stage 5's `pageSession-concurrency.test.js` passes but a real `gauntlet batch` run shows the screenshot-during-nav fix doesn't actually trigger the expected speedup | Stop. The architectural claim is the load-bearing one. Failing here means the failure mode wasn't actually about session/queue head-of-line — possibly Chrome's render thread is the real bottleneck. Re-evaluate. |
| 5 | Stage 5 lands but breaks the MCP server because some action library missed a code-path update | Don't stop the upstream PR; fix the missed library, push as a same-PR follow-up commit. |
| 6 | WebAuthn test in Stage 6 hangs (state-isolation test inconclusive) | Stop. WebAuthn is high-value for Gauntlet's auth flows; an inconclusive test is worse than no test. |
| 7 | Refactoring `lib/navigation.js` reintroduces the 30s-hang regression that upstream's `f83a373` fixed | Stop. Revert. The second-WS pattern stays. Stage 7's value drops, not zero. |
| 8 | Stage 8 v3.0.0 breaks any external consumer (issue reports come in) | Don't ship Stage 8 without the deprecation window from Stage 8's plan. If pressure to ship: stay on v2.X with both paths. Stage 8 is the lowest-priority stage in this plan — delay is fine. |
| 9 | Adapter migration breaks the side-trip-tabs (PRI-1439) regression | Stop. The whole point of Stage 2 + Stage 9 is to make side-trip tabs more robust. Regressing them means we've done the migration wrong. |

### Things the executor explicitly should NOT do without Matt

- Open a Stage X PR before Stage X-1 is merged (or Matt explicitly authorizes parallelism).
- Squash the stage list into fewer, bigger PRs ("oh, Stages 1-3 are all bridge stuff, let me one-shot it"). The staged review structure is the load-bearing safety net.
- Bypass `--no-verify`, `--no-gpg-sign`, or `gh` PR review settings.
- Force-push to anything in `obra/superpowers-chrome` or to Gauntlet's `main`.
- Run `git reset --hard`, `git push --force`, or `terraform destroy`-equivalents at any point.

---

## 7. Order-of-operations recommendation

Recommended order:

```
Stage 0 (parallel, optional): pickFreePort upstream PR
       ↓
Stage 1: createBrowserSession primitive
       ↓
Stage 2: targets API
       ↓
Stage 3: createBrowserContext API
       ↓
Stage 4: bridge wired into createSession()  ←  STOP-POINT #1
       ↓                                       (Gauntlet syncs and adopts
Stage 5: page sessions over browser WS         BrowserContext + targets;
       ↓                                       per-target-WS retained.
Stage 6: WebAuthn explicit isolation           Migration may end here.)
       ↓
Stage 7: page-session event streaming API   ←  STOP-POINT #2
       ↓                                       (Gauntlet adopts page sessions;
Stage 8: retire per-target-WS pool             observer/screencast clean up;
       ↓                                       per-target-WS pool retained
Stage 9: Gauntlet sync + adapter migration     for compatibility.)
```

**Justification for the order:**
- **1 → 2 → 3** are tightly coupled — each builds on the previous. No reordering is sensible.
- **4** is the bridge-wired-up shipping stage. It must follow 3 because contexts are exposed on the bridge.
- **5** is the cutover. **It must follow 4** because Stage 5's regression tests rely on having the bridge's targets-list to attach against.
- **6, 7** can be reordered (both follow 5). Recommended: 6 first because WebAuthn is higher-stakes (auth flows are load-bearing) and Stage 7 has more refactor surface.
- **8** must follow 5, 6, 7 — it removes the per-target-WS path that all three preserve.
- **9** follows 8. It must wait for upstream to be at the v3 state we adopt.

**Stage 0 is optional and parallel** — `pickFreePort` is unrelated to the routing-model migration. Useful as a cheap PR to warm up the review channel; can land before Stage 1, alongside Stage 1, or anytime later.

**Don't reorder stages for "easier first"** — the executor will be tempted to cherry-pick low-hanging fruit. The dependency graph is correct as written; cheap stages first means more rebase work later.

---

## 8. Honest stop-points

Two valid end-states, both better than the status quo:

### Stop-point #1 — after Stage 4: "browser-WS bridge + per-target-WS retained"

**What you have:**
- Live tab/popup discovery via `session.targets.*`.
- BrowserContext isolation via `session.createBrowserContext`.
- All existing per-target-WS code paths intact and working.
- Gauntlet has migrated spec §5.1 strategy 3 → strategy 4, retired `clearBrowserData`'s remote-Chrome divergence, fixed PRI-1439's structural blind spot.

**What you don't have:**
- Page sessions on the browser WS. Screenshot still wedges behind navigation (PRI-1517's mitigation still load-bearing). Observer pattern still hand-rolled.

**When to stop here:**
- Upstream's appetite for the cutover (Stage 5+) is low.
- Gauntlet's test corpus shows that PRI-1517's screenshot wedge is rare in practice.
- Concurrency demands stop growing (e.g. team decides 10 concurrent stories is the limit, not 100).

**Mini-Stage-9 if stopping here:** sync the bridge into Gauntlet, adopt BrowserContext, retire `clearBrowserData`-divergence and `--user-data-dir`-per-launch logic. ~half of Stage 9's scope.

This is the "library-comparison.md says it's defensible to stop here" end state. Matt's call.

### Stop-point #2 — after Stage 7: "flatten mode is canonical, per-target-WS pool deprecated"

**What you have:**
- Everything from Stop-point #1.
- Page sessions over the browser WS — screenshot/nav wedge fixed.
- Observer pattern is a supported callback API.
- WebAuthn isolation is explicit and documented.
- Gauntlet's `screencast.ts`, `passkey.ts`, observer wiring all use upstream-supported APIs.

**What you don't have:**
- Per-target-WS pool removal (Stage 8). The codebase still ships both paths.

**When to stop here:**
- Stage 8 is breaking; upstream's v3 release isn't appetizing.
- The per-target-WS pool's continued presence costs nothing operational — just a few hundred LOC of dead code.

**This is the "complete the architecture, don't bother with the cleanup" end state.** All ROI captured, none of Stage 8's risk.

### Don't stop before Stage 4

- Stages 1-3 are primitives that aren't useful on their own. Shipping them unwired into `createSession()` is a "library that you can't actually use" experience.
- Stage 4 is the first PR that gives Gauntlet (and upstream's MCP server) actual capability gain.

---

## 9. Process notes for the executor

- **Plan execution sub-skill:** use `superpowers:executing-plans`.
- **Linear:** there should be one Linear ticket per upstream PR stage (Stages 0-9). PRI-numbered or otherwise — Matt's call. Use the `primeradiant-ops:linear-ticket-lifecycle` skill before kicking off each stage. Move tickets to **In Review** when the upstream PR is opened, not when it's merged — Done is not the implementer's call.
- **Branching:** in `obra/superpowers-chrome`, work on branches named `mhat/flatten-stage-N-<short-name>`. Don't squash stages onto one branch — each stage is one PR.
- **Gauntlet sync:** run the sync recipe from `docs/upstream-sync.md` between stages 4 and 5 (mini-sync) and after stage 8 (full sync). Don't sync per-stage — that's noise.
- **Direct-merge convention:** Gauntlet's main is direct-fast-forward. Upstream PRs follow upstream's own conventions (Jesse's PR review).
- **CHANGELOG hygiene:** every upstream PR updates upstream's `CHANGELOG.md`. Mirror the entry in `gauntlet/docs/upstream-sync.md`'s "Last synced upstream HEAD" section after the sync.
- **Honest commit messages:** the executor is a Bob. Matt has zero tolerance for commit messages that overstate what shipped. "Stage 5: page sessions over browser WS — partial; navigation refactor deferred" is fine. "Stage 5: complete" when only half of acceptance criteria pass is not.

---

## 10. What's deliberately out of scope for this plan

- **Pipe transport (`--remote-debugging-pipe`).** Useful for sandboxed child-launch but not justified by Gauntlet's use case. Defer indefinitely.
- **`tab` target type** (Playwright's cross-process-nav-survival primitive). Genuinely interesting; out of scope here. May be Stage 10+ in a future plan.
- **CDP transcript dump** (Pliny's "two follow-ons" #2). Should ship; can ship at any point as a parallel PR. Not in this dependency chain.
- **Replacing `connectionPool`'s pooling discipline at all.** The pool retires in Stage 8, doesn't change shape before then.
- **Migrating Gauntlet to a different CDP library entirely** (Puppeteer, Playwright). The whole point of this plan is to make the existing fork shape better.
- **Upstream test infrastructure changes** beyond what's needed for new test files. Don't redo `npm test`, don't reorganize `mcp/`'s test layout, don't touch the bundle drift detection.

---

## Appendix: skim-readable summary

| # | Stage | Effort | What ships | Pause for review |
|---|---|---|---|---|
| 0 | `pickFreePort` upstream | S | Replaces upstream's 9222-scan with port-0 + DevToolsActivePort | Yes |
| 1 | Browser-level WS primitive | S | `lib/browser-session.js`; no behavior change for callers | Yes |
| 2 | Targets API | S | `session.targets.{onCreated, waitForNew, list}` | Yes |
| 3 | BrowserContext API | M | `session.createBrowserContext({proxyServer})` | Yes |
| 4 | Bridge wired into createSession | M | `session.targets`, `session.createBrowserContext` exposed; **STOP-POINT #1** | Yes |
| 5 | Page sessions over browser WS | L | `Target.attachToTarget(flatten:true)` for all page actions | Yes (highest-risk) |
| 6 | WebAuthn explicit isolation | S | `session.webAuthn.open(targetId)` | Yes |
| 7 | Page-session event streaming | M | `pageSession.onEvent(...)`, `session.observers.attach(...)`; **STOP-POINT #2** | Yes |
| 8 | Retire per-target-WS pool | M | v3.0.0; legacy `wsUrl`-flavored API removed | Yes (Jesse v3 sign-off) |
| 9 | Gauntlet sync + adapter migration | L | Adapter call shape updated; spec §5.1 strategy 4; PRI-1439 structural fix; PRI-1517 mitigation removed | Yes |

**Sequencing**: 0 (parallel) | 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9.

**Gauntlet adopts at**: stop-point #1 (mini-Stage-9 sync), stop-point #2 (mid-Stage-9 sync), or after Stage 8 (full Stage 9). The plan's preference is "go all the way" — but stop-points #1 and #2 are honestly defensible.

**The single sentence the executor should hold in their head:** *Stages 1-4 are additive bridge work; Stage 5 is the architectural cutover; everything after is cleanup.*
