import { describe, test, expect } from "bun:test";

const { createCdpRouter } = require("../../../../src/adapters/web/lib/cdp-router");

describe("cdp-router", () => {
  test("dispatches sessionId-tagged messages to the right session", () => {
    let onEventHandler: any = null;
    const fakeBrowser = { onEvent: (fn: any) => { onEventHandler = fn; } };
    const router = createCdpRouter({ browser: fakeBrowser });

    const sessA = router.registerSession("sid-A");
    const sessB = router.registerSession("sid-B");
    const seenA: any[] = [];
    const seenB: any[] = [];
    sessA.eventListeners.add((m: any) => seenA.push(m));
    sessB.eventListeners.add((m: any) => seenB.push(m));

    onEventHandler({ method: "X", params: {}, sessionId: "sid-A" });
    onEventHandler({ method: "Y", params: {}, sessionId: "sid-B" });

    expect(seenA.map((m) => m.method)).toEqual(["X"]);
    expect(seenB.map((m) => m.method)).toEqual(["Y"]);
  });

  test("dispatches sessionId-tagged command responses to the right session", () => {
    let onEventHandler: any = null;
    const fakeBrowser = { onEvent: (fn: any) => { onEventHandler = fn; } };
    const router = createCdpRouter({ browser: fakeBrowser });

    const sess = router.registerSession("sid");
    let resolved: any = null;
    sess.pendingRequests.set(1, {
      resolve: (v: any) => { resolved = v; },
      reject: () => {},
      timeout: setTimeout(() => {}, 60000),
    });

    onEventHandler({ id: 1, result: { ok: true }, sessionId: "sid" });
    expect(resolved).toEqual({ ok: true });
  });

  test("dispatches sessionless event messages to root listeners", () => {
    let onEventHandler: any = null;
    const fakeBrowser = { onEvent: (fn: any) => { onEventHandler = fn; } };
    const router = createCdpRouter({ browser: fakeBrowser });

    const seen: any[] = [];
    router.getRootListeners().add((m: any) => seen.push(m));

    onEventHandler({ method: "Target.targetCreated", params: { targetInfo: { type: "page" } } });

    expect(seen.map((m) => m.method)).toEqual(["Target.targetCreated"]);
  });

  test("sessionless command responses do NOT fire root listeners (browser-session handles them)", () => {
    let onEventHandler: any = null;
    const fakeBrowser = { onEvent: (fn: any) => { onEventHandler = fn; } };
    const router = createCdpRouter({ browser: fakeBrowser });

    const seen: any[] = [];
    router.getRootListeners().add((m: any) => seen.push(m));

    // {id, result} — a command response with no method, no sessionId.
    onEventHandler({ id: 42, result: { product: "HeadlessChrome/137" } });

    expect(seen).toEqual([]);
  });

  test("unregisterSession rejects pending and clears listeners", () => {
    let onEventHandler: any = null;
    const fakeBrowser = { onEvent: (fn: any) => { onEventHandler = fn; } };
    const router = createCdpRouter({ browser: fakeBrowser });

    const sess = router.registerSession("sid");
    let rejected: any = null;
    sess.pendingRequests.set(1, {
      resolve: () => {},
      reject: (err: any) => { rejected = err; },
      timeout: setTimeout(() => {}, 60000),
    });
    sess.eventListeners.add(() => {});

    router.unregisterSession("sid");
    expect(rejected).toBeDefined();
    expect((rejected as Error).message).toMatch(/detached/i);

    // After unregister, sessionId-tagged messages have nowhere to go (no throw)
    expect(() => onEventHandler({ method: "X", sessionId: "sid" })).not.toThrow();
  });

  test("messages tagged with an unregistered sessionId silently drop", () => {
    let onEventHandler: any = null;
    const fakeBrowser = { onEvent: (fn: any) => { onEventHandler = fn; } };
    const router = createCdpRouter({ browser: fakeBrowser });

    expect(() => onEventHandler({ method: "Foo", sessionId: "ghost" })).not.toThrow();
    expect(() => onEventHandler({ id: 1, result: {}, sessionId: "ghost" })).not.toThrow();
  });
});
