// What the rest of the editor, and the present mode, can ask of a page's
// sections.

import { TextSelection, type EditorState } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";

import { sectionsKey, SMART_META, type SectionsMeta, type SmartMeta } from "./key";
import { keyOf, sectionTitle, sectionsOf, START, type Section } from "./model";
import { slideAt, slidesOf } from "./slides";

export interface SectionInfo extends Section {
  title: string;
  folded: boolean;
}

/** Every section of the page with its title and whether it is folded. A page
 * with no divider is one section. */
export function listSections(state: EditorState): SectionInfo[] {
  const folded = sectionsKey.getState(state)?.folded ?? new Set<number>();
  return sectionsOf(state.doc).map((section) => ({ ...section, title: sectionTitle(state.doc, section), folded: folded.has(keyOf(section)) }));
}

/** Whether the page has a divider, so that folding means something. */
export const hasSections = (state: EditorState): boolean => (sectionsKey.getState(state)?.first ?? null) !== null;

/** Where the first divider is, or null. */
export const firstDividerOf = (state: EditorState): number | null => sectionsKey.getState(state)?.first ?? null;

/** Whether the first section (before the first divider) is folded. */
export const startFolded = (state: EditorState): boolean => sectionsKey.getState(state)?.folded.has(START) ?? false;

/** Folds or unfolds the sections named by `keys` (a divider's position, or -1 for the first). */
export function setFolded(view: EditorView, keys: readonly number[], folded: boolean): void {
  view.dispatch(view.state.tr.setMeta(sectionsKey, { set: keys, folded } satisfies SectionsMeta));
}

/** Folds the section if it is open, unfolds it if it is folded. */
export function toggleFold(view: EditorView, key: number): void {
  setFolded(view, [key], !(sectionsKey.getState(view.state)?.folded.has(key) ?? false));
}

/** Folds or unfolds every section; returns how many there are to fold, 0 when the page has no divider. */
export function foldAll(view: EditorView, folded: boolean): number {
  const sections = sectionsOf(view.state.doc);
  if (sections.length < 2) return 0;
  view.dispatch(view.state.tr.setMeta(sectionsKey, { all: folded } satisfies SectionsMeta));
  return sections.filter((section) => section.blocks > 0).length;
}

/** Whether `pos` is in a block a folded section hides. */
export function isHidden(state: EditorState, pos: number): boolean {
  return (sectionsKey.getState(state)?.hidden ?? []).some((range) => pos >= range.from && pos <= range.to);
}

/** Unfolds the section that hides `pos`, so a jump to it (a heading from the
 * outline, a link's target) has somewhere to land; true when one was unfolded. */
export function revealPos(view: EditorView, pos: number): boolean {
  const hiding = (sectionsKey.getState(view.state)?.hidden ?? []).filter((range) => pos >= range.from && pos <= range.to);
  if (hiding.length === 0) return false;
  setFolded(view, hiding.map((range) => range.key), false);
  return true;
}

/** The section that `pos` is in. */
export function sectionAt(state: EditorState, pos: number): Section {
  const sections = sectionsOf(state.doc);
  let found = sections[0]!;
  for (const section of sections) if (section.divider !== null && section.divider <= pos) found = section;
  return found;
}

const smartMeta = (view: EditorView, meta: SmartMeta) => view.dispatch(view.state.tr.setMeta(SMART_META, meta).setMeta("addToHistory", false));

/** Whether the sections are drawn as cards (the sections layout). */
export const isSmart = (state: EditorState): boolean => sectionsKey.getState(state)?.smart.on ?? false;

/** Draws the sections as cards, or as the plain page; the Markdown is the same either way. */
export function setSmart(view: EditorView, on: boolean): void {
  if (isSmart(view.state) !== on) smartMeta(view, { smart: on });
}

/** The slide shown while presenting, from 0, or null when not presenting. */
export const presentingAt = (state: EditorState): number | null => sectionsKey.getState(state)?.smart.present ?? null;

/** Starts presenting at the slide that holds `pos` (the first when null), and
 * returns how many slides there are. A page with nothing to show starts
 * nothing and returns 0. */
export function startPresenting(view: EditorView, pos: number | null = null): number {
  const slides = slidesOf(view.state.doc);
  const at = pos === null ? slides[0] : slideAt(slides, pos);
  if (!at) return 0;
  smartMeta(view, { present: at.index });
  return slides.length;
}

/** Shows slide `index` while presenting, kept to the slides there are. */
export function showSlide(view: EditorView, index: number): void {
  const smart = sectionsKey.getState(view.state)?.smart;
  if (!smart || smart.present === null) return;
  const next = Math.min(Math.max(index, 0), smart.slides - 1);
  if (next !== smart.present) smartMeta(view, { present: next });
}

/** Ends the presentation; the page is as it was. */
export function stopPresenting(view: EditorView): void {
  if (presentingAt(view.state) !== null) smartMeta(view, { present: null });
}

/** Scrolls to section `index` and, when it is not folded, puts the caret at its start. */
export function jumpToSection(view: EditorView, index: number): boolean {
  const section = sectionsOf(view.state.doc)[index];
  if (!section) return false;
  const bar = view.dom.querySelector<HTMLElement>(`.kasten-sec-head[data-section="${index}"]`);
  const node = bar ?? view.nodeDOM(section.divider ?? section.from);
  if (node instanceof HTMLElement) node.scrollIntoView?.({ block: "start" });
  const { doc } = view.state;
  if (section.blocks > 0 && !(sectionsKey.getState(view.state)?.folded.has(keyOf(section)) ?? false)) {
    view.dispatch(view.state.tr.setSelection(TextSelection.near(doc.resolve(section.from), 1)));
  }
  view.focus();
  return true;
}
