import { describe, test, expect } from "bun:test";
import { formatAnomalyEvent } from "../../../src/cli/stream/format-event";

describe("formatAnomalyEvent", () => {
  test("install_cookies_ok: compact summary with cookie names", () => {
    const r = formatAnomalyEvent({
      type: "event",
      eventId: 5,
      ts: "2026-05-05T03:07:09.000Z",
      name: "install_cookies_ok",
      path: "profiles/fred/cookies.yaml",
      accepted: 1,
      rejected: 0,
      cookies: [{ name: "session", domain: null, valueLength: 4 }],
    });
    expect(r.name).toBe("install_cookies_ok");
    expect(r.body).toBe("accepted 1 · rejected 0 · session");
  });

  test("install_cookies_ok with multiple cookies joins names", () => {
    const r = formatAnomalyEvent({
      type: "event",
      name: "install_cookies_ok",
      accepted: 2,
      rejected: 0,
      cookies: [{ name: "session" }, { name: "csrf" }],
    });
    expect(r.body).toBe("accepted 2 · rejected 0 · session, csrf");
  });

  test("tool_result_text_oversize: tool · size · artifact", () => {
    const r = formatAnomalyEvent({
      type: "event",
      name: "tool_result_text_oversize",
      turn: 1,
      toolName: "read_screen",
      bytes: 65536,
      artifact: "artifacts/001.txt",
    });
    expect(r.body).toBe("read_screen · 64.0kB · artifacts/001.txt");
  });

  test("unknown event: scalar k=v, list/object values capped", () => {
    const r = formatAnomalyEvent({
      type: "event",
      name: "something_weird",
      foo: 1,
      note: "hello",
      list: [1, 2, 3, 4],
      obj: { a: 1, b: 2 },
    });
    expect(r.name).toBe("something_weird");
    expect(r.body).toContain("foo=1");
    expect(r.body).toContain("note=hello");
    expect(r.body).toContain("list=[4 items]");
    expect(r.body).toContain("obj={2 keys}");
  });

  test("strips envelope keys (eventId, parentEventId, ts, type)", () => {
    const r = formatAnomalyEvent({
      type: "event",
      eventId: 1,
      parentEventId: 0,
      ts: "2026-05-05",
      name: "x",
      foo: "bar",
    });
    expect(r.body).toBe("foo=bar");
  });
});
