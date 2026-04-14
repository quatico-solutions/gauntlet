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
  adapterType: "web" | "cli" | "tui",
  models: ModelConfig,
  chromeEndpoint?: string
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
    case "tui": {
      const { TUIAdapter } = await import("../adapters/tui/adapter");
      adapter = new TUIAdapter();
      await adapter.start(target);
      break;
    }
    case "web": {
      const { WebAdapter } = await import("../adapters/web/adapter");
      let chrome: { host: string; port: number } | undefined;
      if (chromeEndpoint) {
        const idx = chromeEndpoint.lastIndexOf(":");
        if (idx === -1) throw new Error(`Invalid --chrome "${chromeEndpoint}": expected host:port`);
        chrome = { host: chromeEndpoint.slice(0, idx), port: parseInt(chromeEndpoint.slice(idx + 1), 10) };
      }
      adapter = new WebAdapter({ chrome });
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
