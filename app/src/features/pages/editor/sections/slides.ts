// The slides of a page: what presenting shows, one at a time. A page's
// sections (cut at its dividers) are its slides. A page with no divider is cut
// at its top-level H1 headings, else at its H2 headings (a heading's section
// runs to the next heading of its level, as `![[Page#Heading]]` reads it), else
// it is one slide. A lone H1 that opens the page stands for the page itself, so
// the H2 headings cut it instead and the H1 leads the first slide. Sections
// with nothing in them (two dividers in a row, a divider at the end) are not
// slides. The Markdown is never touched.

import type { Node } from "@milkdown/kit/prose/model";

import { sectionsOf, sectionTitle, type Section } from "./model";

export interface Slide {
  /** Its place among the slides. */
  index: number;
  /** Where it starts: its divider, or its first block when it has none. */
  start: number;
  /** From its first block to the end of its last. */
  from: number;
  to: number;
  /** How many top-level blocks it holds. */
  blocks: number;
  title: string;
}

/** An empty paragraph: the one an editor keeps at the end of a page to click into. */
const isBlank = (node: Node) => node.type.name === "paragraph" && node.childCount === 0;

/** Whether there is anything in the blocks of `section` to show. */
function hasContent(doc: Node, section: Section): boolean {
  for (let at = section.from, i = section.blocks > 0 ? doc.childAfter(section.from).index : 0; at < section.to; i++) {
    const child = doc.child(i);
    if (!isBlank(child)) return true;
    at += child.nodeSize;
  }
  return false;
}

/** A page with no divider cut at the headings of `level`; the blocks before the first one are a slide of their own. */
function cutAt(doc: Node, level: number): Section[] | null {
  const pieces: Section[] = [];
  let found = false;
  doc.forEach((child, offset) => {
    const heading = child.type.name === "heading" && child.attrs.level === level;
    if (heading) found = true;
    if (pieces.length === 0 || heading) pieces.push({ index: pieces.length, divider: null, from: offset, to: offset, blocks: 0 });
    const last = pieces[pieces.length - 1]!;
    last.blocks++;
    last.to = offset + child.nodeSize;
  });
  return found ? pieces : null;
}

/** The heading level that cuts a page with no divider into slides, or null for one slide. */
function headingLevel(doc: Node): 1 | 2 | null {
  let h1 = 0;
  let h2 = 0;
  doc.forEach((child) => {
    if (child.type.name !== "heading") return;
    if (child.attrs.level === 1) h1++;
    else if (child.attrs.level === 2) h2++;
  });
  const title = h1 === 1 && doc.firstChild?.type.name === "heading" && doc.firstChild.attrs.level === 1;
  if (h1 >= 2 || (h1 === 1 && !title)) return 1;
  return h2 > 0 ? 2 : null;
}

/** The slides of `doc`, in order. A page with nothing in it has none. */
export function slidesOf(doc: Node): Slide[] {
  const sections = sectionsOf(doc);
  const level = sections.length > 1 ? null : headingLevel(doc);
  const cut = level === null ? sections : (cutAt(doc, level) ?? sections);
  return cut
    .filter((section) => section.blocks > 0 && hasContent(doc, section))
    .map((section, index) => ({ index, start: section.divider ?? section.from, from: section.from, to: section.to, blocks: section.blocks, title: sectionTitle(doc, section) }));
}

/** The slide a position is in, else the first one after it, else the last; null when there are none. */
export function slideAt(slides: readonly Slide[], pos: number): Slide | null {
  return slides.find((slide) => pos < slide.to) ?? slides[slides.length - 1] ?? null;
}
