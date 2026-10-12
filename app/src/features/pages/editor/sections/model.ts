// Sections: the stretches of a page between its dividers. The Markdown never
// changes: a section is only where the top-level `---`, `***` and `___` lines
// (not the ones inside lists or toggles) cut the page. The first section is
// the part before the first divider; every other one starts with its divider.

import type { Node } from "@milkdown/kit/prose/model";

import { parseWikiTarget } from "../links";

export interface Section {
  /** Its place among the sections: 0 for the part before the first divider. */
  index: number;
  /** Where its divider is, or null for the first section. */
  divider: number | null;
  /** From its first block (just after its divider) to the end of its last. */
  from: number;
  to: number;
  /** How many top-level blocks it holds, its divider not counted. */
  blocks: number;
}

/** What identifies the first section where a divider's position would: it has no divider. */
export const START = -1;

/** The key of a section in fold state: its divider's position, or START. */
export const keyOf = (section: Section): number => section.divider ?? START;

/** Whether a node is a divider. */
export const isDivider = (node: Node): boolean => node.type.name === "hr";

/** The sections of `doc`, in one pass over its top-level blocks. A page
 * with no divider is one section. */
export function sectionsOf(doc: Node): Section[] {
  const found: Section[] = [{ index: 0, divider: null, from: 0, to: 0, blocks: 0 }];
  doc.forEach((child, offset) => {
    const last = found[found.length - 1]!;
    if (isDivider(child)) {
      last.to = offset;
      const from = offset + child.nodeSize;
      found.push({ index: found.length, divider: offset, from, to: from, blocks: 0 });
    } else {
      last.blocks++;
      last.to = offset + child.nodeSize;
    }
  });
  return found;
}

/** The section whose divider is at `divider` (the first section for null), read from there to the next
 * divider; null when there is no divider at that position. Its `index` is -1: it is not counted. */
export function sectionAtDivider(doc: Node, divider: number | null): Section | null {
  let from = 0;
  if (divider !== null) {
    const node = doc.nodeAt(divider);
    if (!node || !isDivider(node)) return null;
    from = divider + node.nodeSize;
  }
  let to = from;
  let blocks = 0;
  for (let i = from < doc.content.size ? doc.childAfter(from).index : doc.childCount; i < doc.childCount; i++) {
    const child = doc.child(i);
    if (isDivider(child)) break;
    blocks++;
    to += child.nodeSize;
  }
  return { index: -1, divider, from, to, blocks };
}

/** Where the first divider is, or null; stops reading there. */
export function firstDivider(doc: Node): number | null {
  let at: number | null = null;
  for (let i = 0, offset = 0; i < doc.childCount && at === null; i++) {
    const child = doc.child(i);
    if (isDivider(child)) at = offset;
    offset += child.nodeSize;
  }
  return at;
}

const SHORT = 6;
const LONGEST = 80;

/** A node's text on one line, its links and maths as they read. */
function plain(node: Node): string {
  const text = node.textBetween(0, node.content.size, " ", (leaf) => {
    if (leaf.type.name === "wiki_link") {
      const target = parseWikiTarget(String(leaf.attrs.value));
      return target.alias || target.title;
    }
    return leaf.type.name === "math_inline" ? String(leaf.attrs.value) : " ";
  });
  return text.replace(/\s+/g, " ").trim();
}

/** What a block says of itself: a toggle its summary, a callout its title. */
function textOf(node: Node): string {
  const own = node.type.name === "toggle" ? String(node.attrs.summary) : node.type.name === "callout" ? String(node.attrs.title) : "";
  return own.trim() || plain(node);
}

const clip = (text: string) => (text.length > LONGEST ? `${text.slice(0, LONGEST - 1)}…` : text);

/** The title of a section: its first heading, else the first six words of
 * its first block with text, else "Untitled section". */
export function sectionTitle(doc: Node, section: Section): string {
  let words = "";
  for (let at = section.from, i = doc.childAfter(section.from).index; i < doc.childCount && at < section.to; i++) {
    const child = doc.child(i);
    at += child.nodeSize;
    // Text is read only where it can be the title: a heading anywhere, or the first block that has some.
    if (child.type.name !== "heading" && words) continue;
    const text = textOf(child);
    if (!text) continue;
    if (child.type.name === "heading") return clip(text);
    const all = text.split(" ");
    words = all.length > SHORT ? `${all.slice(0, SHORT).join(" ")}…` : text;
  }
  return words ? clip(words) : "Untitled section";
}

/** The titles of every section, with which time each title came up: how fold
 * state names a section (its title and which of that name it is). */
export function sectionNames(doc: Node, sections: readonly Section[]): { title: string; nth: number }[] {
  const seen = new Map<string, number>();
  return sections.map((section) => {
    const title = sectionTitle(doc, section);
    const nth = seen.get(title) ?? 0;
    seen.set(title, nth + 1);
    return { title, nth };
  });
}
