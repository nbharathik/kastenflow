import type { Changes, Deck, Element, Slide } from "./generated/index.ts";

/** Whether two plain JSON values hold the same thing. */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, at) => sameJson(item, b[at]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => Object.hasOwn(right, key) && sameJson(left[key], right[key]));
}

/** The elements of a slide as it is now, each the very object it was before when it says the same: views compare elements by identity first, so only what changed is drawn again. */
function sharedElements(before: readonly Element[], now: Element[]): Element[] {
  const byId = new Map(before.map((element) => [element.id, element]));
  return now.map((element) => {
    const was = byId.get(element.id);
    if (!was) return element;
    if (sameJson(was, element)) return was;
    if (was.type === "group" && element.type === "group") {
      const children = sharedElements(was.children, element.children);
      return children.every((child, i) => child === element.children[i]) ? element : { ...element, children };
    }
    return element;
  });
}

/** `slide` as the slide `before` goes on: the same object when nothing changed, else with every element that did not change the object it was. */
function sharedSlide(before: Slide, slide: Slide): Slide {
  if (sameJson(before, slide)) return before;
  return { ...slide, elements: sharedElements(before.elements, slide.elements) };
}

/**
 * The deck with `changes` applied, sharing every slide that did not change
 * with the deck it came from, so views that compare slides by identity skip
 * them, and in a slide that did change, every element that did not (the
 * engine hands over the whole slide, new objects all through). The Rust side
 * does the same for slides in `Changes::apply_to`.
 */
export function applyChanges(deck: Deck, changes: Changes): Deck {
  let slides: Slide[] = deck.slides;
  const touched = Object.entries(changes.slides);
  if (touched.length > 0) {
    slides = [...slides];
    for (const [id, slide] of touched) {
      const at = slides.findIndex((s) => s.id === id);
      if (slide) {
        if (at >= 0) slides[at] = sharedSlide(slides[at]!, slide);
        else slides.push(slide);
      } else if (at >= 0) {
        slides.splice(at, 1);
      }
    }
  }
  if (changes.order) {
    const byId = new Map(slides.map((s) => [s.id, s]));
    slides = changes.order.flatMap((id) => {
      const slide = byId.get(id);
      return slide ? [slide] : [];
    });
  }
  const next: Deck = { ...deck, slides };
  if (changes.theme) next.theme = changes.theme;
  if (changes.meta) {
    next.title = changes.meta.title;
    next.size = changes.meta.size;
    next.present = changes.meta.present;
    if (changes.meta.sections.length > 0) next.sections = changes.meta.sections;
    else delete next.sections;
  }
  return next;
}
