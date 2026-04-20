// Forked from https://github.com/obra/superpowers-chrome
// Original author: Jesse Vincent
//
// GAUNTLET DIVERGENCE: upstream exports module-load constants
// (CHROME_DEBUG_HOST, CHROME_DEBUG_PORT, CHROME_DEBUG_BASE, WS_OVERRIDE_ENABLED).
// We also export mutable getters + setDefaults() so WebAdapter can point the
// library at a remote Chrome at runtime without mutating process.env.
// The upstream constant names are re-exported below as snapshots taken at
// module load — that keeps unmodified upstream code that destructures them
// working, so future syncs don't have to rewrite every `require('./host-override')`.

const DEFAULT_PORT = 9222;
const DEFAULT_HOST = '127.0.0.1';

let debugHost = process.env.CHROME_WS_HOST || DEFAULT_HOST;
let debugPort = (() => {
  const parsed = parseInt(process.env.CHROME_WS_PORT || `${DEFAULT_PORT}`, 10);
  return Number.isNaN(parsed) ? DEFAULT_PORT : parsed;
})();
let overrideEnabled =
  process.env.CHROME_WS_HOST !== undefined || process.env.CHROME_WS_PORT !== undefined;

function setDefaults(host, port) {
  debugHost = host;
  debugPort = port;
  overrideEnabled = true;
}

function getHost() {
  return debugHost;
}

function getPort() {
  return debugPort;
}

function getBase() {
  return `http://${debugHost}:${debugPort}`;
}

function isOverrideEnabled() {
  return overrideEnabled;
}

function rewriteWsUrl(originalUrl, host, port) {
  if (!originalUrl || typeof originalUrl !== 'string') {
    return originalUrl;
  }
  if (!overrideEnabled) {
    return originalUrl;
  }
  const useHost = host !== undefined ? host : debugHost;
  const usePort = port !== undefined ? port : debugPort;
  try {
    const url = new URL(originalUrl);
    url.hostname = useHost;
    url.port = `${usePort}`;
    return url.toString();
  } catch {
    return originalUrl;
  }
}

module.exports = {
  // Gauntlet API — runtime-mutable endpoint.
  setDefaults,
  getHost,
  getPort,
  getBase,
  isOverrideEnabled,
  rewriteWsUrl,

  // Upstream-compat snapshots (taken at module load). Present so that
  // unmodified upstream code like
  //   const { CHROME_DEBUG_HOST, CHROME_DEBUG_PORT } = require('./host-override');
  // keeps working during syncs. These do NOT track setDefaults() — callers
  // that need runtime-mutable values must use getHost()/getPort().
  CHROME_DEBUG_HOST: debugHost,
  CHROME_DEBUG_PORT: debugPort,
  CHROME_DEBUG_BASE: `http://${debugHost}:${debugPort}`,
  WS_OVERRIDE_ENABLED: overrideEnabled,
};
