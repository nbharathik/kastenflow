// Custom shows: a named subset of a deck's slides, played in the order the show names them. The show is made by giving the presentation
// a deck of just those slides, so the plan, the presenter's window, the numbers and the exports all see a short deck and need no
// special case. A slide the show names that the deck no longer has is skipped; a show with none left plays the whole deck.

import type { CustomShow, Deck, Slide } from "@kasten-slides/wasm";

/** The deck's custom shows (none for a deck that never made one). */
export const customShows = (deck: Deck): CustomShow[] => deck.present.shows ?? [];

/** The slides a custom show plays: the ones it names that the deck has, in the show's order. A slide it plays is never hidden, and is never a backup. */
export function slidesOfShow(deck: Deck, show: CustomShow): Slide[] {
  const byId = new Map(deck.slides.map((slide) => [slide.id, slide]));
  return show.slides.flatMap((id) => {
    const slide = byId.get(id);
    if (!slide) return [];
    const { hidden: _hidden, backup: _backup, ...shown } = slide;
    return [shown as Slide];
  });
}

/** The deck as a custom show plays it; the deck itself when no show is named, or the one named is gone or has no slide left. */
export function showDeck(deck: Deck, showId: string | null | undefined): Deck {
  if (!showId) return deck;
  const show = customShows(deck).find((candidate) => candidate.id === showId);
  const slides = show ? slidesOfShow(deck, show) : [];
  return slides.length === 0 ? deck : { ...deck, slides, sections: [] };
}
