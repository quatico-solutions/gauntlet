import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { generateKeyPairSync, randomBytes } from "node:crypto";

const { createSession } = require("../../../../src/adapters/web/lib/chrome-ws-lib");

// Build a *real* WebAuthn credential payload — Chrome's WebAuthn.addCredential
// validates the privateKey is a parseable PKCS#8 EC key. The synthetic
// SAMPLE_PASSKEY in passkey.test.ts is YAML-shape-valid but not key-valid,
// so it can't drive an actual addCredential round-trip.
function makeCredential(rpId: string) {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const pkcs8 = privateKey.export({ format: "der", type: "pkcs8" });
  return {
    credentialId: randomBytes(16).toString("base64"),
    isResidentCredential: true,
    rpId,
    userHandle: randomBytes(8).toString("base64"),
    signCount: 0,
    privateKey: pkcs8.toString("base64"),
  };
}

describe("WebAuthn isolation across BrowserContexts", () => {
  let session: any;
  let ctxA: any, ctxB: any;
  let pageA: any, pageB: any;
  let waA: any, waB: any;

  beforeAll(async () => {
    session = createSession();
    await session.startChrome(true, "webauthn-ctx-test");
    ctxA = await session.createBrowserContext();
    ctxB = await session.createBrowserContext();
    pageA = await ctxA.createPage("about:blank");
    pageB = await ctxB.createPage("about:blank");
    waA = await session.webAuthnOpenSession(pageA.webSocketDebuggerUrl);
    waB = await session.webAuthnOpenSession(pageB.webSocketDebuggerUrl);
  });

  afterAll(async () => {
    if (waA && !waA.isClosed()) waA.close();
    if (waB && !waB.isClosed()) waB.close();
    if (ctxA) await ctxA.dispose();
    if (ctxB) await ctxB.dispose();
    if (session) await session.killChrome();
  });

  test("authenticator added on socket A is not addressable from socket B (cross-context isolation)", async () => {
    const authA = await waA.addVirtualAuthenticator({
      protocol: "ctap2", transport: "internal",
      hasResidentKey: true, hasUserVerification: true, isUserVerified: true,
    });
    const authB = await waB.addVirtualAuthenticator({
      protocol: "ctap2", transport: "internal",
      hasResidentKey: true, hasUserVerification: true, isUserVerified: true,
    });

    // Each call gets a fresh credential so we don't trip on duplicate-credentialId
    // collisions — only the cross-probe direction matters here.
    //
    // Note: we use plain await + try/catch + expect.toMatch rather than the
    // Bun expect(...).resolves/.rejects shape. The latter caused spurious
    // "WebAuthn session closed" rejections under this runner against the
    // pinned WebAuthn WS, despite the same sequence working cleanly when
    // driven directly. Plain await avoids whatever races that combination
    // produces.

    // Self-probe: each session can target its own authenticator.
    const selfA = await waA.addCredential(authA, makeCredential("example.test"));
    expect(selfA).toBeDefined();
    const selfB = await waB.addCredential(authB, makeCredential("example.test"));
    expect(selfB).toBeDefined();

    // Cross-probe: A targeting B's authenticatorId throws "not found" if isolated.
    let crossAErr: Error | null = null;
    try {
      await waA.addCredential(authB, makeCredential("example.test"));
    } catch (e) { crossAErr = e as Error; }
    expect(crossAErr).not.toBeNull();
    expect(crossAErr!.message).toMatch(/not find|matching the ID|no such/i);

    // Symmetric.
    let crossBErr: Error | null = null;
    try {
      await waB.addCredential(authA, makeCredential("example.test"));
    } catch (e) { crossBErr = e as Error; }
    expect(crossBErr).not.toBeNull();
    expect(crossBErr!.message).toMatch(/not find|matching the ID|no such/i);
  });
});
