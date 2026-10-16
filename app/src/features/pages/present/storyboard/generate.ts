// Making the deck of a storyboard: a new deck in the chosen template and shape, the storyboard's slides added in one batch (so one undo in the
// editor would take them all back), saved in the vault as any new deck is. The slides remember the sections of the page they came from.

import { DeckEngine, loadSlides, pageSizes } from "@kasten-slides/wasm";
import type { AddedStoryboard, Omitted, StoryEntry } from "@kasten-slides/wasm";

import type { VaultClient } from "../../../../lib/vault/types";
import { MINE } from "../../../slides/TemplateGallery";
import { deckFromTemplate } from "../../../slides/templates";

type Batch = Parameters<DeckEngine["applyBatch"]>[0];

/** What to make. */
export interface Plan {
  /** The deck's title; a plain name (no brackets, bars or line breaks). */
  title: string;
  /** The project to make it in; the library when null. */
  project: string | null;
  entries: StoryEntry[];
  /** A built-in theme by name, or `mine:` and the path of a template of the person's own. */
  template: string;
  /** A page size by name (16:9, 4:3 ...); empty for the template's own. */
  shape: string;
}

/** What was made. */
export interface Generated {
  /** Where the deck is in the vault. */
  path: string;
  /** How many slides the storyboard made (the title slide is not among them). */
  slides: number;
  /** What the storyboard asked for that the slides do not have, or are not kept in step with the page for. */
  omitted: Omitted[];
}

/** A deck needs a plain name: no brackets, bars or line breaks. */
export const deckName = (title: string): string => title.replace(/[[\]|\n\r]/g, " ").replace(/\s+/g, " ").trim() || "Deck";

/** Makes the deck and saves it. Throws, in words for the person, when the vault or the engine refuses. */
export async function generateDeck(client: VaultClient, plan: Plan): Promise<Generated> {
  await loadSlides();
  const title = deckName(plan.title);
  const own = plan.template.startsWith(MINE);
  const engine = own ? DeckEngine.open(await deckFromTemplate(client, plan.template.slice(MINE.length), title, false)) : DeckEngine.create(title, plan.template);
  let text: string;
  let made: AddedStoryboard;
  try {
    const operations: Batch = [];
    const size = pageSizes().find((shape) => shape.name === plan.shape);
    if (size && (engine.deck.size.w !== size.w || engine.deck.size.h !== size.h)) operations.push(["set_page_size", { preset: size.name }]);
    operations.push(["add_storyboard_slides", { entries: plan.entries }]);
    const applied = engine.applyBatch(operations);
    made = applied[applied.length - 1]?.output as AddedStoryboard;
    text = engine.save();
  } finally {
    engine.dispose();
  }
  const path = await client.createDeck(title, plan.project, text);
  return { path, slides: made.slides.length, omitted: made.omitted };
}
