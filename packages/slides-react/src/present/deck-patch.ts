// How the presenter's window keeps up with edits made while the show runs. The window is given the whole deck once; after that it is
// given only what changed: the slides that differ, the order they are in, the rest of the deck (theme, size, settings) when that
// differs, and the picture addresses when those do. A change that touches nothing the show draws sends nothing.

import type { Deck, Slide } from "@kasten-slides/wasm";

export interface DeckPatch {
  /** Every slide's id, in the deck's order. */
  order: string[];
  /** The slides that are new or differ, whole. */
  slides: Slide[];
  /** Everything of the deck but its slides, when it differs. */
  head?: Omit<Deck, "slides">;
  /** The addresses of the pictures, when they differ. */
  images?: Record<string, string>;
}

const headOf = (deck: Deck): Omit<Deck, "slides"> => {
  const { slides: _slides, ...head } = deck;
  return head;
};

/** Works out what changed since the last deck the presenter's window was given. */
export class PatchMaker {
  private slides = new Map<string, string>();
  private order = "";
  private head = "";
  private images = "";

  /** The deck was given whole: this is what the window now has. */
  reset(deck: Deck, images: Record<string, string>): void {
    this.slides = new Map(deck.slides.map((slide) => [slide.id, JSON.stringify(slide)]));
    this.order = JSON.stringify(deck.slides.map((slide) => slide.id));
    this.head = JSON.stringify(headOf(deck));
    this.images = JSON.stringify(images);
  }

  /** What to send for `deck`, or null when the window already has it all. */
  make(deck: Deck, images: Record<string, string>): DeckPatch | null {
    const order = deck.slides.map((slide) => slide.id);
    const orderText = JSON.stringify(order);
    const head = JSON.stringify(headOf(deck));
    const imagesText = JSON.stringify(images);
    const signatures = new Map(deck.slides.map((slide) => [slide.id, JSON.stringify(slide)]));
    const changed = deck.slides.filter((slide) => this.slides.get(slide.id) !== signatures.get(slide.id));
    const same = changed.length === 0 && orderText === this.order && head === this.head && imagesText === this.images;
    if (same) return null;
    this.slides = signatures;
    const patch: DeckPatch = { order, slides: changed };
    if (head !== this.head) patch.head = headOf(deck);
    if (imagesText !== this.images) patch.images = images;
    this.order = orderText;
    this.head = head;
    this.images = imagesText;
    return patch;
  }
}

/** The deck with a patch applied; null when the patch names a slide this deck does not have and the patch does not carry (the window is out of step and asks again). */
export function applyPatch(deck: Deck, patch: DeckPatch): Deck | null {
  const known = new Map(deck.slides.map((slide) => [slide.id, slide]));
  for (const slide of patch.slides) known.set(slide.id, slide);
  const slides: Slide[] = [];
  for (const id of patch.order) {
    const slide = known.get(id);
    if (!slide) return null;
    slides.push(slide);
  }
  return { ...(patch.head ?? headOf(deck)), slides } as Deck;
}
