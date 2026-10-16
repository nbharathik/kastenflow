// A storyboard being edited, as plain data and pure functions: the rows of the dialog (a drafted slide each), and what reordering, leaving out,
// merging, splitting and rewriting them does. Nothing here draws anything or touches the vault; the dialog calls these and shows what comes back.

import type { StoryEntry } from "@kasten-slides/wasm";

/** One slide of the storyboard in the dialog. */
export interface Row {
  /** Tells the row from the others for as long as the dialog is open, whatever is typed in its title. */
  key: string;
  entry: StoryEntry;
  /** Not made into a slide, but kept in the list so it can be put back. */
  leftOut: boolean;
}

/** What an edit of a row can change. Empty text takes a field away. */
export interface Change {
  title?: string;
  point?: string;
  notes?: string;
  layout?: string;
  evidence?: string[];
}

const LIST_LINE = /^\s*(?:[-*+]|\d{1,9}[.)])\s/;
const MEDIA_BLOCK = /^\s*(?:!\[|\||`{3}|~{3}|\$\$)/;

/** Whether an evidence block is an item of a list: one line that starts with a marker. */
export const isItem = (block: string): boolean => !block.includes("\n") && LIST_LINE.test(block);

/** Whether an evidence block is a picture, a table, code or a formula. */
export const isMediaBlock = (block: string): boolean => MEDIA_BLOCK.test(block);

const keyNumber = (row: Row): number => Number(row.key.slice(1)) || 0;
const nextKey = (rows: readonly Row[]): string => `r${Math.max(0, ...rows.map(keyNumber)) + 1}`;

/** The entry with `media` worked out from its evidence. */
const finished = (entry: StoryEntry): StoryEntry => ({ ...entry, media: entry.evidence.some(isMediaBlock) });

/** The rows of a draft, in order, none left out. */
export function rowsOf(entries: readonly StoryEntry[]): Row[] {
  return entries.map((entry, i) => ({ key: `r${i + 1}`, entry: finished(entry), leftOut: false }));
}

/** What a person calls a slide: its title, or its place when it has none. */
export function nameOf(entry: StoryEntry, index: number): string {
  return entry.title.trim() || `Slide ${index + 1}`;
}

/** Moves the row at `from` to the place `to` (kept inside the list). The list itself when nothing moves. */
export function move(rows: readonly Row[], from: number, to: number): Row[] {
  const place = Math.min(Math.max(to, 0), rows.length - 1);
  if (!rows[from] || place === from) return rows as Row[];
  const next = [...rows];
  const [taken] = next.splice(from, 1);
  next.splice(place, 0, taken as Row);
  return next;
}

/** Leaves a row out of what is made (or puts it back, with `out` false). */
export function leaveOut(rows: readonly Row[], index: number, out = true): Row[] {
  return rows.map((row, i) => (i === index ? { ...row, leftOut: out } : row));
}

/** Rewrites fields of one row. A row that is not there changes nothing. */
export function edit(rows: readonly Row[], index: number, change: Change): Row[] {
  const row = rows[index];
  if (!row) return rows as Row[];
  const { point: _point, notes: _notes, layout: _layout, ...rest } = row.entry;
  const point = change.point !== undefined ? change.point.trim() : (row.entry.point ?? "");
  const notes = change.notes !== undefined ? change.notes.trim() : (row.entry.notes ?? "");
  const layout = change.layout !== undefined ? change.layout.trim() : (row.entry.layout ?? "");
  const entry: StoryEntry = {
    ...rest,
    title: change.title ?? row.entry.title,
    evidence: change.evidence ?? row.entry.evidence,
    ...(point !== "" ? { point } : {}),
    ...(notes !== "" ? { notes } : {}),
    ...(layout !== "" ? { layout } : {}),
  };
  return rows.map((other, i) => (i === index ? { ...other, entry: finished(entry) } : other));
}

/**
 * Joins a row and the one after it into the first: the first one's title and layout, its point (else the second's), both evidences, both
 * notes, and every source. It is left out only if both were. The last row has nothing after it.
 */
export function merge(rows: readonly Row[], index: number): Row[] {
  const first = rows[index];
  const second = rows[index + 1];
  if (!first || !second) return rows as Row[];
  const a = first.entry;
  const b = second.entry;
  const point = a.point?.trim() ? a.point : b.point;
  const notes = [a.notes, b.notes].filter((text): text is string => typeof text === "string" && text.trim() !== "").join("\n\n");
  const { point: _point, notes: _notes, ...rest } = a;
  const joined: StoryEntry = finished({
    ...rest,
    evidence: [...a.evidence, ...b.evidence],
    sources: [...a.sources, ...b.sources],
    ...(point?.trim() ? { point } : {}),
    ...(notes !== "" ? { notes } : {}),
  });
  const row: Row = { key: nextKey(rows), entry: joined, leftOut: first.leftOut && second.leftOut };
  return [...rows.slice(0, index), row, ...rows.slice(index + 2)];
}

/**
 * Cuts a row's evidence in two after the first `at` blocks. The first part stays the row (its title, point, notes and sources); the rest
 * becomes a slide after it, titled like it with " (2)", that remembers no page. Nothing happens when a side would be left empty.
 */
export function split(rows: readonly Row[], index: number, at: number): Row[] {
  const row = rows[index];
  if (!row || at <= 0 || at >= row.entry.evidence.length) return rows as Row[];
  const { point: _point, notes: _notes, layout: _layout, ...rest } = row.entry;
  const head: Row = { ...row, entry: finished({ ...row.entry, evidence: row.entry.evidence.slice(0, at) }) };
  const tail: Row = { key: nextKey(rows), entry: finished({ ...rest, title: `${row.entry.title.trim()} (2)`, evidence: row.entry.evidence.slice(at), sources: [] }), leftOut: row.leftOut };
  return [...rows.slice(0, index), head, tail, ...rows.slice(index + 1)];
}

/** The entries that are made into slides: the rows that are not left out, in order. */
export function entriesOf(rows: readonly Row[]): StoryEntry[] {
  return rows.filter((row) => !row.leftOut).map((row) => finished(row.entry));
}

/** How many slides will be made and how many rows are left out. */
export function tally(rows: readonly Row[]): { slides: number; leftOut: number } {
  const out = rows.filter((row) => row.leftOut).length;
  return { slides: rows.length - out, leftOut: out };
}

// ---- evidence as text

/** Evidence blocks as the text a person edits: list items one under the other, every other block apart by a blank line. */
export function evidenceToText(blocks: readonly string[]): string {
  let out = "";
  let afterItem = false;
  for (const block of blocks) {
    const text = block.trimEnd();
    if (text.trim() === "") continue;
    const item = isItem(text);
    if (out !== "") out += item && afterItem ? "\n" : "\n\n";
    out += text;
    afterItem = item;
  }
  return out;
}

interface Placed {
  block: string;
  /** Where in the text it begins. */
  from: number;
}

/** The blocks of some text with where each begins: a list line is one, a fence or a block formula is one with its blank lines, anything else runs to a blank line. */
function placed(text: string): Placed[] {
  const blocks: Placed[] = [];
  let current: string[] = [];
  let start = 0;
  let at = 0;
  let fence: string | null = null;
  let math = false;
  const flush = (): void => {
    if (current.length > 0) blocks.push({ block: current.join("\n"), from: start });
    current = [];
  };
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw;
    const here = at;
    at += raw.length + 1;
    if (fence !== null) {
      current.push(line);
      const bar = fence;
      if (line.trim().startsWith(bar) && line.trim().replace(new RegExp(`^${bar[0]}+`), "") === "") {
        fence = null;
        flush();
      }
      continue;
    }
    if (math) {
      current.push(line);
      if (line.trim().endsWith("$$")) {
        math = false;
        flush();
      }
      continue;
    }
    const opening = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (opening) {
      flush();
      start = here;
      current.push(line);
      fence = opening;
      continue;
    }
    const trimmed = line.trim();
    if (trimmed.startsWith("$$")) {
      flush();
      start = here;
      current.push(line);
      if (!(trimmed.length > 2 && trimmed.endsWith("$$"))) math = true;
      else flush();
      continue;
    }
    if (trimmed === "") {
      flush();
      continue;
    }
    if (LIST_LINE.test(line)) {
      flush();
      blocks.push({ block: line.trimEnd(), from: here });
      continue;
    }
    if (current.length === 0) start = here;
    current.push(line);
  }
  flush();
  return blocks;
}

/** Text the person edited, as evidence blocks. */
export function evidenceFromText(text: string): string[] {
  return placed(text).map((item) => item.block);
}

/** How many blocks of `text` begin before the place `offset` (a caret): the part of the evidence that stays when a slide is split there. */
export function blocksBefore(text: string, offset: number): number {
  return placed(text).filter((item) => item.from < offset).length;
}
