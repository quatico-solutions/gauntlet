import { describe, test, expect } from "bun:test";
import { formatToolArgs } from "../../../src/cli/stream/format-args";

describe("formatToolArgs", () => {
  test("read: body is the path", () => {
    expect(formatToolArgs("read", { path: "profiles/fred/profile.md" }))
      .toEqual({ body: "profiles/fred/profile.md" });
  });

  test("read_output: empty body, no marker", () => {
    expect(formatToolArgs("read_output", {})).toEqual({ body: "" });
  });

  test("press: body is the key with no quotes", () => {
    expect(formatToolArgs("press", { key: "Enter" })).toEqual({ body: "Enter" });
  });

  test("type (CLI shape): body is quoted text only", () => {
    expect(formatToolArgs("type", { text: "client-ledger" }))
      .toEqual({ body: '"client-ledger"' });
  });

  test("type (web shape): body is selector ← \"text\"", () => {
    const r = formatToolArgs("type", { selector: "input[name=\"q\"]", text: "hello" });
    expect(r.body).toBe('input[name="q"] ← "hello"');
    expect(r.marker).toBeUndefined();
  });

  test("type with return_screenshot: appends 📷 marker", () => {
    const r = formatToolArgs("type", { selector: "textarea", text: "x", return_screenshot: true });
    expect(r.marker).toBe("📷");
  });

  test("type clips overlong text to 80 chars with ellipsis", () => {
    const long = "x".repeat(200);
    const r = formatToolArgs("type", { text: long });
    expect(r.body.length).toBeLessThan(85); // quoted body, allowing for quotes + ellipsis
    expect(r.body).toContain("…");
  });

  test("click: body is selector, marker if return_screenshot", () => {
    expect(formatToolArgs("click", { selector: ".x" }))
      .toEqual({ body: ".x", marker: undefined });
    expect(formatToolArgs("click", { selector: ".x", return_screenshot: true }))
      .toEqual({ body: ".x", marker: "📷" });
  });

  test("navigate: url + screenshot marker", () => {
    expect(formatToolArgs("navigate", { url: "http://localhost:4444", return_screenshot: true }))
      .toEqual({ body: "http://localhost:4444", marker: "📷" });
  });

  test("install_cookies: body is the path", () => {
    expect(formatToolArgs("install_cookies", { path: "profiles/fred/cookies.yaml" }))
      .toEqual({ body: "profiles/fred/cookies.yaml" });
  });

  test("screenshot: empty body, 📷 marker", () => {
    expect(formatToolArgs("screenshot", {})).toEqual({ body: "", marker: "📷" });
  });

  test("unknown tool: falls back to JSON dump", () => {
    expect(formatToolArgs("mystery", { foo: 1, bar: "x" }))
      .toEqual({ body: '{"foo":1,"bar":"x"}' });
  });

  test("unknown tool with empty args: empty body", () => {
    expect(formatToolArgs("mystery", {})).toEqual({ body: "" });
  });

  test("known tool with unrecognised shape: falls back to JSON", () => {
    // `read` requires { path }; if missing, we don't silently elide.
    const r = formatToolArgs("read", { weird: "shape" });
    expect(r.body).toBe('{"weird":"shape"}');
  });
});
