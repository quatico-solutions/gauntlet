import { describe, test, expect } from "bun:test";
import { pickFreePort } from "./pick-free-port";

describe("pickFreePort", () => {
  test("returns a number in the valid TCP port range", async () => {
    const port = await pickFreePort();
    expect(typeof port).toBe("number");
    expect(Number.isInteger(port)).toBe(true);
    // Not pinning the ephemeral range rigidly — OSes vary.
    // Any usable non-privileged port is acceptable.
    expect(port).toBeGreaterThan(1024);
    expect(port).toBeLessThan(65536);
  });

  test("two calls return different ports", async () => {
    const a = await pickFreePort();
    const b = await pickFreePort();
    expect(a).not.toBe(b);
  });
});
