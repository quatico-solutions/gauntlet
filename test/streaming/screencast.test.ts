import { describe, test, expect } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ScreencastStreamer } from "../../src/streaming/screencast";

// PRI-1436: streamer requires a chrome-ws-lib session. The session surface used
// by screencast.ts is documented at
// docs/superpowers/specs/2026-05-18-screencast-lifecycle-surface.md — this stub
// mirrors that surface exactly. If screencast.ts changes which methods it
// calls on the session, update the doc first, then this stub.

interface FrameEvent {
  method: string;
  params: {
    data: string;
    sessionId: number;
    metadata?: { deviceWidth?: number; deviceHeight?: number };
  };
}

interface StubSession {
  _calls: { startScreencast: number; stopScreencast: number };
  _emit: (evt: FrameEvent) => void;
  chrome: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getTabs: () => Promise<any[]>;
  };
}

function makeStubSession(): StubSession {
  let frameHandler: ((evt: FrameEvent) => void) | undefined;
  const _calls = { startScreencast: 0, stopScreencast: 0 };

  const pageSession = {
    send: async (method: string, _params?: object) => {
      if (method === "Page.startScreencast") _calls.startScreencast += 1;
      else if (method === "Page.stopScreencast") _calls.stopScreencast += 1;
      // Page.screencastFrameAck and anything else: ignore.
    },
    onEvent: (handler: (evt: FrameEvent) => void) => {
      frameHandler = handler;
      return () => {
        frameHandler = undefined;
      };
    },
  };

  const tab = {
    getPageSession: async () => pageSession,
  };

  const chrome = {
    getTabs: async () => [tab],
  };

  return {
    _calls,
    _emit: (evt: FrameEvent) => {
      frameHandler?.(evt);
    },
    chrome,
  };
}

describe("ScreencastStreamer", () => {
  // The screencast save-opt-in spec hinges on the streamer being the
  // single on-disk writer for frames. These two tests pin the gate:
  // omitting saveDir MUST leave the filesystem untouched, while
  // providing one MUST create the directory eagerly.

  test("does NOT create any directory on disk when saveDir is undefined", () => {
    const session = makeStubSession();
    const root = mkdtempSync(join(tmpdir(), "gauntlet-screencast-gate-"));
    try {
      const framesDir = join(root, "frames");
      expect(existsSync(framesDir)).toBe(false);
      const streamer = new ScreencastStreamer(0, () => {}, session.chrome, undefined);
      expect(streamer).toBeDefined();
      // No saveDir => constructor must not touch disk.
      expect(existsSync(framesDir)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("creates the saveDir eagerly when provided", () => {
    const session = makeStubSession();
    const root = mkdtempSync(join(tmpdir(), "gauntlet-screencast-gate-"));
    try {
      const framesDir = join(root, "frames");
      expect(existsSync(framesDir)).toBe(false);
      const streamer = new ScreencastStreamer(0, () => {}, session.chrome, framesDir);
      expect(streamer).toBeDefined();
      expect(existsSync(framesDir)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // Lifecycle assertions (replacing the prior `can be constructed` smoke test).
  // The stub session mirrors the surface documented in
  // docs/superpowers/specs/2026-05-18-screencast-lifecycle-surface.md.

  test("start() invokes Page.startScreencast on the page session", async () => {
    const session = makeStubSession();
    const streamer = new ScreencastStreamer(0, () => {}, session.chrome);
    await streamer.start();
    expect(session._calls.startScreencast).toBe(1);
  });

  test("stop() is no-op idempotent — second call does not re-send Page.stopScreencast", async () => {
    const session = makeStubSession();
    const streamer = new ScreencastStreamer(0, () => {}, session.chrome);
    await streamer.start();
    await streamer.stop();
    await streamer.stop();
    // Per the surface doc: after the first stop(), pageSession is nulled and the
    // guard skips the second send. Expected count is 1, not 2.
    expect(session._calls.stopScreencast).toBe(1);
  });

  test("onFrame callback fires when a Page.screencastFrame event is emitted", async () => {
    const session = makeStubSession();
    const seen: { data: string; metadata: { width: number; height: number } }[] = [];
    const streamer = new ScreencastStreamer(
      0,
      (frame) => {
        seen.push(frame);
      },
      session.chrome,
    );
    await streamer.start();
    session._emit({
      method: "Page.screencastFrame",
      params: {
        data: "aGVsbG8=", // base64 "hello"
        sessionId: 1,
        metadata: { deviceWidth: 1920, deviceHeight: 1200 },
      },
    });
    expect(seen.length).toBe(1);
    expect(seen[0]!.data).toBe("aGVsbG8=");
    expect(seen[0]!.metadata.width).toBe(1920);
    expect(seen[0]!.metadata.height).toBe(1200);
  });

  test("a frame received while saveDir is set writes a file synchronously", async () => {
    const session = makeStubSession();
    const root = mkdtempSync(join(tmpdir(), "gauntlet-screencast-save-"));
    try {
      const framesDir = join(root, "frames");
      const streamer = new ScreencastStreamer(0, () => {}, session.chrome, framesDir);
      await streamer.start();
      session._emit({
        method: "Page.screencastFrame",
        params: {
          data: "aGVsbG8=", // base64 "hello"
          sessionId: 1,
          metadata: { deviceWidth: 800, deviceHeight: 600 },
        },
      });
      // writeFileSync per the surface doc — no polling needed.
      const files = readdirSync(framesDir);
      expect(files.length).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
