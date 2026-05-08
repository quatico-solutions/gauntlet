/**
 * Cookie management — currently just a single "clear everything" action.
 *
 * Helpers accept `tabIndexOrPageSession` and route through
 * `pageSession.send`.
 *
 * Note: Gauntlet's orchestrator-level `setCookies` and `clearBrowserData`
 * (divergence #5 in upstream-sync.md) live in `chrome-ws-lib.js`, not
 * here — they're not part of upstream's `lib/cookies.js`.
 */
function attachCookies({ getPageSession }) {
  async function clearCookies(tabIndexOrPageSession) {
    const ps = await getPageSession(tabIndexOrPageSession);
    await ps.send('Network.clearBrowserCookies', {});
  }

  return { clearCookies };
}

module.exports = { attachCookies };
