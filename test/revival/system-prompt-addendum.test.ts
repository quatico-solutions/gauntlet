import { describe, test, expect } from "bun:test";
import { buildRevivalAddendum } from "../../src/revival/system-prompt-addendum";

describe("buildRevivalAddendum", () => {
  const tools = [
    { name: "click", description: "Click an element by selector.", parameters: { type: "object" } },
    { name: "report_result", description: "Report verdict.", parameters: { type: "object" } },
  ];

  test("includes a clear revival framing", () => {
    const out = buildRevivalAddendum(tools, { fallback: false });
    expect(out).toContain("REVIVAL");
    expect(out.toLowerCase()).toContain("completed");
    expect(out).toContain("answer");
  });

  test("lists original tools as prose with name and description", () => {
    const out = buildRevivalAddendum(tools, { fallback: false });
    expect(out).toContain("click");
    expect(out).toContain("Click an element by selector.");
    expect(out).toContain("report_result");
    expect(out).toContain("Report verdict.");
  });

  test("marks the prose as fallback when fallback=true", () => {
    const out = buildRevivalAddendum(tools, { fallback: true });
    expect(out).toContain("fallback");
    expect(out.toLowerCase()).toContain("drift");
  });

  test("instructs the model to use the answer tool only", () => {
    const out = buildRevivalAddendum(tools, { fallback: false });
    expect(out.toLowerCase()).toContain("answer");
    expect(out).toContain("cannot");
  });
});
