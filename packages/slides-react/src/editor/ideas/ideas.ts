// Design ideas: other ways to lay out the slide that is shown, worked out from what it holds and from the layouts of the deck's theme
// (a layout is a layout whether the theme made it or the person did, whether it came from My layouts or not). No model is asked;
// the same slide always gives the same ideas. An idea is a list of operations that one undo takes back, and the slide as it would look.

import type { DeckEngine, Deck, Element, Layout, Slide } from "@kasten-slides/wasm";

import { type Content, contentOf, hasContent } from "./content.ts";

type Operations = Parameters<DeckEngine["applyBatch"]>[0];
/** One operation of a batch, typed by its name: the tuple is checked against that operation's input. */
const step = (operation: Operations[number]): Operations[number] => operation;

export interface Idea {
  id: string;
  label: string;
  /** One line on what changes. */
  hint: string;
  /** The slide as it would look, for the thumbnail. */
  preview: Slide;
  operations: Operations;
}

/** The most ideas offered. */
export const MOST_IDEAS = 6;

const round = (n: number): number => Math.round(n);

/** What a layout is, in words a person would use, from where its slots are. */
export function describeLayout(layout: Layout, size: { w: number; h: number }): string {
  const slots = layout.placeholders;
  const picture = slots.find((slot) => slot.kind === "image");
  if (picture) {
    const area = (picture.w * picture.h) / (size.w * size.h);
    if (area >= 0.85) return "Full-bleed picture";
    return picture.x + picture.w / 2 < size.w / 2 ? "Picture left" : "Picture right";
  }
  const bodies = slots.filter((slot) => /^(body|text)\d*$/.test(slot.role));
  if (bodies.length >= 2) return bodies.length === 2 ? "Two columns" : `${bodies.length} columns`;
  if (slots.some((slot) => slot.role === "number")) return "Big number";
  if (slots.some((slot) => slot.role === "quote")) return "Quote";
  return layout.label;
}

/** The layouts the slide could move to, best first: every role that holds something must have a slot there. */
function layoutIdeas(deck: Deck, slide: Slide, content: Content): Idea[] {
  if (content.usedRoles.length === 0) return [];
  const scored = deck.theme.layouts
    .filter((layout) => layout.name !== slide.layout && content.usedRoles.every((role) => layout.placeholders.some((slot) => slot.role === role)))
    .map((layout) => {
      const filled = layout.placeholders.filter((slot) => content.usedRoles.includes(slot.role)).length;
      const empty = layout.placeholders.length - filled;
      // A slot with nothing to put in it is a prompt left on the slide: fewer of those is better.
      return { layout, score: filled - empty * 0.75 };
    })
    .sort((a, b) => b.score - a.score);
  return scored.map(({ layout }) => ({
    id: `layout:${layout.name}`,
    label: describeLayout(layout, deck.size),
    hint: `Use the "${layout.label}" layout`,
    preview: { ...slide, layout: layout.name },
    operations: [step(["set_layout", { slide: slide.id, layout: layout.name }])],
  }));
}

interface Boxes {
  [id: string]: { x: number; y: number; w: number; h: number };
}

/** A picture beside the words: the picture bleeds to one edge, the title and the words keep to the other side. */
function pictureBeside(deck: Deck, content: Content, side: "left" | "right"): Boxes | undefined {
  const picture = content.pictures[0];
  if (!picture) return undefined;
  const { w, h } = deck.size;
  const margin = round(w * 0.06);
  const share = round(w * 0.42);
  const photoX = side === "right" ? w - share : 0;
  const textX = side === "right" ? margin : share + margin;
  const textW = w - share - margin * 2;
  const boxes: Boxes = { [picture.id]: { x: photoX, y: 0, w: share, h } };
  const top = round(h * 0.09);
  let y = top;
  if (content.title) {
    const height = round(h * 0.22);
    boxes[content.title.id] = { x: textX, y, w: textW, h: height };
    y += height + round(h * 0.03);
  }
  const rest = content.bodies;
  const room = h - y - top;
  rest.forEach((body, i) => {
    const height = round(room / rest.length);
    boxes[body.id] = { x: textX, y: y + i * height, w: textW, h: height - (i < rest.length - 1 ? round(h * 0.02) : 0) };
  });
  return boxes;
}

/** Applies boxes to a copy of the slide, for the thumbnail. */
function moved(slide: Slide, boxes: Boxes, behind?: { id: string; veil: Element }): Slide {
  const elements = slide.elements.map((element) => (boxes[element.id] ? ({ ...element, ...boxes[element.id], placeholder: null } as Element) : element));
  if (!behind) return { ...slide, elements };
  // The picture goes to the back and the veil over it.
  const picture = elements.find((element) => element.id === behind.id);
  return { ...slide, elements: [...(picture ? [picture] : []), behind.veil, ...elements.filter((element) => element.id !== behind.id)] };
}

/** The veil that keeps words readable on a picture: the theme's own background colour, mostly clear. */
const veil = (deck: Deck): Element => ({ type: "shape", id: "idea-veil", shape: "rect", x: 0, y: 0, w: deck.size.w, h: deck.size.h, style: { fill: { color: "bg1", alpha: 0.8 } } }) as Element;

function arrangeIdeas(deck: Deck, slide: Slide, content: Content): Idea[] {
  const picture = content.pictures[0];
  if (!picture || (!content.title && content.bodies.length === 0)) return [];
  const ideas: Idea[] = [];
  for (const side of ["right", "left"] as const) {
    const boxes = pictureBeside(deck, content, side);
    if (!boxes) continue;
    ideas.push({
      id: `arrange:picture-${side}`,
      label: `Picture ${side}`,
      hint: `The picture fills the ${side} side, the words keep to the other`,
      preview: moved(slide, boxes),
      operations: [step(["transform_elements", { slide: slide.id, items: Object.entries(boxes).map(([id, box]) => ({ id, ...box })) }])],
    });
  }
  // Full-bleed: the picture covers the slide behind a veil, and the words stay where they are.
  const full = { x: 0, y: 0, w: deck.size.w, h: deck.size.h };
  ideas.push({
    id: "arrange:full-bleed",
    label: "Full-bleed picture",
    hint: "The picture fills the slide; the words sit on a light veil",
    preview: moved(slide, { [picture.id]: full }, { id: picture.id, veil: veil(deck) }),
    operations: [
      step(["transform_elements", { slide: slide.id, items: [{ id: picture.id, ...full }] }]),
      step(["reorder_elements", { slide: slide.id, ids: [picture.id], to: "back" }]),
      step(["add_elements", { slide: slide.id, elements: [veil(deck)], at: 1 }]),
    ],
  });
  return ideas;
}

/** Two or more bodies side by side in columns of the same width: the words of a slide that has no picture. */
function columnIdeas(deck: Deck, slide: Slide, content: Content): Idea[] {
  const bodies = content.bodies.filter((body) => body.type === "text");
  if (content.pictures.length > 0 || bodies.length < 2 || bodies.length > 4) return [];
  const { w, h } = deck.size;
  const margin = round(w * 0.06);
  const gap = round(w * 0.03);
  const top = content.title ? round(h * 0.34) : round(h * 0.12);
  const width = round((w - margin * 2 - gap * (bodies.length - 1)) / bodies.length);
  const boxes: Boxes = {};
  if (content.title) boxes[content.title.id] = { x: margin, y: round(h * 0.08), w: w - margin * 2, h: round(h * 0.2) };
  bodies.forEach((body, i) => {
    boxes[body.id] = { x: margin + i * (width + gap), y: top, w: width, h: h - top - round(h * 0.1) };
  });
  return [
    {
      id: "arrange:columns",
      label: bodies.length === 2 ? "Two columns" : `${bodies.length} columns`,
      hint: "The text boxes side by side, the same width",
      preview: moved(slide, boxes),
      operations: [step(["transform_elements", { slide: slide.id, items: Object.entries(boxes).map(([id, box]) => ({ id, ...box })) }])],
    },
  ];
}

/** Four to six ideas for the slide, or fewer when it has little to arrange. Arrangements of the slide's own pieces come first, then layouts. */
export function designIdeas(deck: Deck, slide: Slide, most = MOST_IDEAS): Idea[] {
  const content = contentOf(slide);
  if (!hasContent(content)) return [];
  const ideas = [...arrangeIdeas(deck, slide, content), ...columnIdeas(deck, slide, content)];
  const layouts = layoutIdeas(deck, slide, content);
  const seen = new Set(ideas.map((idea) => idea.label));
  for (const idea of layouts) {
    // Two layouts that look the same to a person are one idea.
    if (ideas.length >= most) break;
    if (seen.has(idea.label)) continue;
    seen.add(idea.label);
    ideas.push(idea);
  }
  return ideas.slice(0, most);
}
