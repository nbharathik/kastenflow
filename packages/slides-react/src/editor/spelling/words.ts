// The words of a deck, for "Check spelling". The words come from the text of every slide (boxes, shapes, tables, labels, groups) and its
// notes. A word is listed when the system's dictionary does not know it (where the host can ask), or, with no dictionary to ask, when it
// is probably a slip: it is written once and another word that is written more often differs from it by a single letter.

import type { Deck, Element, Text } from "@kasten-slides/wasm";

export interface Place {
  slideId: string;
  /** The element the word is in; null for the speaker notes. */
  elementId: string | null;
  /** The slide's place in the deck, from 1. */
  number: number;
}

export interface Finding {
  word: string;
  /** How many times the deck writes it. */
  count: number;
  places: Place[];
  /** Why it is listed. */
  reason: "unknown" | "probable slip";
  /** The word it may have been meant to be. */
  suggestion?: string;
}

/** A word: letters, with an apostrophe or a hyphen inside. Figures break a word, and a lone letter is not one. */
const WORD = /\p{L}[\p{L}\p{M}]*(?:['’-]\p{L}[\p{L}\p{M}]*)*/gu;

/** Whether a word is left alone without asking: a capitalised acronym (NASA), a word with a capital inside (iPhone, KastenFlow), one letter. */
export function leaveAlone(word: string): boolean {
  if (word.length < 2) return true;
  if (word === word.toUpperCase() && word !== word.toLowerCase()) return true;
  return /\p{Ll}\p{Lu}/u.test(word);
}

/** The words of a text, in order, those the checker leaves alone left out. Code and formulas are not words. */
export function wordsIn(text: Text): string[] {
  const found: string[] = [];
  for (const paragraph of text.paragraphs) {
    const line = paragraph.runs
      .filter((run) => run.code !== true && run.math !== true && run.field == null)
      .map((run) => run.t)
      .join("");
    for (const match of line.matchAll(WORD)) {
      const word = match[0].replace(/^['’-]+|['’-]+$/g, "");
      if (word !== "" && !leaveAlone(word)) found.push(word);
    }
  }
  return found;
}

function textsOf(element: Element): Text[] {
  switch (element.type) {
    case "text":
      return [element.text];
    case "shape":
      return element.text ? [element.text] : [];
    case "connector":
      return element.label ? [element.label] : [];
    case "table":
      return element.rows.flatMap((row) => row.cells.map((cell) => cell.text));
    case "group":
      return element.children.flatMap(textsOf);
    default:
      return [];
  }
}

function elementsWithText(elements: readonly Element[]): { id: string; text: Text }[] {
  return elements.flatMap((element) => {
    if (element.type === "group") return elementsWithText(element.children);
    return textsOf(element).map((text) => ({ id: element.id, text }));
  });
}

/** Every word of the deck with where it is. The same word in the same place is listed once per use. */
export function occurrences(deck: Deck): Map<string, Place[]> {
  const found = new Map<string, Place[]>();
  const note = (word: string, place: Place) => {
    const list = found.get(word);
    if (list) list.push(place);
    else found.set(word, [place]);
  };
  deck.slides.forEach((slide, index) => {
    const number = index + 1;
    for (const { id, text } of elementsWithText(slide.elements)) {
      for (const word of wordsIn(text)) note(word, { slideId: slide.id, elementId: id, number });
    }
    for (const word of wordsIn({ paragraphs: [{ runs: [{ t: slide.notes ?? "" }] }] } as unknown as Text)) note(word, { slideId: slide.id, elementId: null, number });
  });
  return found;
}

/** Whether two words differ by one letter put in, taken out or changed (or two neighbouring letters swapped). */
export function oneSlipApart(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    // One letter changed, or two neighbouring letters swapped.
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  let i = 0;
  while (i < short.length && long[i] === short[i]) i++;
  return long.slice(i + 1) === short.slice(i);
}

/** The words written once that look like a slip for a word written more often, with that word. */
export function probableSlips(counts: ReadonlyMap<string, number>): Map<string, string> {
  const slips = new Map<string, string>();
  const common = [...counts].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]);
  for (const [word, n] of counts) {
    if (n !== 1 || word.length < 4) continue;
    const lower = word.toLowerCase();
    const near = common.find(([other]) => other.length >= 4 && oneSlipApart(lower, other.toLowerCase()));
    if (near) slips.set(word, near[0]);
  }
  return slips;
}

/**
 * What to list. `ask` is the system's dictionary: it gets the words and answers with those it does not know. Without it, the
 * probable slips are listed. Words in `ignored` (the deck's own list, and those ignored for now) are never listed.
 */
export async function check(deck: Deck, ignored: readonly string[], ask?: (words: string[]) => Promise<string[]>): Promise<Finding[]> {
  const skip = new Set(ignored.map((word) => word.toLowerCase()));
  const all = occurrences(deck);
  const counts = new Map([...all].map(([word, places]) => [word, places.length] as const));
  const candidates = [...all.keys()].filter((word) => !skip.has(word.toLowerCase()));
  const findings: Finding[] = [];
  if (ask) {
    const unknown = new Set(await ask(candidates));
    for (const word of candidates) {
      if (unknown.has(word)) findings.push({ word, count: counts.get(word) ?? 0, places: all.get(word) ?? [], reason: "unknown" });
    }
  } else {
    const slips = probableSlips(new Map(candidates.map((word) => [word, counts.get(word) ?? 0] as const)));
    for (const word of candidates) {
      const suggestion = slips.get(word);
      if (suggestion) findings.push({ word, count: counts.get(word) ?? 0, places: all.get(word) ?? [], reason: "probable slip", suggestion });
    }
  }
  return findings.sort((a, b) => (a.places[0]?.number ?? 0) - (b.places[0]?.number ?? 0) || a.word.localeCompare(b.word));
}
