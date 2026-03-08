import { Hono } from "hono";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { parseStoryCard } from "../../format/story-card";
import { generateFanout, generateFromObservations, generateFromFailure } from "../../fanout/generator";
import { createClient } from "../../models/resolve";
import type { LLMClient } from "../../models/provider";
import type { VetResult } from "../../types";
import { findCard } from "./helpers";

function resolveClient(clientFactory?: () => LLMClient): LLMClient | { error: string } {
  if (clientFactory) return clientFactory();
  const model = process.env.VET_FANOUT_MODEL || process.env.VET_AGENT_MODEL;
  if (!model) return { error: "no model configured (set VET_FANOUT_MODEL or VET_AGENT_MODEL)" };
  return createClient(model);
}

function writeCards(storiesDir: string, cardTexts: string[], prefix: string) {
  mkdirSync(storiesDir, { recursive: true });
  return cardTexts.map((text, i) => {
    const card = parseStoryCard(text);
    const letter = String.fromCharCode(97 + i); // a, b, c, ...
    const filename = `${prefix}-${letter}.md`;
    writeFileSync(join(storiesDir, filename), text);
    return { id: card.id, title: card.title, filename };
  });
}

export function fanoutRoutes(dataDir: string, clientFactory?: () => LLMClient) {
  const router = new Hono();
  const storiesDir = join(dataDir, "stories");

  router.post("/:id", async (c) => {
    const entry = findCard(storiesDir, c.req.param("id"));
    if (!entry) return c.json({ error: "not found" }, 404);

    const clientOrError = resolveClient(clientFactory);
    if ("error" in clientOrError) return c.json({ error: clientOrError.error }, 400);

    const cardTexts = await generateFanout(entry.card, clientOrError);
    const generated = writeCards(storiesDir, cardTexts, entry.card.id);

    return c.json({ parent: entry.card.id, generated });
  });

  router.post("/:id/observations", async (c) => {
    const id = c.req.param("id");
    const resultPath = join(dataDir, "results", id, "result.json");
    if (!existsSync(resultPath)) return c.json({ error: "not found" }, 404);

    const result: VetResult = JSON.parse(readFileSync(resultPath, "utf-8"));
    if (result.observations.length === 0) return c.json({ parent: id, generated: [] });

    const clientOrError = resolveClient(clientFactory);
    if ("error" in clientOrError) return c.json({ error: clientOrError.error }, 400);

    const cardTexts = await generateFromObservations(result, clientOrError);
    const generated = writeCards(storiesDir, cardTexts, `${id}-obs`);

    return c.json({ parent: id, generated });
  });

  router.post("/:id/failure", async (c) => {
    const id = c.req.param("id");
    const resultPath = join(dataDir, "results", id, "result.json");
    if (!existsSync(resultPath)) return c.json({ error: "not found" }, 404);

    const result: VetResult = JSON.parse(readFileSync(resultPath, "utf-8"));
    if (result.status !== "fail") return c.json({ error: "result is not a failure" }, 400);

    const clientOrError = resolveClient(clientFactory);
    if ("error" in clientOrError) return c.json({ error: clientOrError.error }, 400);

    const cardTexts = await generateFromFailure(result, clientOrError);
    const generated = writeCards(storiesDir, cardTexts, `${id}-fail`);

    return c.json({ parent: id, generated });
  });

  return router;
}
