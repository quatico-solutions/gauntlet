import { describe, test, expect } from "bun:test";
import { safeEmitIndexHtml } from "../../src/cli/auto-emit-html";

describe("safeEmitIndexHtml", () => {
  test("swallows renderer errors and writes to stderr", async () => {
    const stderrWrites: string[] = [];
    const result = await safeEmitIndexHtml("/nonexistent/run/dir", {
      renderer: async () => {
        throw new Error("boom");
      },
      stderr: (m) => stderrWrites.push(m),
    });
    expect(result).toBeNull();
    expect(stderrWrites.length).toBe(1);
    expect(stderrWrites[0]).toContain("[render]");
    expect(stderrWrites[0]).toContain("boom");
  });

  test("returns the output path on success", async () => {
    const result = await safeEmitIndexHtml("/some/path", {
      renderer: async (runDir) => `${runDir}/index.html`,
      stderr: () => {},
    });
    expect(result).toBe("/some/path/index.html");
  });

  test("does not write to stderr on success", async () => {
    const stderrWrites: string[] = [];
    await safeEmitIndexHtml("/some/path", {
      renderer: async () => "/some/path/index.html",
      stderr: (m) => stderrWrites.push(m),
    });
    expect(stderrWrites.length).toBe(0);
  });

  test("stderr message contains [render] prefix", async () => {
    const stderrWrites: string[] = [];
    await safeEmitIndexHtml("/run/dir", {
      renderer: async () => {
        throw new Error("template not found");
      },
      stderr: (m) => stderrWrites.push(m),
    });
    expect(stderrWrites[0]).toMatch(/^\[render\]/);
    expect(stderrWrites[0]).toContain("template not found");
  });

  test("handles non-Error throws gracefully", async () => {
    const stderrWrites: string[] = [];
    await safeEmitIndexHtml("/run/dir", {
      renderer: async () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw "string error";
      },
      stderr: (m) => stderrWrites.push(m),
    });
    expect(stderrWrites.length).toBe(1);
    expect(stderrWrites[0]).toContain("string error");
  });
});
