import type { Adapter } from "../adapter";
import type { ToolDefinition, ToolResult } from "../../models/provider";
import type { EvidenceLogger } from "../../evidence/logger";

const KEY_MAP: Record<string, string> = {
  Enter: "\n",
  Tab: "\t",
  Escape: "\x1b",
  "Ctrl+C": "\x03",
  "Ctrl+D": "\x04",
  "Ctrl+Z": "\x1a",
};

export interface RemoteCLIAdapterOptions {
  baseUrl: string;
  token: string;
  cwd?: string;
  env?: Record<string, string>;
  /** Long-poll wait for the background reader, in ms. */
  pollWaitMs?: number;
}

interface JsonError {
  error?: string;
  message?: string;
}

export class RemoteCLIAdapter implements Adapter {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly cwd: string | undefined;
  private readonly env: Record<string, string> | undefined;
  private readonly pollWaitMs: number;

  private sessionId: string | null = null;
  private buffer = "";
  private pollTask: Promise<void> | null = null;
  private stopPolling = false;
  private remoteExited = false;

  constructor(opts: RemoteCLIAdapterOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token;
    this.cwd = opts.cwd;
    this.env = opts.env;
    this.pollWaitMs = opts.pollWaitMs ?? 2000;
  }

  async start(command: string): Promise<void> {
    if (this.sessionId) throw new Error("RemoteCLIAdapter already started");
    this.buffer = "";
    this.remoteExited = false;
    this.stopPolling = false;
    const sessionId = crypto.randomUUID();
    const body: Record<string, unknown> = { session: sessionId, command };
    if (this.cwd) body.cwd = this.cwd;
    if (this.env) body.env = this.env;

    const res = await fetch(`${this.baseUrl}/start`, {
      method: "POST",
      headers: this.jsonHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await this.buildError("start", res);

    this.sessionId = sessionId;
    this.pollTask = this.pollLoop();
  }

  private async pollLoop(): Promise<void> {
    const decoder = new TextDecoder("utf-8", { fatal: false });
    while (!this.stopPolling && this.sessionId && !this.remoteExited) {
      const sid = this.sessionId;
      const url =
        `${this.baseUrl}/output?session=${encodeURIComponent(sid)}` +
        `&wait_ms=${this.pollWaitMs}`;
      let res: Response;
      try {
        res = await fetch(url, {
          headers: { Authorization: `Bearer ${this.token}` },
        });
      } catch {
        // Network blip — small backoff, then try again.
        await sleep(200);
        continue;
      }
      if (res.status === 410) {
        this.remoteExited = true;
        break;
      }
      if (!res.ok) {
        await sleep(200);
        continue;
      }
      const payload = (await res.json()) as {
        data: string;
        exited: boolean;
        exit_code: number | null;
        truncated: boolean;
      };
      if (payload.data) {
        const bytes = Buffer.from(payload.data, "base64");
        this.buffer += decoder.decode(bytes, { stream: !payload.exited });
      }
      if (payload.exited) {
        this.remoteExited = true;
        break;
      }
    }
  }

  readOutput(): string {
    const out = this.buffer;
    this.buffer = "";
    return out;
  }

  async type(text: string): Promise<void> {
    if (!this.sessionId) throw new Error("Process not started");
    const data = Buffer.from(text, "utf-8").toString("base64");
    const res = await fetch(`${this.baseUrl}/stdin`, {
      method: "POST",
      headers: this.jsonHeaders(),
      body: JSON.stringify({ session: this.sessionId, data }),
    });
    if (!res.ok) throw await this.buildError("stdin", res);
  }

  async press(key: string): Promise<void> {
    const mapped = KEY_MAP[key];
    if (!mapped) throw new Error(`Unknown key: ${key}`);
    await this.type(mapped);
  }

  async close(): Promise<void> {
    if (!this.sessionId) return;
    const sid = this.sessionId;
    this.sessionId = null;
    this.stopPolling = true;
    try {
      await fetch(`${this.baseUrl}/close`, {
        method: "POST",
        headers: this.jsonHeaders(),
        body: JSON.stringify({ session: sid }),
      });
    } catch {
      // best-effort
    }
    if (this.pollTask) {
      try {
        await this.pollTask;
      } catch {
        // ignore
      }
      this.pollTask = null;
    }
  }

  toolDefinitions(): ToolDefinition[] {
    return [
      {
        name: "type",
        description: "Type text into the terminal stdin",
        parameters: {
          type: "object",
          properties: {
            text: { type: "string", description: "Text to type" },
          },
          required: ["text"],
        },
      },
      {
        name: "press",
        description:
          "Press a special key (Enter, Tab, Escape, Ctrl+C, Ctrl+D, Ctrl+Z)",
        parameters: {
          type: "object",
          properties: {
            key: { type: "string", description: "Key name to press" },
          },
          required: ["key"],
        },
      },
      {
        name: "read_output",
        description:
          "Read and clear the buffered terminal output since last read",
        parameters: { type: "object", properties: {} },
      },
    ];
  }

  async executeTool(
    name: string,
    args: Record<string, unknown>,
    logger: EvidenceLogger,
  ): Promise<ToolResult> {
    logger.logAction(name, args);
    switch (name) {
      case "type":
        await this.type(args.text as string);
        return { text: "typed" };
      case "press":
        await this.press(args.key as string);
        return { text: "pressed" };
      case "read_output":
        return { text: this.readOutput() };
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private jsonHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
    };
  }

  private async buildError(op: string, res: Response): Promise<Error> {
    let body: JsonError = {};
    try {
      body = (await res.json()) as JsonError;
    } catch {
      // non-JSON body
    }
    const code = body.error ?? `http_${res.status}`;
    const msg = body.message ?? res.statusText;
    return new Error(`relay ${op} failed: ${res.status} ${code}: ${msg}`);
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
