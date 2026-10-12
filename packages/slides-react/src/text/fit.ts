// Text fitting: "shrink text on overflow" sets the type smaller until the words
// fit their box, and "resize shape to fit text" makes the box as tall as its
// words. The maths is here; what is laid out is asked of the page, which is the
// only thing that knows how wide a word is.
//
// A box that is shrunk by `scale` is laid out `1 / scale` times as big and drawn
// `scale` times as big (see `boxCss`), so its words wrap as they would at the
// smaller size and its insets keep theirs, as PowerPoint sets them.

import type { Insets } from "@kasten-slides/wasm";

import { px } from "./css.ts";
import { MIN_FIT_SCALE } from "./metrics.ts";

/** Scales are whole hundredths. */
const STEPS = 100;

/**
 * The largest scale from `min` to 1, in hundredths, at which `fits` holds: 1 when
 * the words fit as they are, `min` when they do not fit even then. `fits` must hold
 * at every scale below one that holds.
 */
export function fitScale(fits: (scale: number) => boolean, min: number = MIN_FIT_SCALE): number {
  if (fits(1)) return 1;
  const floor = Math.ceil(Math.max(0.01, Math.min(1, min)) * STEPS);
  if (!fits(floor / STEPS)) return floor / STEPS;
  // `lo` fits and `hi` does not.
  let lo = floor;
  let hi = STEPS;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid / STEPS)) lo = mid;
    else hi = mid;
  }
  return lo / STEPS;
}

/** What a box's layout says about its words. */
export interface FitInput {
  /** The box in slide units. */
  width: number;
  height: number;
  /** The space between the box's edge and its words; they do not shrink. */
  insets: Insets;
}

/** The scale at which `heightAt(scale)`, the height the words take laid out in a box `1 / scale` as big, drawn at that scale, is no more than the box's. */
export function fitHeight(input: FitInput, heightAt: (scale: number) => number): number {
  // The height asked of the page includes the insets above and below, which were made `1 / scale` as big; drawn at `scale` they are what they were.
  return fitScale((scale) => scale * heightAt(scale) <= input.height + 0.5);
}

/** What measuring a box found. */
export interface Measured {
  /** The scale that makes the words fit. */
  scale: number;
  /** How tall the words are at the scale they have (insets included), in slide units. */
  natural: number;
  /** False where the page has no layout to ask (nothing is shown, or a test with no browser): nothing was found. */
  measured: boolean;
}

/**
 * Asks the page how tall the words of `box` are when it is laid out `1 / scale` times as big, for
 * the scales `fitHeight` tries, and how tall they are as they stand. The box's own style is put back.
 */
export function measureBox(box: HTMLElement, input: FitInput, shrink: boolean): Measured {
  const saved = box.getAttribute("style");
  const { insets } = input;
  try {
    // A box is placed with `inset: 0`: its bottom is let go too, or `auto` would be as tall as the place it is in, not as its words.
    box.style.height = "auto";
    box.style.bottom = "auto";
    box.style.transform = "none";
    const heightAt = (scale: number): number => {
      box.style.width = px(input.width / scale);
      box.style.padding = `${px(insets.top / scale)} ${px(insets.right / scale)} ${px(insets.bottom / scale)} ${px(insets.left / scale)}`;
      return box.offsetHeight;
    };
    const natural = heightAt(1);
    if (natural === 0) return { scale: 1, natural: 0, measured: false };
    return { scale: shrink ? fitHeight(input, heightAt) : 1, natural, measured: true };
  } finally {
    if (saved === null) box.removeAttribute("style");
    else box.setAttribute("style", saved);
  }
}

/** Measures that were made, by what they depend on, so a slide drawn again (a thumbnail, the presenter's) does not ask the page again. */
const found = new Map<string, Measured>();
const MOST_REMEMBERED = 600;

/** How many times fonts have finished loading: words measured before that were measured in another face. */
let fontEpoch = 0;
let watching = false;

function watchFonts(): void {
  if (watching || typeof document === "undefined" || !("fonts" in document)) return;
  watching = true;
  document.fonts.addEventListener("loadingdone", () => {
    fontEpoch += 1;
    found.clear();
    for (const listener of fontListeners) listener();
  });
}

const fontListeners = new Set<() => void>();

/** Calls `listener` when a font has finished loading, so measures are made again; returns how to stop. */
export function onFontsLoaded(listener: () => void): () => void {
  watchFonts();
  fontListeners.add(listener);
  return () => fontListeners.delete(listener);
}

/** `measureBox`, remembered by `key` (which must say everything the layout depends on). */
export function measureRemembered(key: string, box: HTMLElement, input: FitInput, shrink: boolean): Measured {
  watchFonts();
  const full = `${fontEpoch}|${shrink ? "s" : "r"}|${key}`;
  const known = found.get(full);
  if (known) return known;
  const made = measureBox(box, input, shrink);
  if (made.measured) {
    if (found.size >= MOST_REMEMBERED) found.clear();
    found.set(full, made);
  }
  return made;
}
