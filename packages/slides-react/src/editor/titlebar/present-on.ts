// "Present on" in the Slideshow drop-down: which display the show fills. Offered only when the host has a choice to make (two or more
// displays); the host keeps the choice for this computer.

import type { PresentScreens, ScreenInfo } from "../host.ts";
import { type Row, plainItem } from "../menus/build.ts";

/** What a display is called in the menu: "Main screen" or "Screen 2", with its own name after it when that says something more. */
export function screenLabel(info: ScreenInfo, index: number): string {
  const place = info.primary ? "Main screen" : `Screen ${index + 1}`;
  return info.label === place ? place : `${place} (${info.label})`;
}

/**
 * The rows of the choice: automatic, the screen the window is on, and each display (by place and name when the host says which is the
 * main one, by name alone when it does not), and a way to flash the numbers. None where there is only one display.
 */
export function presentOnRows(screens: PresentScreens | undefined, names: readonly string[], info: readonly ScreenInfo[] = []): Row[] {
  if (!screens || names.length < 2) return [];
  const chosen = screens.chosen();
  const shown = info.length === names.length ? info.map((one, i) => ({ value: one.label, label: screenLabel(one, i) })) : names.map((name) => ({ value: name, label: name }));
  return [
    plainItem("on-auto", "Automatic", () => screens.choose("auto"), { checked: chosen === "auto" }),
    plainItem("on-here", "This screen", () => screens.choose("here"), { checked: chosen === "here" }),
    ...shown.map(({ value, label }) => plainItem(`on-${value}`, label, () => screens.choose(`name:${value}`), { checked: chosen === `name:${value}` })),
    ...(screens.identify ? [plainItem("on-identify", "Identify screens", () => void screens.identify?.())] : []),
  ];
}
