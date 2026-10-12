// "Turn sections into a deck": the page's sections become the slides of a new
// deck in the page's project, made here with the slide engine's own operations
// and saved as any new deck is. The page is not changed.

import type { DeckEngine } from "@kasten-slides/wasm";

import type { NoteMeta } from "../../../lib/vault/types";
import { titleOf } from "../../workspace/names";
import { useWorkspace } from "../../workspace/store";
import { useDecks } from "../../slides/store";
import { sectionTexts } from "../editor/sections/registry";
import { slidesOfSections, type SlideText } from "./section-slides";

type Batch = Parameters<DeckEngine["applyBatch"]>[0];

/** The operations that add a slide for each text. */
export function addSlides(slides: readonly SlideText[]): Batch {
  return slides.map((slide): Batch[number] => [
    "add_slide",
    {
      ...(slide.layout ? { layout: slide.layout } : {}),
      content: { title: slide.title, ...(slide.body ? { body: slide.body } : {}) },
      notes: slide.notes || null,
    },
  ]);
}

/** A deck needs a plain name: no brackets, bars or line breaks. */
const deckName = (title: string) => title.replace(/[[\]|\n\r]/g, " ").replace(/\s+/g, " ").trim() || "Deck";

/** Makes a deck of the sections of `note`, which must be open, and opens it. Says in a toast what it did, or why it could not. */
export async function turnSectionsIntoDeck(note: NoteMeta): Promise<void> {
  const { client, toast, openPath } = useWorkspace.getState();
  const sections = sectionTexts(note.id || note.path);
  if (!client) return;
  if (!sections || sections.length === 0) {
    toast("This page has nothing to turn into slides yet. A line of --- starts a new section.");
    return;
  }
  try {
    const slides = slidesOfSections(sections);
    // The slide engine loads only now: a page that makes no deck never needs it.
    const { DeckEngine, loadSlides } = await import("@kasten-slides/wasm");
    await loadSlides();
    const title = deckName(titleOf(note));
    const engine = DeckEngine.create(title, "Light");
    let text: string;
    try {
      engine.applyBatch(addSlides(slides));
      text = engine.save();
    } finally {
      engine.dispose();
    }
    const path = await client.createDeck(title, note.project ?? null, text);
    await useDecks.getState().load();
    openPath(path);
    const pictures = slides.reduce((n, slide) => n + slide.pictures, 0);
    const left = pictures > 0 ? ` ${pictures === 1 ? "A picture was" : `${pictures} pictures were`} left out: add ${pictures === 1 ? "it" : "them"} in the deck.` : "";
    toast(`Made “${title}” from ${slides.length === 1 ? "1 section" : `${slides.length} sections`} as slides.${left}`);
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err));
  }
}
