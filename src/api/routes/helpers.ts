import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { parseStoryCard } from "../../format/story-card";
import type { StoryCard } from "../../format/story-card";

export function loadAllCards(storiesDir: string): { card: StoryCard; filename: string }[] {
  if (!existsSync(storiesDir)) return [];
  const files = readdirSync(storiesDir).filter((f) => f.endsWith(".md")).sort();
  return files.map((filename) => {
    const content = readFileSync(join(storiesDir, filename), "utf-8");
    return { card: parseStoryCard(content), filename };
  });
}

export function findCard(storiesDir: string, id: string): { card: StoryCard; filename: string } | undefined {
  return loadAllCards(storiesDir).find((entry) => entry.card.id === id);
}
