// The colour round a slide when it is shown on a screen of another shape. The slide is always shown whole and centred at its
// own proportions (the page setup of the deck), so a screen that is wider or taller than the slide has bars; they are the
// matte. Black is what a projector shows best and is what a presentation has always had; the other two are the deck's own
// colours, for a deck that wants the bars to look like part of it.

import type { Deck } from "@kasten-slides/wasm";

import { colorOf } from "../theme/index.ts";

export type Matte = "black" | "paper" | "dark";

export const MATTES: readonly { value: Matte; label: string }[] = [
  { value: "black", label: "Black" },
  { value: "paper", label: "Theme background" },
  { value: "dark", label: "Theme dark colour" },
];

/** Where the choice is kept in this browser. */
export const MATTE_KEY = "ks-present-matte";

/** The relative luminance of a `#rrggbb` colour, 0 to 1. */
function luminance(hex: string): number {
  const channel = (at: number): number => {
    const value = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/**
 * The colour of the matte for a deck: black, the theme's background, or the theme's dark colour, which is the darker of its
 * background and its text colour (the ink of a light theme, the paper of a dark one).
 */
export function matteColor(deck: Deck, matte: Matte): string {
  if (matte === "black") return "#000000";
  const paper = colorOf(deck.theme, "bg1");
  if (matte === "paper") return paper;
  const ink = colorOf(deck.theme, "text1");
  const hex = /^#[0-9a-f]{6}$/i;
  return hex.test(paper) && hex.test(ink) && luminance(ink) < luminance(paper) ? ink : paper;
}

/** The matte chosen in this browser; black until the person chooses another. */
export function readMatte(): Matte {
  try {
    const stored = localStorage.getItem(MATTE_KEY);
    return MATTES.some((matte) => matte.value === stored) ? (stored as Matte) : "black";
  } catch {
    return "black";
  }
}

export function writeMatte(matte: Matte): void {
  try {
    localStorage.setItem(MATTE_KEY, matte);
  } catch {
    // Nothing is remembered; the choice still holds for the presentation that is open.
  }
}
