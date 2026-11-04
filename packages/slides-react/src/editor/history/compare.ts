// Comparing two versions of a deck, slide by slide: which slides are the same, which changed, which one version has and the other lacks.
// Pure; the dialog draws what this answers.

import type { Deck, Slide } from "@kasten-slides/wasm";

export type Difference = "same" | "changed" | "added" | "removed";

/** A slide of the comparison: the slide as `before` and as `after` have it (either may be missing), and how they differ. */
export interface SlideDifference {
  id: string;
  before: Slide | null;
  after: Slide | null;
  how: Difference;
}

/**
 * The slides of two versions side by side, in the order of `after` with the slides only `before` has put where they stood in `before`
 * (after the slide that preceded them there). A slide is changed when its content differs; so is one whose layout differs, or whose
 * theme or size does (the whole deck is drawn differently then).
 */
export function compareDecks(before: Deck, after: Deck): SlideDifference[] {
  const everything = JSON.stringify(before.theme) !== JSON.stringify(after.theme) || before.size.w !== after.size.w || before.size.h !== after.size.h;
  const old = new Map(before.slides.map((slide) => [slide.id, slide] as const));
  const now = new Map(after.slides.map((slide) => [slide.id, slide] as const));
  const rows: SlideDifference[] = after.slides.map((slide) => {
    const was = old.get(slide.id) ?? null;
    const how: Difference = was === null ? "added" : everything || JSON.stringify(was) !== JSON.stringify(slide) ? "changed" : "same";
    return { id: slide.id, before: was, after: slide, how };
  });
  // A slide only the older version has: put it after the slide that came before it there.
  before.slides.forEach((slide, i) => {
    if (now.has(slide.id)) return;
    const row: SlideDifference = { id: slide.id, before: slide, after: null, how: "removed" };
    let at = 0;
    for (let k = i - 1; k >= 0; k -= 1) {
      const kept = rows.findIndex((r) => r.id === before.slides[k]?.id);
      if (kept >= 0) {
        at = kept + 1;
        break;
      }
    }
    rows.splice(at, 0, row);
  });
  return rows;
}

/** How many slides are not the same. */
export function changedCount(rows: readonly SlideDifference[]): number {
  return rows.filter((row) => row.how !== "same").length;
}

/** Words for a difference, for a label under a thumbnail. */
export const DIFFERENCE_WORDS: Readonly<Record<Difference, string>> = {
  same: "Same",
  changed: "Changed",
  added: "Added",
  removed: "Removed",
};
