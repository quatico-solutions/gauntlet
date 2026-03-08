import { Hono } from "hono";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { parseStoryCard } from "../../format/story-card";
import { generateFanout } from "../../fanout/generator";
import { createClient } from "../../models/resolve";
import type { LLMClient } from "../../models/provider";
import { findCard } from "./helpers";

export function fanoutRoutes(dataDir: string, clientFactory?: () => LLMClient) {
  const router = new Hono();
  const storiesDir = join(dataDir, "stories");

  router.post("/:id", async (c) => {
    const entry = findCard(storiesDir, c.req.param("id"));
    if (!entry) return c.json({ error: "not found" }, 404);

    let client: LLMClient;
    if (clientFactory) {
      client = clientFactory();
    } else {
      const model = process.env.VET_FANOUT_MODEL || process.env.VET_AGENT_MODEL;
      if (!model) {
        return c.json({ error: "no model configured (set VET_FANOUT_MODEL or VET_AGENT_MODEL)" }, 400);
      }
      client = createClient(model);
    }

    const cardTexts = await generateFanout(entry.card, client);

    mkdirSync(storiesDir, { recursive: true });

    const generated = cardTexts.map((text) => {
      const card = parseStoryCard(text);
      const filename = `${card.id}.md`;
      writeFileSync(join(storiesDir, filename), text);
      return { id: card.id, title: card.title, filename };
    });

    return c.json({ parent: entry.card.id, generated });
  });

  return router;
}
