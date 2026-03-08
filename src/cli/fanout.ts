import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { parseStoryCard } from "../format/story-card";
import { generateFanout, generateFromObservations, generateFromFailure } from "../fanout/generator";
import { createClient } from "../models/resolve";
import type { ModelConfig, VetResult } from "../types";

export async function fanout(
  scenarioPath: string | undefined,
  outDir: string,
  models: ModelConfig,
  resultDir?: string
): Promise<void> {
  if (resultDir) {
    await fanoutFromResult(resultDir, outDir, models);
  } else if (scenarioPath) {
    await fanoutFromScenario(scenarioPath, outDir, models);
  } else {
    throw new Error("Either scenarioPath or resultDir must be provided");
  }
}

async function fanoutFromScenario(
  scenarioPath: string,
  outDir: string,
  models: ModelConfig
): Promise<void> {
  const content = readFileSync(scenarioPath, "utf-8");
  const card = parseStoryCard(content);
  const model = models.fanout || models.agent;
  const client = createClient(model);

  const cards = await generateFanout(card, client);

  mkdirSync(outDir, { recursive: true });
  for (let i = 0; i < cards.length; i++) {
    const filename = `${card.id}-${String.fromCharCode(97 + i)}.md`;
    writeFileSync(join(outDir, filename), cards[i] + "\n");
    console.error(`Generated: ${filename}`);
  }

  console.log(JSON.stringify({ parent: card.id, generated: cards.length }));
}

async function fanoutFromResult(
  resultDir: string,
  outDir: string,
  models: ModelConfig
): Promise<void> {
  const resultPath = join(resultDir, "result.json");
  const content = readFileSync(resultPath, "utf-8");
  const result: VetResult = JSON.parse(content);

  const model = models.fanout || models.agent;
  const client = createClient(model);

  const allCards: string[] = [];

  if (result.observations.length > 0) {
    const obsCards = await generateFromObservations(result, client);
    allCards.push(...obsCards);
  }

  if (result.status === "fail") {
    const failCards = await generateFromFailure(result, client);
    allCards.push(...failCards);
  }

  mkdirSync(outDir, { recursive: true });
  for (let i = 0; i < allCards.length; i++) {
    const filename = `${result.scenario}-${String.fromCharCode(97 + i)}.md`;
    writeFileSync(join(outDir, filename), allCards[i] + "\n");
    console.error(`Generated: ${filename}`);
  }

  console.log(JSON.stringify({ scenario: result.scenario, generated: allCards.length }));
}
