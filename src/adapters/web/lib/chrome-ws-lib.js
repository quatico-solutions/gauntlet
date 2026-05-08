/**
 * Chrome WebSocket Library — Core CDP automation functions
 *
 * Forked from https://github.com/obra/superpowers-chrome and adapted for
 * Gauntlet (Bun runtime, multiple concurrent sessions, custom extensions).
 *
 * This is the orchestrator: a thin wiring layer over `lib/*.js` modules.
 * Per `docs/upstream-sync.md`, the structural layout mirrors upstream HEAD
 * `a9e2d0c`'s 234-line orchestrator. Search for "GAUNTLET DIVERGENCE" in
 * this file (and across `src/adapters/web/lib/`) to find the regions a
 * future upstream sync needs to preserve.
 *
 * The browser-WS bridge (`lib/browser-session.js`, `lib/browser-bridge.js`,
 * `lib/cdp-router.js`, `lib/page-session.js`) is the load-bearing addition:
 * one CDP WebSocket to /devtools/browser/<id> serves all page sessions via
 * `Target.attachToTarget({flatten:true})` + sessionId routing. Page-action
 * commands ride that single WS instead of per-page sockets. See
 * `docs/superpowers/specs/2026-05-08-chrome-ws-lib-flatten-mode-design.md`.
 */

const { getElementSelector, getElementSelectorAll, parseContains } = require('./element-selector');
const { KEY_DEFINITIONS } = require('./key-definitions');
const { generateHtmlDiff } = require('./html-diff');
const { createState } = require('./session-state');
const { attachCookies } = require('./cookies');
const { attachViewport } = require('./viewport');
const { attachEvaluation } = require('./evaluation');
const { attachMouse } = require('./mouse');
const { attachChromeProcess } = require('./chrome-process');
const { attachCapture } = require('./capture');
const { attachNavigation } = require('./navigation');
const { attachKeyboardInput } = require('./keyboard-input');
const { attachExtraction } = require('./extraction');
const { attachScreenshot } = require('./screenshot');
const { attachTabs } = require('./tabs');
const { attachFileUpload } = require('./file-upload');
// Note: upstream's cdp-connection.js (per-page WS pool) is intentionally
// absent here — page-action commands ride pageSession.send via the
// browser-WS, not a per-page pool.
const { attachConsoleLogging } = require('./console-logging');
const { attachSelectOption } = require('./select-option');
const { WebSocketClient } = require('./websocket-client');
const { createBrowserSession } = require('./browser-session');
const { attachBrowserBridge } = require('./browser-bridge');
const {
  getXdgCacheHome,
  getChromeProfileDir,
  getProfileMetaPath,
  readProfileMeta,
  writeProfileMeta,
  clearProfileMeta,
  buildChromeArgs,
} = require('./chrome-launcher-helpers');

// Module-level registry of active session-cleanup callbacks.
// Per-session initializeSession adds its bound cleanup to the set;
// cleanupSession removes itself when it runs.
//
// Process exit handlers are registered exactly once for the whole module
// (not per session), so multiple ChromeSession instances in one process
// don't accumulate N×3 handlers. Hand-ported from upstream 2f28325.
const activeCleanups = new Set();
let processHandlersRegistered = false;

function ensureProcessHandlersRegistered() {
  if (processHandlersRegistered) return;
  processHandlersRegistered = true;
  const runAll = () => { for (const fn of activeCleanups) fn(); };
  process.on('exit', runAll);
  process.on('SIGINT', () => { runAll(); process.exit(0); });
  process.on('SIGTERM', () => { runAll(); process.exit(0); });
}

/**
 * Build a fresh Chrome session — a state-bag scoped to a single Chrome target.
 *
 * `createSession({ host, port })` returns a fresh instance with private state
 * and methods bound to that state. Two instances do not share a connection
 * pool, console-message map, profile, Chrome process, or host-override —
 * mutating one (e.g. setProfileName, startChrome) has no effect on the other.
 *
 * Pass `host`/`port` to seed the host-override; omit them to seed from the
 * `CHROME_WS_HOST` / `CHROME_WS_PORT` env vars.
 */
function createSession({ host, port } = {}) {
  const state = createState({ host, port });

  // ===== Tabs / chromeHttp / resolveWsUrl =====
  const tabsApi = attachTabs({ state });
  const { chromeHttp, resolveWsUrl, getTabs, newTab, closeTab } = tabsApi;

  // ===== Browser-WS bridge =====
  // Lazy-opened on first targets/context/page-session access, not at
  // createSession() time. The remote-Chrome path skips startChrome()
  // entirely (see `adapter.ts` `if (!this.remote)`), so eager-open in
  // startChrome wouldn't fire there. Lazy-open serves both modes with
  // one code path.
  let _browser = null;
  let _bridge = null;

  async function _ensureBridge() {
    if (_bridge) return _bridge;
    if (!_browser) {
      _browser = createBrowserSession({
        host: state.hostOverride.getHost(),
        port: state.activePort,
        rewriteWsUrl: state.rewriteWsUrl,
        chromeHttp,
      });
    }
    _bridge = await attachBrowserBridge({
      browser: _browser,
      host: state.hostOverride.getHost(),
      port: state.activePort,
      rewriteWsUrl: state.rewriteWsUrl,
    });
    return _bridge;
  }

  async function _closeBridge() {
    if (_browser) {
      try { await _browser.close(); } catch { /* best-effort */ }
      _browser = null;
      _bridge = null;
    }
  }

  // Wrappers exposed on the public session.
  const targets = {
    async list()                    { return (await _ensureBridge()).targets.list(); },
    async onCreated(fn)             { return (await _ensureBridge()).targets.onCreated(fn); },
    async onDestroyed(fn)           { return (await _ensureBridge()).targets.onDestroyed(fn); },
    async waitForNew(predicate, opts) { return (await _ensureBridge()).targets.waitForNew(predicate, opts); },
  };

  async function createBrowserContext(opts) {
    return (await _ensureBridge()).createBrowserContext(opts);
  }

  /**
   * Attach a page session to an existing target. Returns
   * `{sessionId, targetId, send, onEvent, waitForEvent, enableDomain, detach}`.
   * Page sessions ride the browser-WS via `Target.attachToTarget({flatten:true})`
   * — no per-page WebSocket, no per-page WS-drop race.
   */
  async function attachPageSession(targetId) {
    return (await _ensureBridge()).attachPageSession(targetId);
  }

  // Wire the lazy attacher into tabs.js so tab handles returned by
  // getTabs() / newTab() carry a `getPageSession()` thunk. The thunk goes
  // through _ensureBridge → bridge.attachPageSession at call time, so
  // there's no construction-order dependency between tabs and the bridge.
  tabsApi.setPageSessionAttacher((targetId) => attachPageSession(targetId));

  /**
   * Action-lib argument resolver.
   *
   * Accepts the legacy shapes that tools/tests use today (numeric tab index,
   * `ws://...` URL, numeric string) AND the new shape (an existing
   * pageSession object) and returns the corresponding pageSession.
   *
   * Action libs that haven't yet migrated to take `pageSession` directly
   * still call `resolveWsUrl` for the legacy path. Once all action libs
   * are migrated, callers can pass a pageSession through and skip the
   * argument-shape gymnastics altogether.
   */
  async function getPageSession(arg) {
    // Already a pageSession? Pass through.
    if (arg && typeof arg.send === 'function' && arg.sessionId) {
      return arg;
    }

    // Numeric or numeric-string index — index into the current tabs list.
    if (typeof arg === 'number' || (typeof arg === 'string' && /^\d+$/.test(arg))) {
      const idx = typeof arg === 'number' ? arg : parseInt(arg, 10);
      const allTabs = await getTabs();
      const pageTabs = allTabs.filter((t) => t.type === 'page');

      // Auto-create a tab if none exist (matches the legacy auto-start behaviour
      // of resolveWsUrl — tools shouldn't have to special-case fresh Chrome).
      if (pageTabs.length === 0) {
        const newTabInfo = await newTab();
        if (!newTabInfo || !newTabInfo.getPageSession) {
          throw new Error('getPageSession: newTab failed to return a tab handle');
        }
        return newTabInfo.getPageSession();
      }

      if (!pageTabs[idx]) throw new Error(`getPageSession: no tab at index ${idx} (have ${pageTabs.length})`);
      return pageTabs[idx].getPageSession();
    }

    // ws:// URL — find the matching tab.
    if (typeof arg === 'string' && arg.startsWith('ws://')) {
      const allTabs = await getTabs();
      const rewritten = state.rewriteWsUrl(arg, state.hostOverride.getHost(), state.activePort);
      const tab = allTabs.find((t) => t.webSocketDebuggerUrl === rewritten || t.webSocketDebuggerUrl === arg);
      if (!tab) throw new Error(`getPageSession: no tab found for ${arg}`);
      return tab.getPageSession();
    }

    throw new Error(`getPageSession: unsupported arg type: ${typeof arg}`);
  }

  // ===== Action libs =====
  const { click, hover, drag, mouseMove, scroll, doubleClick, rightClick } =
    attachMouse({ getPageSession: (arg) => getPageSession(arg) });

  const { keyboardPress, fill, humanType } =
    attachKeyboardInput({ state, getPageSession: (arg) => getPageSession(arg), click });

  const { fileUpload } = attachFileUpload({ getPageSession: (arg) => getPageSession(arg) });

  const { selectOption } = attachSelectOption({ getPageSession: (arg) => getPageSession(arg) });

  // attachEvaluation must be after attachPageSession + getPageSession are
  // defined since action libs now consume getPageSession. Hoisted via
  // const-binding-after-function-decl trick: getPageSession is defined just
  // below, so the closure capture works.
  // (Note: `getPageSession` is referenced lazily inside the helpers — the
  // function value is read at call time, not destructure time. As long as
  // we name-resolve at call time we're fine.)
  const { evaluate, evaluateJson, evaluateRaw } = attachEvaluation({ getPageSession: (arg) => getPageSession(arg) });

  const { extractText, getHtml, getAttribute } = attachExtraction({ getPageSession: (arg) => getPageSession(arg) });

  const { screenshot } = attachScreenshot({ getPageSession: (arg) => getPageSession(arg) });

  const { startChrome, killChrome, showBrowser, hideBrowser, getBrowserMode, getChromePid, getActivePort, getProfileName, setProfileName } =
    attachChromeProcess({ state, chromeHttp, getTabs, newTab, closeBridge: _closeBridge });

  const { enableConsoleLogging, getConsoleMessages, clearConsoleMessages } =
    attachConsoleLogging({ state, getPageSession: (arg) => getPageSession(arg) });

  const {
    initializeSession,
    cleanupSession,
    createCapturePrefix,
    generateDomSummary,
    getPageSize,
    generateMarkdown,
    capturePageArtifacts,
    captureActionWithDiff,
    clickWithCapture,
    fillWithCapture,
    selectOptionWithCapture,
    evaluateWithCapture,
  } = attachCapture({
    state,
    getPageSession: (arg) => getPageSession(arg),
    getHtml,
    screenshot,
    actions: { click, fill, selectOption, evaluate },
  });

  const { navigate, waitForElement, waitForText } =
    attachNavigation({ state, getPageSession: (arg) => getPageSession(arg), capturePageArtifacts, evaluate });

  const { setViewport, clearViewport, getViewport } = attachViewport({ getPageSession: (arg) => getPageSession(arg) });
  const { clearCookies } = attachCookies({ getPageSession: (arg) => getPageSession(arg) });

  // ===== GAUNTLET DIVERGENCE START: Gauntlet-only additions =====
  // These functions exist only in Gauntlet. New upstream functions must NOT
  // land inside this block — put them above it, in roughly the same position
  // as their upstream counterpart, so the orchestrator stays comparable to
  // upstream's chrome-ws-lib.js.
  //
  // Contents:
  //   - setCookies(tab, cookies): per-cookie Network.setCookie installer
  //     with partial-failure aggregation (PRI-1296 / cookies install spec).
  //   - clearBrowserData(tab): best-effort CDP-level state reset for the
  //     remote-Chrome case where we cannot delete the --user-data-dir
  //     ourselves.
  //   - webAuthnOpenSession(tab): pinned CDP session for the passkey tool
  //     (WebAuthn domain is per-target/per-socket — see comment on the function).
  //   - openObserverSession(tab, onEvent): streams console, exception,
  //     log, and network-ws events to EvidenceLogger.
  //   - onCdpEvent / offCdpEvent: raw CDP event subscription used by
  //     screencast streaming.

  /**
   * Install cookies into the browser, one CDP call per entry. Returns a
   * per-cookie result array so the caller (the install_cookies tool) can
   * report partial success to the agent — Chrome silently rejects cookies
   * for reasons it does not surface (third-party blocking, schemeful same-
   * site mismatches, sourcePort/sourceScheme cross-checks), and the agent
   * needs to learn which entries got in.
   *
   * Why singular `Network.setCookie` (not `setCookies`): the singular form
   * returns `{ success: boolean }` per call. The plural form swallows the
   * per-cookie status and returns nothing useful for partial-failure
   * diagnostics.
   *
   * Aggregation rules:
   *  - sendCdpCommand throws → success: false, errorReason = thrown message.
   *  - response.success === false → success: false, errorReason =
   *    "chrome rejected cookie (no detail provided)".
   *  - response.success === true → success: true.
   *
   * Never throws on partial failure; returns the array unconditionally.
   */
  async function setCookies(tabIndexOrPageSession, cookies) {
    const ps = await getPageSession(tabIndexOrPageSession);
    const results = [];
    for (const cookie of cookies) {
      try {
        const response = await ps.send('Network.setCookie', cookie);
        if (response && response.success === true) {
          results.push({ name: cookie.name, success: true });
        } else {
          results.push({
            name: cookie.name,
            success: false,
            errorReason: 'chrome rejected cookie (no detail provided)',
          });
        }
      } catch (err) {
        results.push({
          name: cookie.name,
          success: false,
          errorReason: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return results;
  }

  /**
   * Best-effort reset of the given tab's browser state for the
   * remote-Chrome case where we cannot delete the `--user-data-dir`
   * ourselves. Cookies, cache, and the current origin's storage are
   * cleared. Silently swallows errors — a thrown error from any sub-step
   * is not fatal.
   */
  async function clearBrowserData(tab) {
    try {
      const ps = await getPageSession(tab);
      try { await ps.send('Network.clearBrowserCookies', {}); } catch { /* best-effort */ }
      try { await ps.send('Network.clearBrowserCache', {}); } catch { /* best-effort */ }
      // Storage.clearDataForOrigin needs an origin — use the current page's
      // origin if it has one, else no-op.
      try {
        const origin = await evaluate(ps, 'location.origin');
        if (origin && typeof origin === 'string' && origin !== 'null') {
          await ps.send('Storage.clearDataForOrigin', {
            origin,
            storageTypes: 'all',
          });
        }
      } catch { /* best-effort */ }
    } catch { /* best-effort */ }
  }

  // =============================================================================
  // WebAuthn — virtual authenticator support (for installing test passkeys)
  // =============================================================================
  // CDP's WebAuthn domain is scoped per-target (per-page) — authenticator
  // state lives on the transport, not the protocol session. We open a
  // dedicated per-target WebSocket via `webAuthnOpenSession` rather than
  // routing through a flatten-mode page session, so each test's authenticator
  // state is isolated by construction. Per-socket pinning is a stronger
  // guarantee than CDP requires (per-target would suffice), but it's
  // structurally simple and matches the lifetime model.

  async function webAuthnOpenSession(tabIndexOrWsUrl) {
    const wsUrl = await resolveWsUrl(tabIndexOrWsUrl);
    const ws = new WebSocketClient(wsUrl);
    const pendingRequests = new Map();
    let messageIdCounter = 1;
    let closed = false;

    ws.on('message', (msg) => {
      try {
        const data = JSON.parse(msg);
        if (data.id !== undefined) {
          const pending = pendingRequests.get(data.id);
          if (pending) {
            clearTimeout(pending.timeout);
            pendingRequests.delete(data.id);
            if (data.error) {
              pending.reject(new Error(data.error.message || JSON.stringify(data.error)));
            } else {
              pending.resolve(data.result);
            }
          }
        }
      } catch (e) {
        console.error('Error processing WebAuthn session message:', e);
      }
    });

    ws.on('close', () => {
      closed = true;
      for (const [, pending] of pendingRequests) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('WebAuthn session closed'));
      }
      pendingRequests.clear();
    });

    await ws.connect();

    const sendOnThisSocket = (method, params = {}, timeout = 30000) => {
      if (closed) return Promise.reject(new Error('WebAuthn session closed'));
      const id = messageIdCounter++;
      return new Promise((resolve, reject) => {
        const timeoutHandle = setTimeout(() => {
          pendingRequests.delete(id);
          reject(new Error(`CDP command timeout: ${method}`));
        }, timeout);
        pendingRequests.set(id, { resolve, reject, timeout: timeoutHandle });
        ws.send(JSON.stringify({ id, method, params }));
      });
    };

    // Enable once at session creation. Everything downstream rides this socket.
    await sendOnThisSocket('WebAuthn.enable', { enableUI: false });

    return {
      async addVirtualAuthenticator(options) {
        const result = await sendOnThisSocket('WebAuthn.addVirtualAuthenticator', { options });
        return result.authenticatorId;
      },
      async addCredential(authenticatorId, credential) {
        return await sendOnThisSocket('WebAuthn.addCredential', { authenticatorId, credential });
      },
      async removeVirtualAuthenticator(authenticatorId) {
        return await sendOnThisSocket('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
      },
      close() {
        if (closed) return;
        closed = true;
        ws.close();
      },
      isClosed() {
        return closed;
      },
    };
  }

  // =============================================================================
  // Observer session — stream browser events to a handler for evidence logging
  // =============================================================================
  // Opens a dedicated WebSocket outside the pool and enables Runtime, Log, and
  // Network domains. The caller supplies an `onEvent(category, payload)`
  // handler. Returns `{ close() }`.

  async function openObserverSession(tabIndexOrWsUrl, onEvent) {
    const wsUrl = await resolveWsUrl(tabIndexOrWsUrl);
    const ws = new WebSocketClient(wsUrl);
    const pendingRequests = new Map();
    let messageIdCounter = 1;
    let closed = false;

    ws.on('message', (msg) => {
      try {
        const data = JSON.parse(msg);

        // Command responses
        if (data.id !== undefined) {
          const pending = pendingRequests.get(data.id);
          if (pending) {
            clearTimeout(pending.timeout);
            pendingRequests.delete(data.id);
            if (data.error) {
              pending.reject(new Error(data.error.message || JSON.stringify(data.error)));
            } else {
              pending.resolve(data.result);
            }
          }
          return;
        }

        // Events
        if (!data.method) return;
        const method = data.method;
        const params = data.params || {};

        if (method === 'Runtime.consoleAPICalled') {
          const text = (params.args || []).map((arg) => {
            if (arg.type === 'string') return arg.value;
            if (arg.type === 'number') return String(arg.value);
            if (arg.type === 'boolean') return String(arg.value);
            return arg.description || arg.value || arg.type || '';
          }).join(' ');
          onEvent('console', {
            level: params.type || 'log',
            text,
            stackTrace: params.stackTrace || null,
          });
        } else if (method === 'Runtime.exceptionThrown') {
          const details = params.exceptionDetails || {};
          onEvent('exception', {
            text: details.text || '',
            exception: details.exception ? (details.exception.description || details.exception.value || '') : '',
            url: details.url || null,
            line: details.lineNumber,
            column: details.columnNumber,
            stackTrace: details.stackTrace || null,
          });
        } else if (method === 'Log.entryAdded') {
          const entry = params.entry || {};
          onEvent('log', {
            level: entry.level,
            source: entry.source,
            text: entry.text,
            url: entry.url || null,
            line: entry.lineNumber,
          });
        } else if (method.startsWith('Network.webSocket')) {
          onEvent('network-ws', {
            event: method.slice('Network.'.length),
            ...params,
          });
        }
      } catch (e) {
        console.error('Error processing observer event:', e);
      }
    });

    ws.on('close', () => {
      closed = true;
      for (const [, pending] of pendingRequests) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('Observer session closed'));
      }
      pendingRequests.clear();
    });

    await ws.connect();

    const sendOnThisSocket = (method, params = {}, timeout = 10000) => {
      if (closed) return Promise.reject(new Error('Observer session closed'));
      const id = messageIdCounter++;
      return new Promise((resolve, reject) => {
        const timeoutHandle = setTimeout(() => {
          pendingRequests.delete(id);
          reject(new Error(`CDP command timeout: ${method}`));
        }, timeout);
        pendingRequests.set(id, { resolve, reject, timeout: timeoutHandle });
        ws.send(JSON.stringify({ id, method, params }));
      });
    };

    try {
      await sendOnThisSocket('Runtime.enable');
      await sendOnThisSocket('Log.enable');
      await sendOnThisSocket('Network.enable');
    } catch (err) {
      ws.close();
      throw err;
    }

    return {
      close() {
        if (closed) return;
        closed = true;
        ws.close();
      },
      isClosed() {
        return closed;
      },
    };
  }

  // ===== CDP raw event subscription (legacy, screencast-only) =====
  //
  // The session-level onCdpEvent/offCdpEvent helpers are kept as thin
  // wrappers that resolve to a page session's event listener so any
  // future caller that still hits the session-level API gets the right
  // transport. PRI-1539 (Backlog) tracks refactoring screencast and
  // observer onto a uniform page-session-event-listener API.
  //
  // Per-tabIndex unsub registry, since offCdpEvent takes only the tabIndex
  // and the public API expects symmetric on/off semantics.
  const _cdpEventUnsubs = new Map(); // tabIndex -> unsub fn

  async function onCdpEvent(tabIndex, handler) {
    const tabs = await getTabs();
    if (!tabs[tabIndex]) throw new Error(`Tab ${tabIndex} not found`);
    const ps = await tabs[tabIndex].getPageSession();
    // Drop any prior subscription for this tabIndex first — matches the
    // pre-Phase-A.5 semantics where a second onCdpEvent on the same tab
    // replaced the previous handler (the legacy `conn.eventHandler =
    // handler` assignment).
    const prev = _cdpEventUnsubs.get(tabIndex);
    if (prev) try { prev(); } catch { /* best-effort */ }
    const unsub = ps.onEvent(handler);
    _cdpEventUnsubs.set(tabIndex, unsub);
  }

  async function offCdpEvent(tabIndex) {
    const unsub = _cdpEventUnsubs.get(tabIndex);
    if (unsub) {
      try { unsub(); } catch { /* best-effort */ }
      _cdpEventUnsubs.delete(tabIndex);
    }
  }
  // ===== GAUNTLET DIVERGENCE END =====

  return {
    // Internal helpers (exported for testing)
    getElementSelector,
    getElementSelectorAll,
    parseContains,

    // Core browser actions
    getTabs,
    newTab,
    closeTab,
    navigate,
    click,
    fill,
    selectOption,
    evaluate,
    extractText,
    getHtml,
    getAttribute,
    waitForElement,
    waitForText,
    screenshot,

    // Mouse actions (CDP-level)
    hover,
    drag,
    mouseMove,
    scroll,
    doubleClick,
    rightClick,

    // Human-like typing
    humanType,

    // File upload
    fileUpload,

    // Keyboard support
    keyboardPress,
    KEY_DEFINITIONS,

    // Chrome lifecycle
    startChrome,
    buildChromeArgs,
    killChrome,
    showBrowser,
    hideBrowser,
    getBrowserMode,
    getChromePid,

    // Profile management
    getChromeProfileDir,
    getProfileName,
    setProfileName,

    // Console logging
    enableConsoleLogging,
    getConsoleMessages,
    clearConsoleMessages,

    // Session management
    getXdgCacheHome,
    initializeSession,
    cleanupSession,
    createCapturePrefix,

    // Auto-capture utilities
    generateDomSummary,
    getPageSize,
    generateMarkdown,
    capturePageArtifacts,
    clickWithCapture,
    fillWithCapture,
    selectOptionWithCapture,
    evaluateWithCapture,

    // DOM diff capture
    generateHtmlDiff,
    captureActionWithDiff,

    // Browser-WS bridge surface (PRI-1535).
    targets,
    createBrowserContext,
    attachPageSession,

    // Dynamic port allocation and per-profile meta.json
    getActivePort,
    getProfileMetaPath,
    readProfileMeta,
    writeProfileMeta,
    clearProfileMeta,

    // Viewport/device emulation
    setViewport,
    clearViewport,
    getViewport,

    // Cookie management
    clearCookies,
    setCookies,
    clearBrowserData,

    // WebAuthn virtual authenticator (pinned session)
    webAuthnOpenSession,

    // Observer session — streams console/exception/log/network-ws events
    openObserverSession,

    // CDP raw event subscription (thin wrapper around page-session
    // onEvent — see the onCdpEvent definition above).
    onCdpEvent,
    offCdpEvent,

    // Process-cleanup registry (for adapter.ts and tests that stash a
    // session for cleanup-on-exit).
    _activeCleanups: activeCleanups,
    _ensureProcessHandlersRegistered: ensureProcessHandlersRegistered,
  };
}

module.exports = { createSession };
