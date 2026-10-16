// What the filmstrip lists, and where each thing sits. Every row has a height
// that is known before anything is drawn, so where a slide is on the page,
// which thumbnails are near the window and where a dragged slide would land are
// all worked out from numbers and never from measuring the page.

import type { Deck, Section, Slide } from "@kasten-slides/wasm";

/** How wide the filmstrip is when the person has not chosen, and the bounds they can choose within, in CSS pixels. */
export const FILMSTRIP_W = 208;
export const FILMSTRIP_MIN = 160;
export const FILMSTRIP_MAX = 360;
/** What the filmstrip's width leaves out of a thumbnail's: the number beside it, the gaps and the border. */
const BESIDE_THUMB = 48;
/** How much narrower a backup slide is drawn than the others, tucked in under the slide above it. */
const BACKUP_LESS = 14;

/** The width of a thumbnail for a filmstrip of this width, in CSS pixels. */
export const thumbWidth = (filmstrip: number): number => Math.round(filmstrip) - BESIDE_THUMB;
/** The width of a backup slide's thumbnail, given an ordinary one's. */
export const backupWidth = (thumb: number): number => thumb - BACKUP_LESS;

/** The width of a thumbnail at the filmstrip's usual width, in CSS pixels. */
export const THUMB_W = thumbWidth(FILMSTRIP_W);
/** A backup slide is drawn a little smaller, tucked in under the slide above it. */
export const BACKUP_W = backupWidth(THUMB_W);
/** The height of a section's header. */
export const SECTION_H = 30;
/** Room above and below a thumbnail inside its row. */
export const ROW_PAD = 6;
/** Room above the first row and below the last. */
export const LIST_PAD = 6;
/** The border round a thumbnail, both sides together. */
export const FRAME = 2;

export interface SlideEntry {
  kind: "slide";
  id: string;
  slide: Slide;
  /** The slide's place in the deck, from 0. */
  index: number;
  backup: boolean;
  /** Where the row starts, from the top of the list. */
  top: number;
  height: number;
}

export interface HeaderEntry {
  kind: "header";
  /** The slide the section starts at: what a section is known by. */
  key: string;
  section: Section;
  /** The deck index of the section's first slide. */
  first: number;
  /** How many slides the section holds, hidden ones too. */
  count: number;
  collapsed: boolean;
  top: number;
  height: number;
}

export type Entry = SlideEntry | HeaderEntry;

export interface FilmLayout {
  entries: Entry[];
  /** The height of the whole list. */
  height: number;
  /** The height of a slide's row. */
  rowHeight: number;
}

/** A thumbnail's height for its width, in the shape of the deck's slides. */
export function thumbHeight(size: Deck["size"], width = THUMB_W): number {
  return Math.max(1, Math.round((width * size.h) / size.w));
}

/**
 * The rows of the filmstrip: a header where a section starts, then its slides
 * unless the section is collapsed, which leaves the header alone. A row is as
 * tall as a thumbnail of width `thumb`, which follows the filmstrip's width.
 */
export function layoutFilmstrip(deck: Pick<Deck, "slides" | "sections" | "size">, collapsed: ReadonlySet<string>, thumb = THUMB_W): FilmLayout {
  const rowHeight = thumbHeight(deck.size, thumb) + FRAME + 2 * ROW_PAD;
  const starts = new Map<string, Section>();
  for (const section of deck.sections ?? []) {
    if (!starts.has(section.startsAt)) starts.set(section.startsAt, section);
  }
  const entries: Entry[] = [];
  let top = LIST_PAD;
  let header: HeaderEntry | null = null;
  for (const [index, slide] of deck.slides.entries()) {
    const section = starts.get(slide.id);
    if (section) {
      header = { kind: "header", key: section.startsAt, section, first: index, count: 0, collapsed: collapsed.has(section.startsAt), top, height: SECTION_H };
      entries.push(header);
      top += SECTION_H;
    }
    if (header) header.count += 1;
    if (header?.collapsed) continue;
    entries.push({ kind: "slide", id: slide.id, slide, index, backup: slide.backup === true && index > 0, top, height: rowHeight });
    top += rowHeight;
  }
  return { entries, height: top + LIST_PAD, rowHeight };
}

/** The ids of the slides that can be seen, in deck order. */
export function visibleIds(layout: FilmLayout): string[] {
  return layout.entries.flatMap((entry) => (entry.kind === "slide" ? [entry.id] : []));
}

/** The entry of a slide, if its section is open. */
export function entryOf(layout: FilmLayout, id: string): SlideEntry | undefined {
  return layout.entries.find((entry): entry is SlideEntry => entry.kind === "slide" && entry.id === id);
}

/** The header of the section a slide is in, if it is in one. */
export function sectionOf(deck: Pick<Deck, "slides" | "sections">, id: string): Section | undefined {
  const starts = new Map((deck.sections ?? []).map((section) => [section.startsAt, section]));
  let current: Section | undefined;
  for (const slide of deck.slides) {
    current = starts.get(slide.id) ?? current;
    if (slide.id === id) return current;
  }
  return undefined;
}

/**
 * The gap in the deck's order the pointer is at, from a height in the list:
 * 0 is before the first slide and the number of slides is after the last.
 * A header stands for the gap before its section's first slide.
 */
export function gapAt(layout: FilmLayout, y: number, slideCount: number): number {
  for (const entry of layout.entries) {
    if (y < entry.top + entry.height / 2) return entry.kind === "slide" ? entry.index : entry.first;
  }
  return slideCount;
}

/** How far each row and header sits from where the list puts it while slides are in the hand: every other one makes room. */
export interface Shifts {
  /** By slide id, in pixels down (negative is up). */
  rows: Map<string, number>;
  /** By the id of the slide a section starts at. */
  headers: Map<string, number>;
}

/**
 * Where the rows go while `dragged` slides are in the hand and would land before the slide at index `gap`: the slides in the
 * hand are out of the list, so the rows after them close up, and a gap their size opens at the place they would land. Rows that
 * stay where they are, and all of them when the slides would land where they were, are not named.
 */
export function gapShifts(layout: FilmLayout, dragged: ReadonlySet<string>, gap: number): Shifts {
  const shifts: Shifts = { rows: new Map(), headers: new Map() };
  const lifted = layout.entries.filter((entry) => entry.kind === "slide" && dragged.has(entry.id)).length;
  let top = LIST_PAD;
  let opened = false;
  for (const entry of layout.entries) {
    if (entry.kind === "slide" && dragged.has(entry.id)) continue;
    const place = entry.kind === "slide" ? entry.index : entry.first;
    if (!opened && place >= gap) {
      top += lifted * layout.rowHeight;
      opened = true;
    }
    const by = top - entry.top;
    if (by !== 0) {
      if (entry.kind === "slide") shifts.rows.set(entry.id, by);
      else shifts.headers.set(entry.key, by);
    }
    top += entry.height;
  }
  return shifts;
}

/** Where the line that shows a drop is drawn for a gap, as a height in the list. */
export function gapTop(layout: FilmLayout, gap: number): number {
  const at = layout.entries.find((entry) => (entry.kind === "slide" ? entry.index : entry.first) === gap);
  if (at) return at.top;
  const last = layout.entries[layout.entries.length - 1];
  return last ? last.top + last.height : LIST_PAD;
}
