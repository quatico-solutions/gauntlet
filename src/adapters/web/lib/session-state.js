// Gauntlet divergence: host-override.js lives in lib/ (not the parent dir as
// upstream), since Gauntlet has no skills/browsing/ outer layer. Path is
// './host-override' here, not '../host-override'.
const { createOverride } = require('./host-override');

/**
 * Build the per-session mutable state bag.
 *
 * Every Chrome session has a small set of mutable values that the rest of
 * the library reads and writes: the active CDP port, the connection pool,
 * per-tab console-message buffers, the launched Chrome process handle,
 * the chosen profile name and data directory, the headless flag, and the
 * auto-capture session directory and counter.
 *
 * Pulling them into one object (and one file) makes the per-session
 * surface explicit, lets methods that get extracted to sibling files
 * accept it as a single parameter, and keeps the rest of chrome-ws-lib
 * focused on behaviour rather than state.
 *
 * `host`/`port` are forwarded to `createOverride` to seed the per-session
 * host-override; omitting them seeds from the `CHROME_WS_HOST` /
 * `CHROME_WS_PORT` env vars (see host-override.js).
 */
function createState({ host, port } = {}) {
  const hostOverride = createOverride({ host, port });
  return {
    hostOverride,
    rewriteWsUrl: hostOverride.rewriteWsUrl,

    // Dynamic port: updated by startChrome() when Chrome launches or reconnects.
    activePort: hostOverride.getPort(),

    // Console-message buffer for auto-capture. Keyed by `ps.sessionId`
    // (each page session has a stable sessionId from Target.attachToTarget).
    consoleMessages: new Map(),

    // Auto-capture session: lazily initialised on first capture.
    sessionDir: null,
    captureCounter: 0,

    // Chrome process management.
    chromeProcess: null,
    chromeHeadless: true,
    chromeUserDataDir: null,
    // Gauntlet divergence: profile name default is 'gauntlet', not
    // 'superpowers-chrome'. We must not share the profile dir with upstream.
    chromeProfileName: 'gauntlet',
  };
}

module.exports = { createState };
