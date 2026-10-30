// The page editors open in the window, so a menu or the palette can fold the
// sections of the page in front, present it, or read its sections. It imports
// nothing: the palette is on the start-up path and the editor is not.

import { isShown } from "../../../../shell/visible-dom";

/** What a presenter's keys do to the slide shown. */
export type SlideStep = "next" | "previous" | "first" | "last";

/** One section's words, as Markdown, for making slides of them. */
export interface SectionText {
  title: string;
  markdown: string;
}

export interface SectionsHandle {
  /** The editor's element. */
  dom: HTMLElement;
  /** The page it shows: its note id, or its path for a draft. */
  page(): string | null;
  /** Folds or unfolds every section; resolves to how many there are to fold (0 when the page has no dividers). */
  foldAll(folded: boolean): number;
  /** Starts presenting at the slide holding `pos` (the first when null); returns how many slides there are, 0 when there is nothing to show. */
  present(pos: number | null): number;
  /** Goes to another slide while presenting. */
  step(to: SlideStep): void;
  /** Ends the presentation. */
  stop(): void;
  /** The slides' words, each as Markdown. */
  texts(): SectionText[];
}

const open = new Set<SectionsHandle>();

/** Registers an editor; returns how to forget it. */
export function registerSections(handle: SectionsHandle): () => void {
  open.add(handle);
  return () => void open.delete(handle);
}

/** The editors on screen: the focused one first, then the focused pane's. */
function inFront(): SectionsHandle[] {
  const live = [...open].filter((handle) => handle.dom.isConnected && isShown(handle.dom));
  const rank = (handle: SectionsHandle) => (handle.dom.contains(document.activeElement) ? 0 : handle.dom.closest(".kasten-pane.is-focused") ? 1 : 2);
  return live.sort((a, b) => rank(a) - rank(b));
}

/** Folds or unfolds every section of the page in front, or of the open page
 * `page` (a note id or path), wherever it is shown. Returns how many sections
 * it has; 0 when it has none to fold. */
export function foldAllSections(folded: boolean, page?: string): number {
  const handles = page === undefined ? inFront().slice(0, 1) : inFront().filter((handle) => handle.page() === page);
  let count = 0;
  for (const handle of handles) count = Math.max(count, handle.foldAll(folded));
  return count;
}

/** The editor showing `page` (a note id or path), or the editor whose element this is, or the one in front. */
const showing = (target?: string | HTMLElement): SectionsHandle | undefined => {
  if (target === undefined) return inFront()[0];
  if (typeof target !== "string") return [...open].find((handle) => handle.dom === target);
  return inFront().find((handle) => handle.page() === target);
};

/** Presents the page in front, or the open page `page`, from the slide holding `pos` (the first when
 * null). Returns how many slides there are; 0 when it has nothing to show, which starts nothing. */
export function presentPage(page?: string, pos: number | null = null): number {
  return showing(page)?.present(pos) ?? 0;
}

/** Goes to another slide of the presentation of the page `page` (a note id or path) or of the editor with this element. */
export function stepPresenting(page: string | HTMLElement, to: SlideStep): void {
  showing(page)?.step(to);
}

/** Ends the presentation of the page `page` (a note id or path) or of the editor with this element. */
export function endPresenting(page: string | HTMLElement): void {
  showing(page)?.stop();
}

/** The slides of the page in front, or of the open page `page`, as Markdown; null when it is not open. */
export function sectionTexts(page?: string): SectionText[] | null {
  return showing(page)?.texts() ?? null;
}
