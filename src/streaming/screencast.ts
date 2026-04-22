const chrome = require("../adapters/web/lib/chrome-ws-lib");
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

export interface ScreencastFrame {
  data: string; // base64 jpeg
  metadata: { width: number; height: number };
}

export class ScreencastStreamer {
  private running = false;
  private onFrame: (frame: ScreencastFrame) => void;
  private tabIndex: number;
  private saveDir?: string;
  private frameCount = 0;

  constructor(tabIndex: number, onFrame: (frame: ScreencastFrame) => void, saveDir?: string) {
    this.tabIndex = tabIndex;
    this.onFrame = onFrame;
    this.saveDir = saveDir;
    if (saveDir) {
      mkdirSync(saveDir, { recursive: true });
    }
  }

  async start(options?: {
    quality?: number;
    maxWidth?: number;
    maxHeight?: number;
  }) {
    this.running = true;

    const tabs = await chrome.getTabs();
    if (!tabs[this.tabIndex]) throw new Error(`Tab ${this.tabIndex} not found`);
    const wsUrl = tabs[this.tabIndex].webSocketDebuggerUrl;

    await chrome.onCdpEvent(this.tabIndex, async (event: any) => {
      if (!this.running) return;
      if (event.method !== "Page.screencastFrame") return;

      const params = event.params;
      this.onFrame({
        data: params.data,
        metadata: {
          width: params.metadata?.deviceWidth || 0,
          height: params.metadata?.deviceHeight || 0,
        },
      });

      if (this.saveDir) {
        const filename = `frame-${String(this.frameCount).padStart(5, "0")}.jpg`;
        writeFileSync(join(this.saveDir, filename), Buffer.from(params.data, "base64"));
        this.frameCount++;
      }

      // Acknowledge frame so Chrome sends the next one
      await chrome.sendCdpCommand(wsUrl, "Page.screencastFrameAck", {
        sessionId: params.sessionId,
      });
    });

    // Defaults tuned for local dev: Gauntlet runs on the developer's
    // machine, not over a network, so CPU-to-encode is the only cost of
    // higher quality. JPEG quality 70 at 1280×720 (CDP's stock "streaming"
    // setting) produced visible compression artifacts and downscaling
    // blur in the LiveRun pane; 92 at 1920×1200 is effectively lossless
    // and accommodates the 1440×900 default viewport without scaling.
    // Revisit if Gauntlet ever runs against a remote Chrome where
    // bandwidth matters.
    await chrome.sendCdpCommand(wsUrl, "Page.startScreencast", {
      format: "jpeg",
      quality: options?.quality ?? 92,
      maxWidth: options?.maxWidth ?? 1920,
      maxHeight: options?.maxHeight ?? 1200,
      everyNthFrame: 2,
    });
  }

  async stop() {
    this.running = false;
    try {
      const tabs = await chrome.getTabs();
      if (tabs[this.tabIndex]) {
        const wsUrl = tabs[this.tabIndex].webSocketDebuggerUrl;
        await chrome.sendCdpCommand(wsUrl, "Page.stopScreencast");
      }
      await chrome.offCdpEvent(this.tabIndex);
    } catch {
      // Ignore errors during cleanup
    }
  }
}
