// "Present on" in the slideshow options: which display the show fills. Offered only when the host has a choice to make (two or more
// displays); the host keeps the choice for this computer.

import type { PresentScreens } from "../host.ts";
import { type Row, plainItem } from "../menus/build.ts";

/** The rows of the choice: automatic, the screen the window is on, and each display by name. None where there is only one display. */
export function presentOnRows(screens: PresentScreens | undefined, names: readonly string[]): Row[] {
  if (!screens || names.length < 2) return [];
  const chosen = screens.chosen();
  return [
    plainItem("on-auto", "Automatic", () => screens.choose("auto"), { checked: chosen === "auto" }),
    plainItem("on-here", "This screen", () => screens.choose("here"), { checked: chosen === "here" }),
    ...names.map((name) => plainItem(`on-${name}`, name, () => screens.choose(`name:${name}`), { checked: chosen === `name:${name}` })),
  ];
}
