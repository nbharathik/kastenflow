// Drawing sections as slide-like cards, and showing one slide at a time while
// presenting. Both are decorations over the page's top-level blocks, and both
// stay few however long the page is: ProseMirror weighs every block against
// every decoration each time the page changes, so one decoration for each of
// 6,000 blocks makes every keystroke wait. A card is a title bar widget before
// its first block, which is marked `is-sec-start`, a bottom edge widget after
// its last, marked `is-sec-end`, and the blocks between them need nothing: CSS
// draws every block of the page that is not a divider or one of these widgets
// as the inside of a card. While presenting, the blocks of the slide shown
// are marked `kasten-slide-now` and CSS hides the rest. The Markdown never
// changes.

import type { Node } from "@milkdown/kit/prose/model";
import type { Transaction } from "@milkdown/kit/prose/state";
import { AddMarkStep, RemoveMarkStep, ReplaceStep } from "@milkdown/kit/prose/transform";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";

import { sectionFoot, sectionHead } from "./heads";
import { LOAD_META, SMART_META, type SmartMeta, type SmartState } from "./key";
import { isDivider, keyOf, sectionsOf, sectionTitle } from "./model";
import { slidesOf, type Slide } from "./slides";

export const EMPTY_SMART: SmartState = { on: false, present: null, slides: 0, title: "", whole: false, decorations: DecorationSet.empty, foldRev: 0, typed: 0, typedAt: 0 };

/** A block's place: where it starts and how far it goes. */
type Place = [pos: number, size: number];

/** The first and the last block of each section, by the section's number, found in one pass over the page's blocks. */
function edges(doc: Node): { first: Place[]; last: Place[] } {
  const first: Place[] = [];
  const last: Place[] = [];
  let at = 0;
  doc.forEach((child, offset) => {
    if (isDivider(child)) {
      at++;
      return;
    }
    first[at] ??= [offset, child.nodeSize];
    last[at] = [offset, child.nodeSize];
  });
  return { first, last };
}

/** Every section a card: a title bar before it, a bottom edge after it, and its first and last block marked. */
function cards(doc: Node, folded: ReadonlySet<number>): DecorationSet {
  const found: Decoration[] = [];
  const { first, last } = edges(doc);
  for (const section of sectionsOf(doc)) {
    // The part before the first divider is a card only when it holds something.
    if (section.divider === null && section.blocks === 0) continue;
    const isFolded = folded.has(keyOf(section));
    const title = sectionTitle(doc, section);
    const spec = { index: section.index, folded: isFolded, title, first: section.divider === null };
    found.push(
      Decoration.widget(section.divider ?? 0, (view, getPos) => sectionHead(view, getPos, spec), {
        side: -1,
        key: `head:${section.index}:${isFolded ? "folded" : "open"}:${title}`,
        stopEvent: () => true,
        ignoreSelection: true,
      }),
    );
    const start = first[section.index];
    const end = last[section.index];
    if (start && end) {
      // A section of one block starts and ends with it.
      if (start[0] === end[0]) found.push(Decoration.node(start[0], start[0] + start[1], { class: "is-sec-start is-sec-end" }));
      else found.push(Decoration.node(start[0], start[0] + start[1], { class: "is-sec-start" }), Decoration.node(end[0], end[0] + end[1], { class: "is-sec-end" }));
    }
    // The card's bottom edge, drawn before the next section's title bar, which sits at the same place.
    const empty = section.blocks === 0;
    found.push(
      Decoration.widget(section.to, (view, getPos) => sectionFoot(view, getPos, { folded: isFolded, empty }), {
        side: -2,
        key: `foot:${section.index}:${isFolded ? "folded" : "open"}:${empty ? "empty" : "full"}`,
        stopEvent: () => true,
        ignoreSelection: true,
      }),
    );
  }
  return DecorationSet.create(doc, found);
}

/** The blocks of one slide, marked as the ones to show; none when the slide is the whole page, which has nothing to hide. */
function slideNow(doc: Node, slide: Slide): DecorationSet {
  if (slide.from === 0 && slide.to === doc.content.size) return DecorationSet.empty;
  const found: Decoration[] = [];
  for (let n = 0, at = slide.from, i = doc.childAfter(slide.from).index; n < slide.blocks; n++, i++) {
    const size = doc.child(i).nodeSize;
    found.push(Decoration.node(at, at + size, { class: "kasten-slide-now" }));
    at += size;
  }
  return DecorationSet.create(doc, found);
}

/** An edit that stays inside one text block (typing, deleting, a mark) leaves
 * the page's structure, and so its cards, where they were. */
function insideOneBlock(tr: Transaction): boolean {
  return tr.steps.every((step, i) => {
    if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) return true;
    if (!(step instanceof ReplaceStep)) return false;
    const doc = tr.docs[i]!;
    const parent = doc.resolve(step.from).parent;
    if (!parent.isTextblock || parent !== doc.resolve(step.to).parent) return false;
    const { slice } = step;
    let inline = slice.openStart === 0 && slice.openEnd === 0;
    slice.content.forEach((node) => {
      if (!node.isInline) inline = false;
    });
    return inline;
  });
}

/** The state after `tr`. `folds` is the sections plugin's fold state for the same transaction. */
export function nextSmart(prev: SmartState, tr: Transaction, folds: { folded: ReadonlySet<number>; rev: number }): SmartState {
  const meta = tr.getMeta(SMART_META) as SmartMeta | undefined;
  const loaded = tr.getMeta(LOAD_META) === true;
  const on = meta && "smart" in meta ? meta.smart : prev.on;
  let present = meta && "present" in meta ? meta.present : prev.present;
  if (!meta && !loaded && !tr.docChanged && folds.rev === prev.foldRev) return prev;
  if (!on && present === null) return prev.on || prev.present !== null ? { ...EMPTY_SMART, foldRev: folds.rev } : prev;
  // Typing in a block moves the cards along with the text; no divider, block or fold has changed.
  if (!meta && !loaded && present === null && prev.present === null && prev.on && folds.rev === prev.foldRev && tr.docChanged && insideOneBlock(tr)) {
    const first = tr.steps[0] as { from?: number } | undefined;
    return { ...prev, decorations: prev.decorations.map(tr.mapping, tr.doc), typed: prev.typed + 1, typedAt: tr.mapping.map(first?.from ?? 0) };
  }
  if (present !== null) {
    const slides = slidesOf(tr.doc);
    if (slides.length === 0) return { ...EMPTY_SMART, on, foldRev: folds.rev };
    present = Math.min(Math.max(present, 0), slides.length - 1);
    const slide = slides[present]!;
    const whole = slide.from === 0 && slide.to === tr.doc.content.size;
    return { on, present, slides: slides.length, title: slide.title, whole, decorations: slideNow(tr.doc, slide), foldRev: folds.rev, typed: prev.typed, typedAt: prev.typedAt };
  }
  return { on, present: null, slides: 0, title: "", whole: false, decorations: cards(tr.doc, folds.folded), foldRev: folds.rev, typed: prev.typed, typedAt: prev.typedAt };
}
