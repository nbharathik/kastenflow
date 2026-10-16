// The keys that add something at once: T a text box, R a rectangle, O an oval.
// Each goes where the pointer is over the slide, or else to a free place near
// the top left third of it, and is selected; a text box is open for typing.
// The toolbar's buttons and the Insert menu keep arming the tool, to be placed
// with a click or a drag; these are the quick way.

import { type Rect, boundsOf } from "@kasten-slides/canvas";

import { itemsOf } from "../canvas/geometry.ts";
import { pointerOf } from "../canvas/pointer.ts";
import type { CommandContext } from "../commands/types.ts";
import { shape, textBox } from "../factory.ts";
import { masterBoxes, occupiedBy } from "../placement.ts";
import { CLICK_SIZE } from "../shapes.ts";
import { markFresh } from "./fresh.ts";
import { SNAP, freeSpot, spotAt } from "./spot.ts";

/** Where a box of this size goes now: at the pointer if it is over the slide, else where it last was on the slide, else where there is room. */
export function boxNow({ session, ui }: CommandContext, size: { w: number; h: number }): Rect {
  const slide = session.deck.size;
  const at = pointerOf(ui).slidePoint() ?? pointerOf(ui).lastSlidePoint();
  if (at) {
    const zoom = ui.state.zoom === "fit" ? ui.state.fitZoom : ui.state.zoom;
    return spotAt(at, size, slide, itemsOf(session).map(boundsOf), ui.state.snap ? SNAP / zoom : null);
  }
  const { theme } = session.deck;
  const { layout, elements } = session.slide;
  return freeSpot(size, [...occupiedBy(theme, layout, elements, slide), ...masterBoxes(theme, layout, slide)], slide);
}

/** A text box, selected and open with the caret in it. If it is closed with nothing typed it goes again (see `settleFresh`). */
export function addTextBoxNow(context: CommandContext): void {
  const { session } = context;
  const [id] = session.elements.insert([textBox(boxNow(context, CLICK_SIZE.text))]);
  if (!id) return;
  markFresh(session, id);
  session.startEditing(id);
}

/** A shape at its usual size, selected, not open for typing. */
export function addShapeNow(context: CommandContext, preset: string): void {
  context.session.elements.insert([shape(preset, boxNow(context, CLICK_SIZE.shape))]);
}
