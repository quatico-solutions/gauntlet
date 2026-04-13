import { Hono } from "hono";
import { join } from "path";
import { findCard } from "./helpers";
import { createClient } from "../../models/resolve";
import { EvidenceLogger } from "../../evidence/logger";
import { writeResultFiles } from "../../evidence/writer";
import { runAgent } from "../../agent/agent";
import type { Adapter } from "../../adapters/adapter";
import type { RunBroadcaster } from "../ws";
import type { ScreencastStreamer as ScreencastStreamerType } from "../../streaming/screencast";
import type { ErrorLog } from "./errors";

interface RemoteCliConfig {
  relayUrl?: string;
  relayToken?: string;
}

function createAdapter(
  type: string,
  chromeEndpoint?: string,
  remote?: RemoteCliConfig,
): Adapter {
  switch (type) {
    case "cli": {
      const { CLIAdapter } = require("../../adapters/cli/adapter");
      return new CLIAdapter();
    }
    case "tui": {
      const { TUIAdapter } = require("../../adapters/tui/adapter");
      return new TUIAdapter();
    }
    case "web": {
      const { WebAdapter } = require("../../adapters/web/adapter");
      return new WebAdapter({ chrome: chromeEndpoint });
    }
    case "remote-cli": {
      const relayUrl = remote?.relayUrl ?? process.env.GAUNTLET_RELAY_URL;
      const relayToken = remote?.relayToken ?? process.env.GAUNTLET_RELAY_TOKEN;
      if (!relayUrl) throw new Error("relay_url is required for remote-cli (body.relay_url or GAUNTLET_RELAY_URL)");
      if (!relayToken) throw new Error("relay_token is required for remote-cli (body.relay_token or GAUNTLET_RELAY_TOKEN)");
      const { RemoteCLIAdapter } = require("../../adapters/cli/remote-adapter");
      return new RemoteCLIAdapter({ baseUrl: relayUrl, token: relayToken });
    }
    default:
      throw new Error(`Unknown adapter type: ${type}`);
  }
}

export function runRoutes(dataDir: string, broadcaster?: RunBroadcaster, errorLog?: ErrorLog) {
  const router = new Hono();
  const storiesDir = join(dataDir, "stories");

  router.post("/:id", async (c) => {
    const entry = findCard(storiesDir, c.req.param("id"));
    if (!entry) return c.json({ error: "not found" }, 404);

    const body = await c.req.json().catch(() => ({}));
    const target = body.target as string | undefined;
    if (!target) return c.json({ error: "target is required" }, 400);

    const adapterType = (body.adapter as string) || "web";
    const model = (body.model as string) || process.env.GAUNTLET_AGENT_MODEL;
    if (!model) return c.json({ error: "no model configured (set GAUNTLET_AGENT_MODEL or pass model in body)" }, 400);

    const client = createClient(model);
    const outDir = join(dataDir, "results", entry.card.id);
    const logger = new EvidenceLogger(outDir);
    if (broadcaster) {
      logger.onAction = (action, params) => {
        broadcaster.send(entry.card.id, {
          type: "progress",
          message: `[${action}] ${JSON.stringify(params)}`,
          status: "running",
          card: entry.card.id,
        });
      };
    }
    const adapter = createAdapter(adapterType, body.chrome, {
      relayUrl: body.relay_url as string | undefined,
      relayToken: body.relay_token as string | undefined,
    });

    let streamer: ScreencastStreamerType | undefined;
    try {
      await adapter.start(target);

      if (adapterType === "web" && broadcaster) {
        const { ScreencastStreamer } = await import("../../streaming/screencast");
        const framesDir = join(outDir, "frames");
        streamer = new ScreencastStreamer(0, (frame) => {
          broadcaster.send(entry.card.id, {
            type: "frame",
            data: frame.data,
            width: frame.metadata.width,
            height: frame.metadata.height,
          });
        }, framesDir);
        await streamer.start();
      }

      const result = await runAgent(entry.card, adapter, client, logger, target);
      writeResultFiles(outDir, result);

      if (broadcaster) {
        broadcaster.send(entry.card.id, { type: "complete", result });
      }

      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errorLog?.add("run", `${entry.card.id}: ${message}`);
      throw err;
    } finally {
      if (streamer) await streamer.stop();
      await adapter.close();
    }
  });

  return router;
}
