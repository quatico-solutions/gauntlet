import { describe, test, expect, beforeAll, afterAll } from "bun:test";

const { createSession } = require("../../../../src/adapters/web/lib/chrome-ws-lib");

describe("page-session", () => {
  let session: any;
  let context: any;

  beforeAll(async () => {
    session = createSession();
    await session.startChrome(true, "page-session-test");
    context = await session.createBrowserContext();
  });

  afterAll(async () => {
    if (context) await context.dispose();
    if (session) await session.killChrome();
  });

  test("attached page session round-trips Runtime.evaluate", async () => {
    const page = await context.createPage("about:blank");
    const ps = await session.attachPageSession(page.targetId);
    expect(ps.sessionId).toBeDefined();
    expect(ps.targetId).toBe(page.targetId);

    const result = await ps.send("Runtime.evaluate", {
      expression: "1 + 1",
      returnByValue: true,
    });
    expect(result.result.value).toBe(2);

    await ps.detach();
  });

  test("two page sessions on different pages don't collide on message ids", async () => {
    const pageA = await context.createPage("about:blank");
    const pageB = await context.createPage("about:blank");
    const psA = await session.attachPageSession(pageA.targetId);
    const psB = await session.attachPageSession(pageB.targetId);

    // Fire interleaved evaluates with the same id space — both should resolve correctly.
    const [a, b] = await Promise.all([
      psA.send("Runtime.evaluate", { expression: "'A'", returnByValue: true }),
      psB.send("Runtime.evaluate", { expression: "'B'", returnByValue: true }),
    ]);
    expect(a.result.value).toBe("A");
    expect(b.result.value).toBe("B");

    await psA.detach();
    await psB.detach();
  });

  test("onEvent receives page-session-scoped events", async () => {
    const page = await context.createPage("about:blank");
    const ps = await session.attachPageSession(page.targetId);

    const events: any[] = [];
    ps.onEvent((msg: any) => events.push(msg));

    await ps.send("Page.enable", {});
    await ps.send("Page.navigate", { url: "data:text/html,<p>hi</p>" });
    await new Promise((r) => setTimeout(r, 500));

    expect(events.some((e) => e.method === "Page.loadEventFired")).toBe(true);
    await ps.detach();
  });

  test("waitForEvent resolves on the matching method", async () => {
    const page = await context.createPage("about:blank");
    const ps = await session.attachPageSession(page.targetId);

    await ps.send("Page.enable", {});
    const loadP = ps.waitForEvent("Page.loadEventFired", { timeoutMs: 5000 });
    await ps.send("Page.navigate", { url: "data:text/html,<p>x</p>" });
    const event = await loadP;
    expect(event.method).toBe("Page.loadEventFired");

    await ps.detach();
  });
});
