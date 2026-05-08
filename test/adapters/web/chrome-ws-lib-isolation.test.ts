import { describe, test, expect } from "bun:test";

// PRI-1436 regression gate: chrome-ws-lib's createSession() factory must
// hand back independent state-bags. Pre-1436 the file was a CommonJS
// singleton — every WebAdapter shared activePort, chromeProcess, the
// connection pool, the per-tab consoleMessages map, the chosen profile
// name, and the host-override snapshot. Two concurrent web runs in
// `gauntlet serve` stomped each other's endpoint and (worse) shared a
// single Chrome process across runs that were supposed to be isolated.
//
// If this test ever fails, we've reintroduced the bug. The assertions
// poke observable surface area (profile name, activePort, host override
// host) on independently-constructed sessions and prove that mutating
// one does not change the other.

describe("chrome-ws-lib createSession() isolation (PRI-1436)", () => {
  test("two sessions are distinct objects", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createSession } = require("../../../src/adapters/web/lib/chrome-ws-lib");
    const a = createSession();
    const b = createSession();
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a).not.toBe(b);
    // Method identity also differs — the closure captures different state
    // per call, so the function objects on each session are not shared.
    expect(a.getProfileName).not.toBe(b.getProfileName);
  });

  test("setProfileName on one session does not change getProfileName on the other", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createSession } = require("../../../src/adapters/web/lib/chrome-ws-lib");
    const a = createSession();
    const b = createSession();
    // Default both sessions report the gauntlet default (PRI-1444 — we
    // intentionally diverge from upstream's 'superpowers-chrome' default).
    expect(a.getProfileName()).toBe("gauntlet");
    expect(b.getProfileName()).toBe("gauntlet");
    a.setProfileName("alpha-profile");
    expect(a.getProfileName()).toBe("alpha-profile");
    // The bug: pre-1436 b would also see "alpha-profile" because the
    // chromeProfileName binding was module-scope.
    expect(b.getProfileName()).toBe("gauntlet");
    b.setProfileName("beta-profile");
    expect(a.getProfileName()).toBe("alpha-profile");
    expect(b.getProfileName()).toBe("beta-profile");
  });

  test("activePort on one session is independent of the other", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createSession } = require("../../../src/adapters/web/lib/chrome-ws-lib");
    const a = createSession({ host: "127.0.0.1", port: 11111 });
    const b = createSession({ host: "127.0.0.1", port: 22222 });
    expect(a.getActivePort()).toBe(11111);
    expect(b.getActivePort()).toBe(22222);
    // Mutating the session A's profile (which is one of the underlying
    // module-level lets pre-1436) must not bleed into B.
    a.setProfileName("xprofile");
    expect(b.getProfileName()).toBe("gauntlet");
  });

  test("bridge surface (targets / createBrowserContext) is per-session — distinct closures", () => {
    // The PRI-1436 invariant: nothing on the public session surface is
    // shared module-level state. session.targets, session.createBrowserContext,
    // and session.attachPageSession are constructed inside createSession()'s
    // closure (via the bridge's lazy-init), so they must differ across
    // sessions.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createSession } = require("../../../src/adapters/web/lib/chrome-ws-lib");
    const a = createSession();
    const b = createSession();
    expect(a.targets).not.toBe(b.targets);
    expect(a.createBrowserContext).not.toBe(b.createBrowserContext);
    expect(a.attachPageSession).not.toBe(b.attachPageSession);
  });

  test("consoleMessages storage is per-session", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createSession } = require("../../../src/adapters/web/lib/chrome-ws-lib");
    const a = createSession();
    const b = createSession();
    // getConsoleMessages takes a tab spec; with no Chrome up it should
    // return whatever the session's console-messages Map holds for that
    // tab (empty array). The Map identity is the load-bearing part.
    expect(a.getConsoleMessages).not.toBe(b.getConsoleMessages);
    expect(a.clearConsoleMessages).not.toBe(b.clearConsoleMessages);
  });

  test("createSession() with explicit host/port seeds a per-session host-override", () => {
    // PRI-1436: pre-fix, host-override was module-singleton state; both
    // sessions saw whichever endpoint was last set. After the fix, each
    // session has its own host-override instance — see also
    // host-override.test.ts for the createOverride() unit-level coverage.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createSession } = require("../../../src/adapters/web/lib/chrome-ws-lib");
    const a = createSession({ host: "host-a", port: 4001 });
    const b = createSession({ host: "host-b", port: 4002 });
    expect(a.getActivePort()).toBe(4001);
    expect(b.getActivePort()).toBe(4002);
  });
});
