// Finding a comment or a highlight again on a page that may have changed.
//
// An anchor keeps the words it was made on (the quote), a little of what stood
// before and after them, and for a comment the section they were in. A page is
// read as plain text cut into sections, and an anchor is placed in it by rules
// that never guess:
//
//   1. a comment goes to its section, found by its title and which section of
//      that title it is (the same name the fold state uses);
//   2. otherwise the quote must occur exactly once;
//   3. otherwise, of several places, the one whose 32 characters before and
//      after both match exactly;
//   4. otherwise it is detached: shown apart, to be attached again by hand.
//
// There is no fuzzy matching: a quote that is not there exactly is not found.

import type { CommentAnchor, TextAnchor } from "../../lib/vault/annotation-types";

/** How many characters of what stands around a quote are compared. */
export const CONTEXT = 32;

/** A section of the page: its title and its words as plain text. */
export interface PageSection {
  title: string;
  text: string;
}

/** A stretch of the page's plain text, as offsets into `PageText.full`. */
export interface Range {
  from: number;
  to: number;
}

/** The page as anchors read it: its sections' texts joined by a line break, and where each section starts in the whole. */
export interface PageText {
  sections: readonly PageSection[];
  full: string;
  starts: readonly number[];
}

export function pageTextOf(sections: readonly PageSection[]): PageText {
  const starts: number[] = [];
  let at = 0;
  for (const section of sections) {
    starts.push(at);
    at += section.text.length + 1;
  }
  return { sections, full: sections.map((s) => s.text).join("\n"), starts };
}

/** Each section's title with which section of that title it is, from 1. */
export function sectionNames(sections: readonly PageSection[]): { title: string; nth: number }[] {
  const seen = new Map<string, number>();
  return sections.map(({ title }) => {
    const nth = (seen.get(title) ?? 0) + 1;
    seen.set(title, nth);
    return { title, nth };
  });
}

/** The section the text at `offset` is in. */
export function sectionAtOffset(page: PageText, offset: number): number {
  let found = 0;
  page.starts.forEach((start, index) => {
    if (start <= offset) found = index;
  });
  return found;
}

/** Most places looked at for one quote; a quote this common is not a place. */
const MOST_PLACES = 5_000;

/**
 * Where `quote` is in `text`: its one occurrence, or of several the one whose
 * 32 characters before and after match `prefix` and `suffix` exactly (an empty
 * prefix or suffix means the quote is at the very start or end). Null when it
 * is not there, or when it cannot be told which.
 */
export function locate(text: string, quote: string, prefix?: string, suffix?: string): Range | null {
  if (quote === "") return null;
  const hits: number[] = [];
  for (let at = text.indexOf(quote); at >= 0 && hits.length < MOST_PLACES; at = text.indexOf(quote, at + 1)) hits.push(at);
  if (hits.length === 0) return null;
  const range = (at: number): Range => ({ from: at, to: at + quote.length });
  if (hits.length === 1) return range(hits[0]!);
  if (prefix === undefined || suffix === undefined) return null;
  const before = prefix.slice(-CONTEXT);
  const after = suffix.slice(0, CONTEXT);
  const fits = hits.filter((at) => {
    const end = at + quote.length;
    const startsRight = before === "" ? at === 0 : text.slice(Math.max(0, at - before.length), at) === before;
    const endsRight = after === "" ? end === text.length : text.startsWith(after, end);
    return startsRight && endsRight;
  });
  return fits.length === 1 ? range(fits[0]!) : null;
}

/** Where a comment is on the page. */
export type Place =
  /** In its section (found by title), at the words when they are found there. */
  | { kind: "section"; section: number; range: Range | null }
  /** On the page as a whole, at the words when it has any and they are found. */
  | { kind: "page"; range: Range | null }
  /** Its section is gone, but its words are found: placed in the section they are in now. */
  | { kind: "quote"; section: number; range: Range }
  /** Not found: shown apart until it is attached again. */
  | { kind: "detached" };

export function placeComment(anchor: CommentAnchor, page: PageText): Place {
  const { section, nth, quote, prefix, suffix } = anchor;
  if (section === "") {
    if (!quote) return { kind: "page", range: null };
    const range = locate(page.full, quote, prefix, suffix);
    return range ? { kind: "page", range } : { kind: "detached" };
  }
  const index = sectionNames(page.sections).findIndex((name) => name.title === section && name.nth === nth);
  if (index >= 0) {
    const inside = quote ? locate(page.sections[index]!.text, quote, prefix, suffix) : null;
    const start = page.starts[index]!;
    return { kind: "section", section: index, range: inside && { from: start + inside.from, to: start + inside.to } };
  }
  const range = quote ? locate(page.full, quote, prefix, suffix) : null;
  return range ? { kind: "quote", section: sectionAtOffset(page, range.from), range } : { kind: "detached" };
}

/** Where a highlight is on the page, or null when it is not found (detached). */
export function placeHighlight(anchor: TextAnchor, page: PageText): Range | null {
  return locate(page.full, anchor.quote, anchor.prefix, anchor.suffix);
}

/** Words picked out on the page, with what stands around them. */
export interface Words {
  quote: string;
  prefix: string;
  suffix: string;
  /** Where the quote is in the page's plain text. */
  from: number;
  to: number;
}

/**
 * The words at `from`..`to` of `full`, without the white space at their edges,
 * and with what stands around them. A quote longer than `most` characters is
 * cut to its first `most`.
 */
export function wordsOf(full: string, from: number, to: number, most: number): Words | null {
  let start = Math.max(0, Math.min(from, to));
  let end = Math.min(full.length, Math.max(from, to));
  while (start < end && /\s/.test(full[start]!)) start++;
  while (end > start && /\s/.test(full[end - 1]!)) end--;
  if (end - start > most) end = start + most;
  if (end <= start) return null;
  return { quote: full.slice(start, end), prefix: full.slice(Math.max(0, start - CONTEXT), start), suffix: full.slice(end, end + CONTEXT), from: start, to: end };
}

/**
 * The anchor for a new comment (or one being attached again): at the words
 * when there are any, in their section when the page has more than one;
 * otherwise in section `section` when one is meant; otherwise on the page as a
 * whole.
 */
export function anchorFor(page: PageText, at: { words?: Words | null; section?: number | null }): CommentAnchor {
  const names = sectionNames(page.sections);
  const several = page.sections.length > 1;
  const index = at.words ? sectionAtOffset(page, at.words.from) : (at.section ?? null);
  const where = several && index !== null && names[index] ? { section: names[index].title, nth: names[index].nth } : { section: "", nth: 1 };
  if (!at.words) return where;
  return { ...where, quote: at.words.quote, prefix: at.words.prefix, suffix: at.words.suffix };
}
