const chrome = require("../adapters/web/lib/chrome-ws-lib");

export interface ScreencastFrame {
  data: string; // base64 jpeg
  metadata: { width: number; height: number };
}

export class ScreencastStreamer {
  private running = false;
  private onFrame: (frame: ScreencastFrame) => void;
  private tabIndex: number;

  constructor(tabIndex: number, onFrame: (frame: ScreencastFrame) => void) {
    this.tabIndex = tabIndex;
    this.onFrame = onFrame;
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

      // Acknowledge frame so Chrome sends the next one
      await chrome.sendCdpCommand(wsUrl, "Page.screencastFrameAck", {
        sessionId: params.sessionId,
      });
    });

    await chrome.sendCdpCommand(wsUrl, "Page.startScreencast", {
      format: "jpeg",
      quality: options?.quality ?? 70,
      maxWidth: options?.maxWidth ?? 1280,
      maxHeight: options?.maxHeight ?? 720,
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
