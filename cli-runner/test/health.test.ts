import { describe, expect, test } from "bun:test";
import { withServer } from "./helpers.ts";

describe("GET /health", () => {
  test("returns 200 and ok:true without auth", async () => {
    await withServer({}, async (base) => {
      const r = await fetch(`${base}/health`);
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.ok).toBe(true);
      expect(typeof body.version).toBe("string");
    });
  });

  test("health ignores bogus auth", async () => {
    await withServer({}, async (base) => {
      const r = await fetch(`${base}/health`, {
        headers: { Authorization: "Bearer wrong" },
      });
      expect(r.status).toBe(200);
    });
  });
});
