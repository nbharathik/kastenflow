// How the pointer picks slides, for the filmstrip and the grid alike.

import type { Deck } from "@kasten-slides/wasm";

import type { EditorSession } from "../session/session.ts";
import type { EditorUi } from "../ui-state.ts";
import { extendedTo, toggled } from "./selection.ts";

/**
 * A click on a slide. Plain, it shows the slide and picks only it; with Ctrl
 * or Cmd it joins the pick or leaves it; with Shift it picks the range from
 * the slide shown. `visible` is the slides that can be seen, in deck order.
 */
export function pickSlide(session: EditorSession, visible: readonly string[], keys: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }, id: string): void {
  const { slideId, slideSelection } = session.state;
  if (keys.shiftKey) {
    const range = extendedTo(visible, slideId, id);
    session.selectSlides(range.ids, range.show);
  } else if (keys.ctrlKey || keys.metaKey) {
    const choice = toggled(visible, slideSelection, slideId, id);
    if (choice) session.selectSlides(choice.ids, choice.show);
  } else {
    session.selectSlides([id]);
  }
}

/** The slides of the section that starts at a slide, in deck order, folded away or not: from that slide up to the next section's first. */
export function slidesOfSection(deck: Pick<Deck, "slides" | "sections">, startsAt: string): string[] {
  const starts = new Set((deck.sections ?? []).map((section) => section.startsAt));
  const from = deck.slides.findIndex((slide) => slide.id === startsAt);
  if (from < 0) return [];
  const ids = [startsAt];
  for (const slide of deck.slides.slice(from + 1)) {
    if (starts.has(slide.id)) break;
    ids.push(slide.id);
  }
  return ids;
}

/** The name of a section pressed: its slides are the ones picked, the first is shown, and the elements of the slide are let go. */
export function pickSection(session: EditorSession, startsAt: string): void {
  const ids = slidesOfSection(session.state.deck, startsAt);
  if (ids.length > 0) session.selectSlides(ids);
}

/** A right click on a slide: the slide is picked first unless it is one of those already, then the slide menu opens at the pointer. */
export function openSlideMenu(session: EditorSession, ui: EditorUi, id: string, at: { x: number; y: number }): void {
  if (!session.state.slideSelection.includes(id)) session.selectSlides([id]);
  ui.openContextMenu({ kind: "slide", x: at.x, y: at.y });
}
