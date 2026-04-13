import { describe, expect, test } from "bun:test";
import { auth, withServer } from "./helpers.ts";

describe("authentication", () => {
  test("missing Authorization → 401", async () => {
    await withServer({}, async (base) => {
      const r = await fetch(`${base}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      expect(r.status).toBe(401);
      expect((await r.json()).error).toBe("unauthorized");
    });
  });

  test("wrong token → 401", async () => {
    await withServer({}, async (base) => {
      const r = await fetch(`${base}/output?session=x`, {
        headers: { Authorization: "Bearer nope" },
      });
      expect(r.status).toBe(401);
      expect((await r.json()).error).toBe("unauthorized");
    });
  });

  test("correct token passes auth (bad body still 400)", async () => {
    await withServer({}, async (base) => {
      const r = await fetch(`${base}/start`, {
        method: "POST",
        headers: { ...auth(), "Content-Type": "application/json" },
        body: "{}",
      });
      expect(r.status).toBe(400);
    });
  });
});
