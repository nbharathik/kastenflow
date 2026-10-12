// The sections plugin's state: which sections are folded, kept as the
// positions of their dividers and moved along with every edit, so a fold
// stays with its divider wherever the page grows.

import type { Node } from "@milkdown/kit/prose/model";
import type { Transaction } from "@milkdown/kit/prose/state";
import type { Mapping } from "@milkdown/kit/prose/transform";
import { DecorationSet } from "@milkdown/kit/prose/view";

import { foldDecorations, NONE } from "./decorate";
import { readFolds } from "./folds";
import { touched } from "./guards";
import { LOAD_META, sectionsKey, type HiddenRange, type SectionsMeta, type SectionsState } from "./key";
import { firstDivider, keyOf, sectionNames, sectionsOf, START } from "./model";
import { EMPTY_SMART, nextSmart } from "./smart";

export const EMPTY: SectionsState = { folded: new Set(), first: null, hidden: [], decorations: DecorationSet.empty, rev: 0, smart: EMPTY_SMART };

/** The folds kept for the page, as the positions of the dividers they name now. */
function restore(doc: Node, page: string | null): Set<number> {
  const wanted = readFolds(page);
  const folded = new Set<number>();
  if (wanted.length === 0) return folded;
  const sections = sectionsOf(doc);
  const names = sectionNames(doc, sections);
  for (const want of wanted) {
    const at = names.findIndex((name) => name.title === want.title && name.nth === want.nth);
    if (at >= 0) folded.add(keyOf(sections[at]!));
  }
  return folded;
}

/** Where the dividers of `folded` are after `mapping`; one that was taken away is forgotten. */
function carry(folded: ReadonlySet<number>, mapping: Mapping): Set<number> {
  const moved = new Set<number>();
  for (const key of folded) {
    if (key === START) {
      moved.add(START);
      continue;
    }
    const result = mapping.mapResult(key, 1);
    if (!result.deleted) moved.add(result.pos);
  }
  return moved;
}

function applyMeta(folded: Set<number>, meta: SectionsMeta, doc: Node): void {
  if ("all" in meta) {
    folded.clear();
    if (!meta.all) return;
    const sections = sectionsOf(doc);
    if (sections.length > 1) for (const section of sections) if (section.blocks > 0) folded.add(keyOf(section));
    return;
  }
  for (const key of meta.set) {
    if (meta.folded) folded.add(key);
    else folded.delete(key);
  }
}

const sameKeys = (a: ReadonlySet<number>, b: ReadonlySet<number>) => a.size === b.size && [...a].every((key) => b.has(key));

/** An edit away from every folded section leaves them as they were: their
 * decorations and ranges only move with it, rather than being made again for
 * every keystroke typed above or below them. Null when the edit reaches one. */
function moved(prev: SectionsState, tr: Transaction, folded: Set<number>): SectionsState | null {
  // Every fold has blocks to hide, and none was lost with a divider.
  if (prev.folded.size === 0 || prev.hidden.length !== prev.folded.size || folded.size !== prev.folded.size) return null;
  const hidden = prev.hidden.map((range) => {
    const from = tr.mapping.mapResult(range.from, 1);
    const to = tr.mapping.mapResult(range.to, -1);
    // A range that lost its start or end is no longer the section it was.
    return from.deleted || to.deleted ? null : { key: range.key === START ? START : tr.mapping.map(range.key, 1), from: from.pos, to: to.pos };
  });
  if (hidden.some((range) => range === null)) return null;
  const ranges = hidden as HiddenRange[];
  if (touched([tr], ranges).length > 0) return null;
  return { folded, first: firstDivider(tr.doc), hidden: ranges, decorations: prev.decorations.map(tr.mapping, tr.doc), rev: prev.rev, smart: prev.smart };
}

/** The state after `tr`: the folds (below), then the sections layout and the presentation (smart.ts), which are drawn for the folds as they are now. */
export function nextState(prev: SectionsState, tr: Transaction, page: () => string | null): SectionsState {
  const folds = nextFolds(prev, tr, page);
  const smart = nextSmart(prev.smart, tr, folds);
  return smart === folds.smart ? folds : { ...folds, smart };
}

/** The folds after `tr`; `page` says what they are kept under, asked only when a page is opened. */
function nextFolds(prev: SectionsState, tr: Transaction, page: () => string | null): SectionsState {
  const meta = tr.getMeta(sectionsKey) as SectionsMeta | undefined;
  const loaded = tr.getMeta(LOAD_META) === true;
  if (!loaded && !meta && !tr.docChanged) return prev;
  let folded = loaded ? restore(tr.doc, page()) : tr.docChanged ? carry(prev.folded, tr.mapping) : new Set(prev.folded);
  if (!loaded && !meta) {
    const same = moved(prev, tr, folded);
    if (same) return same;
  }
  if (meta) applyMeta(folded, meta, tr.doc);
  const built = folded.size === 0 ? NONE : foldDecorations(tr.doc, folded);
  folded = built.kept;
  const changed = !sameKeys(folded, prev.folded) && (loaded || meta !== undefined || folded.size !== prev.folded.size);
  return {
    folded,
    first: tr.docChanged ? firstDivider(tr.doc) : prev.first,
    hidden: built.hidden,
    decorations: built.decorations,
    rev: changed ? prev.rev + 1 : prev.rev,
    smart: prev.smart,
  };
}
