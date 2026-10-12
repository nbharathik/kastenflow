// The layouts of the deck's theme as menu rows, for the Slide menu and the Layout button of the toolbar: the one the slide shown is on is checked.

import type { CommandContext } from "../commands/index.ts";
import { layoutRows } from "../layouts/LayoutMenu.tsx";
import type { Row } from "./build.ts";

/**
 * One row for each layout, the person's own first, each with a live thumbnail; choosing one puts the slide shown (or the slides picked
 * in the filmstrip) on it, as one step (see `layouts/LayoutMenu`).
 */
export function layoutItems({ session }: CommandContext): Row[] {
  return layoutRows(session);
}
