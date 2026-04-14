import { readFileSync } from "fs";
import { basename, extname, join } from "path";
import { parseStoryCard, type StoryCard } from "../format/story-card";
import { EvidenceLogger } from "../evidence/logger";
import { writeResultFiles } from "../evidence/writer";
import { runAgent } from "../agent/agent";
import { createClient } from "../models/resolve";
import { CLIAdapter } from "../adapters/cli/adapter";
import type { ModelConfig } from "../types";

export async function run(
  scenarioPaths: string[],
  target: string,
  outDir: string,
  adapterType: "web" | "cli" | "tui",
  models: ModelConfig,
  chromeEndpoint?: string
): Promise<void> {
  if (scenarioPaths.length === 0) {
    throw new Error("run() requires at least one scenario path");
  }

  // Read and parse all scenarios up front so we fail fast on bad input,
  // before starting an adapter.
  const loaded: { path: string; card: StoryCard }[] = scenarioPaths.map((p) => ({
    path: p,
    card: parseStoryCard(readFileSync(p, "utf-8")),
  }));

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
      adapter = new WebAdapter({ chrome: chromeEndpoint });
      await adapter.start(target);
      break;
    }
  }

  const multi = loaded.length > 1;
  const usedSlugs = new Set<string>();

  try {
    for (const { path, card } of loaded) {
      const scenarioOutDir = multi
        ? join(outDir, uniqueSlug(card, path, usedSlugs))
        : outDir;
      const logger = new EvidenceLogger(scenarioOutDir);
      const result = await runAgent(card, adapter, client, logger, target);
      writeResultFiles(scenarioOutDir, result);
      console.log(JSON.stringify(result, null, 2));
    }
  } finally {
    await adapter.close();
  }
}

function uniqueSlug(card: StoryCard, path: string, used: Set<string>): string {
  const base = card.id && card.id.length > 0
    ? card.id
    : basename(path, extname(path));
  let slug = base;
  let n = 2;
  while (used.has(slug)) {
    slug = `${base}-${n++}`;
  }
  used.add(slug);
  return slug;
}
