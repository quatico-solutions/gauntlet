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
  setDefaults,
  getHost,
  getPort,
  getBase,
  isOverrideEnabled,
  rewriteWsUrl,
};
