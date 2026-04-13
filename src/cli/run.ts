import { readFileSync } from "fs";
import { parseStoryCard } from "../format/story-card";
import { EvidenceLogger } from "../evidence/logger";
import { writeResultFiles } from "../evidence/writer";
import { runAgent } from "../agent/agent";
import { createClient } from "../models/resolve";
import { CLIAdapter } from "../adapters/cli/adapter";
import type { ModelConfig } from "../types";

export async function run(
  scenarioPath: string,
  target: string,
  outDir: string,
  adapterType: "web" | "cli" | "tui" | "remote-cli",
  models: ModelConfig,
  chromeEndpoint?: string,
  relayUrl?: string,
  relayToken?: string,
): Promise<void> {
  const content = readFileSync(scenarioPath, "utf-8");
  const card = parseStoryCard(content);
  const logger = new EvidenceLogger(outDir);
  const client = createClient(models.agent);

  let adapter;
  switch (adapterType) {
    case "cli":
      adapter = new CLIAdapter();
      await adapter.start(target);
      break;
    case "remote-cli": {
      if (!relayUrl) throw new Error("--relay-url (or GAUNTLET_RELAY_URL) is required for --adapter remote-cli");
      if (!relayToken) throw new Error("--relay-token (or GAUNTLET_RELAY_TOKEN) is required for --adapter remote-cli");
      const { RemoteCLIAdapter } = await import("../adapters/cli/remote-adapter");
      adapter = new RemoteCLIAdapter({ baseUrl: relayUrl, token: relayToken });
      await adapter.start(target);
      break;
    }
    case "tui": {
      const { TUIAdapter } = await import("../adapters/tui/adapter");
      adapter = new TUIAdapter();
      await adapter.start(target);
      break;
    }
    case "web": {
      const { WebAdapter } = await import("../adapters/web/adapter");
      adapter = new WebAdapter({ chrome: chromeEndpoint });
      await adapter.start(target);
      break;
    }
  }

  try {
    const result = await runAgent(card, adapter, client, logger, target);
    writeResultFiles(outDir, result);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await adapter.close();
  }
}
