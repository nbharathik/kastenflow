// A layout drawn as a slide made of it: what its thumbnail shows. The slots hold a word or two of what they are for, so the
// thumbnail has the layout's own type, boxes, decoration and background, and a person can tell a title from a list at a glance.

import type { Element, Layout, PlaceholderDef, Slide } from "@kasten-slides/wasm";

/** What a slot says in a thumbnail, by role; any other role says what its prompt asks for. */
const WORDS: Record<string, string> = { title: "Title", subtitle: "Subtitle", body: "Text", text: "Text", number: "42", quote: "A short quote", caption: "Caption", label: "Label", code: "code()" };

function wordsOf(slot: PlaceholderDef): string {
  const known = WORDS[slot.role.replace(/\d+$/, "")];
  if (known) return known;
  const asked = slot.prompt.replace(/^click to add\s+/i, "").trim();
  return asked ? asked.charAt(0).toUpperCase() + asked.slice(1) : "Text";
}

/** The points of a list a thumbnail shows, as many as the slot has room for. */
function pointsIn(slot: PlaceholderDef, first: string): string[] {
  const rows = Math.max(1, Math.min(3, Math.floor(slot.h / 56)));
  return [first, "Second point", "Third point"].slice(0, rows);
}

function sampleElement(slot: PlaceholderDef, at: number): Element {
  const id = `sample-${at}`;
  if (slot.kind === "image") {
    return { type: "shape", id, shape: "roundRect", x: slot.x, y: slot.y, w: slot.w, h: slot.h, style: { fill: { color: "bg2" }, radius: 12 } } as Element;
  }
  const lines = slot.list ? pointsIn(slot, wordsOf(slot)) : [wordsOf(slot)];
  return {
    type: "text",
    id,
    placeholder: slot.role,
    text: { paragraphs: lines.map((t) => ({ runs: [{ t }], ...(slot.list ? { list: slot.list } : {}) })) },
  } as Element;
}

const kept = new WeakMap<Layout, Slide>();

/** A slide on `layout` with its slots filled for a thumbnail. The same slide for the same layout object, so a thumbnail is drawn again only when its layout changed. */
export function sampleSlide(layout: Layout): Slide {
  const found = kept.get(layout);
  if (found) return found;
  const slide: Slide = { id: "sample", layout: layout.name, elements: layout.placeholders.map(sampleElement) };
  kept.set(layout, slide);
  return slide;
}
