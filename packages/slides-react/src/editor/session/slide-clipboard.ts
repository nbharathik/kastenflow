// Copy, cut and paste of slides, the filmstrip's and the grid's clipboard. A copy is the slides themselves (their notes, flags, transition,
// background, elements and steps), the sections that began at them, and where the slots of each were, so that they can go into another deck
// whose theme has no such layout. A paste is one batch of operations: one step of undo.

import type { Deck, Element, Slide } from "@kasten-slides/wasm";

import { newStamp, type SlidesClip } from "../clipboard/format.ts";
import { remember } from "../clipboard/store.ts";
import { wordsOf } from "../clipboard/words.ts";
import { boxOf } from "../../theme/index.ts";
import type { EditorSession } from "./session.ts";
import { blankLayoutOf } from "./slides.ts";
import type { Box } from "./types.ts";

type Operations = Parameters<EditorSession["core"]["applyBatch"]>[0];

/** An id for a slide that none of `taken` has: `s-` and eight characters of base 36, as the engine makes them. */
function freshSlideId(taken: ReadonlySet<string>): string {
  for (;;) {
    const id = `s-${Array.from({ length: 8 }, () => Math.floor(Math.random() * 36).toString(36)).join("")}`;
    if (!taken.has(id)) return id;
  }
}

/** Where the slots of a slide are: the boxes of the elements that take their place from the layout. */
function pinsOf(deck: Deck, slide: Slide): Record<string, Box> {
  const pins: Record<string, Box> = {};
  for (const element of slide.elements) {
    if (!element.placeholder) continue;
    const box = boxOf(deck.theme, slide.layout, element);
    if (box) pins[element.id] = box;
  }
  return pins;
}

/** The slide in a deck whose theme has no layout of its name: it gets one the theme has, and its slots become plain boxes where they were. */
function fitted(slide: Slide, deck: Deck, pins: Record<string, Box> | undefined): void {
  if (deck.theme.layouts.some((layout) => layout.name === slide.layout)) return;
  const layout = blankLayoutOf(deck) ?? deck.theme.layouts[0]?.name;
  if (!layout) return;
  slide.layout = layout;
  for (const element of slide.elements as (Element & { placeholder?: string | null })[]) {
    if (!element.placeholder) continue;
    delete element.placeholder;
    const box = pins?.[element.id];
    if (box) Object.assign(element, box);
  }
}

export class SlideClipboard {
  constructor(private readonly s: EditorSession) {}

  /**
   * Copies slides, the ones picked in the filmstrip unless some are named. Answers the clip, or null when there are none to copy. A copy
   * that is not for the clipboard (slides dragged with Alt) is not remembered as what was last copied.
   */
  copy(ids: readonly string[] = this.s.state.slideSelection, options: { cut?: boolean; remember?: boolean } = {}): SlidesClip | null {
    const { deck } = this.s;
    const wanted = new Set(ids);
    const slides = deck.slides.filter((slide) => wanted.has(slide.id)).map((slide) => structuredClone(slide));
    if (slides.length === 0) return null;
    const pins: Record<string, Record<string, Box>> = {};
    for (const slide of slides) pins[slide.id] = pinsOf(deck, slide);
    const sections = (deck.sections ?? []).filter((section) => wanted.has(section.startsAt)).map((section) => ({ title: section.title, startsAt: section.startsAt }));
    const clip: SlidesClip = { v: 2, kind: "slides", stamp: newStamp(), slides, sections, pins, size: { w: deck.size.w, h: deck.size.h }, cut: options.cut === true };
    if (options.remember !== false) remember(clip, wordsOf(clip));
    return clip;
  }

  /** Copies and then deletes. A deck keeps one slide, so cutting all of them is refused, and said. */
  cut(ids: readonly string[] = this.s.state.slideSelection): SlidesClip | null {
    const clip = this.copy(ids, { cut: true });
    if (clip) this.s.slides.remove([...ids]);
    return clip;
  }

  /**
   * Puts the slides of a copy after the last slide picked (and the backup slides stacked under it), or, with `gap`, before the slide at
   * that place in the deck (0 is the start, the number of slides the end); selects them and shows the first.
   * Each takes a new id when its own is the id of a slide the deck has, and a section that began at one of them begins at its copy
   * only where that does not cut another section in two: at the end of the deck, or before a slide that begins one. Resolves to the new ids.
   */
  paste(clip: SlidesClip, options: { gap?: number } = {}): string[] {
    const { deck } = this.s;
    const order = deck.slides.map((slide) => slide.id);
    const picked = this.s.state.slideSelection.map((id) => order.indexOf(id)).filter((at) => at >= 0);
    const gap = options.gap === undefined ? undefined : Math.min(Math.max(Math.round(options.gap), 0), order.length);
    // The start has no slide to go after: the copies go after the first, and are moved above it in the same step.
    const toStart = gap === 0;
    const here = gap !== undefined ? Math.max(gap - 1, 0) : picked.length > 0 ? Math.max(...picked) : order.indexOf(this.s.state.slideId);
    const after = order[here];
    const taken = new Set(order);
    const renamed = new Map<string, string>();
    const slides = clip.slides.map((original) => {
      const slide = structuredClone(original);
      const id = !slide.id || taken.has(slide.id) ? freshSlideId(taken) : slide.id;
      taken.add(id);
      renamed.set(original.id, id);
      slide.id = id;
      fitted(slide, deck, clip.pins[original.id]);
      return slide;
    });
    // Where the block goes in the deck, to see what follows it: past the backup slides stacked under `after`.
    let at = toStart ? 0 : here + 1;
    while (!toStart && deck.slides[at]?.backup) at += 1;
    const next = deck.slides[at];
    const starting = new Set((deck.sections ?? []).map((section) => section.startsAt));
    const mayStart = here < 0 || next === undefined || starting.has(next.id);
    const ids = [...renamed.values()];
    // Slides from a deck of another size are refitted to this one as the engine refits a deck whose page size changes.
    const apart = clip.size !== undefined && (clip.size.w !== deck.size.w || clip.size.h !== deck.size.h);
    const operations: Operations = [["add_slides", { slides, ...(after ? { after } : {}), ...(apart && clip.size ? { fromSize: { w: clip.size.w, h: clip.size.h } } : {}) }]];
    if (toStart) operations.push(["move_slides", { ids, to: 0 }]);
    if (mayStart) {
      for (const section of clip.sections) {
        const slide = renamed.get(section.startsAt);
        if (slide) operations.push(["add_section", { at: slide, title: section.title }]);
      }
    }
    const done = this.s.run(() => this.s.core.applyBatch(operations));
    if (!done) return [];
    this.s.selectSlides(ids);
    return ids;
  }
}
