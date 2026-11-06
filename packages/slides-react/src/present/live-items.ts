// Which embeds and videos a slide shows at a step. Kept apart from the layer that plays them, so the show
// can tell cheaply whether a slide has any and load the layer (frames, players, page views) only when it does.

import type { Deck, Element, Slide } from "@kasten-slides/wasm";

import { stateAt } from "../render/index.ts";
import { type Box, boxOf } from "../theme/index.ts";

export type Embed = Extract<Element, { type: "embed" }>;
export type Video = Extract<Element, { type: "video" }>;

export interface Item {
  element: Embed | Video;
  box: Box;
  opacity: number;
}

/** The embeds and videos a slide shows at a step: not the ones a step hides, nor those in a group it hides. */
export function liveItems(deck: Deck, slide: Slide, step: number): Item[] {
  const found: Item[] = [];
  const walk = (elements: readonly Element[], hidden: boolean): void => {
    for (const element of elements) {
      const state = stateAt(element, step);
      if (element.type === "group") {
        walk(element.children, hidden || state === "hidden");
      } else if ((element.type === "embed" || element.type === "video") && !hidden && state !== "hidden") {
        const box = boxOf(deck.theme, slide.layout, element);
        if (box) found.push({ element, box, opacity: (element.style?.opacity ?? 1) * (state === "dimmed" ? deck.theme.dimmedOpacity : 1) });
      }
    }
  };
  walk(slide.elements, false);
  return found;
}
