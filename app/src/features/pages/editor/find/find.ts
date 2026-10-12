// Find and replace in a page: every place the text occurs is marked, one
// is the current, and replacing goes through one transaction, so Mod+Z
// undoes a whole "Replace all". Matching never runs across a block's end or
// an inline node such as a page link; it ignores case and finds the text
// inside words unless "Match case" and "Whole word" say otherwise. A toggle's
// and a callout's title are fields, not text: their matches are marked on the
// whole field and replaced through the node's attributes, which moves nothing.

import type { Node } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

import { pastedToggle } from "../blocks/toggle";
import { openToggleAt } from "../blocks/toggle-view";
import { revealPos } from "../sections/api";

export interface FindOptions {
  /** Capitals must agree. */
  matchCase: boolean;
  /** No letter, digit or underscore beside the match. */
  wholeWord: boolean;
}

export const NO_OPTIONS: FindOptions = { matchCase: false, wholeWord: false };

/** Where in a node's attribute (a title field) a match is. */
export interface FieldPart {
  /** The node's position. */
  node: number;
  attr: "summary" | "title";
  /** The characters of the attribute's text it covers. */
  start: number;
  end: number;
}

export interface Match {
  /** Text: its range. A field: the node's own range, which orders it among the text. */
  from: number;
  to: number;
  /** Set when the match is in a title field and not in the page's text. */
  field?: FieldPart;
}

interface FindState {
  query: string;
  options: FindOptions;
  /** Which match is the current one. */
  index: number;
  matches: Match[];
  decorations: DecorationSet;
}

/** Stands for an inline node that is not text, so no match spans it. */
const OBJECT = "￼";

/** The attribute that holds a node's title, for the nodes that edit it in a field. */
const FIELDS: Record<string, FieldPart["attr"]> = { toggle: "summary", callout: "title" };

const WORD_BEFORE = /[\p{L}\p{N}_]$/u;
const WORD_AFTER = /^[\p{L}\p{N}_]/u;

/** Where `query` occurs in `doc`: in its text and in the title fields of its
 * toggles and callouts, in the order they stand. */
export function findMatches(doc: Node, query: string, options: Partial<FindOptions> = {}): Match[] {
  const { matchCase = false, wholeWord = false } = options;
  const needle = matchCase ? query : query.toLowerCase();
  if (!needle) return [];
  const found: Match[] = [];
  /** Where the needle stands in `text`, as [start, end) pairs. */
  const occurrences = (text: string): [number, number][] => {
    const hay = matchCase ? text : text.toLowerCase();
    // Lower-casing can change a string's length; then positions are unsure.
    if (hay.length !== text.length) return [];
    const out: [number, number][] = [];
    for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) {
      const end = i + needle.length;
      if (wholeWord && (WORD_BEFORE.test(text.slice(Math.max(0, i - 2), i)) || WORD_AFTER.test(text.slice(end, end + 2)))) continue;
      out.push([i, end]);
    }
    return out;
  };
  doc.descendants((node, pos) => {
    const attr = FIELDS[node.type.name];
    if (attr) {
      for (const [start, end] of occurrences(String(node.attrs[attr] ?? ""))) found.push({ from: pos, to: pos + node.nodeSize, field: { node: pos, attr, start, end } });
    }
    if (!node.isTextblock) return true;
    // The block's text, and where in the document each of its characters is.
    let text = "";
    const at: number[] = [];
    node.forEach((child, offset) => {
      const start = pos + 1 + offset;
      const piece = child.isText ? child.text! : OBJECT;
      for (let i = 0; i < piece.length; i++) at.push(start + (child.isText ? i : 0));
      text += piece;
    });
    for (const [start, end] of occurrences(text)) found.push({ from: at[start]!, to: at[end - 1]! + 1 });
    return false;
  });
  return found;
}

const key = new PluginKey<FindState>("KASTEN_FIND");

type Meta = { query?: string; index?: number; options?: FindOptions };

function decorate(doc: Node, matches: Match[], index: number): DecorationSet {
  if (matches.length === 0) return DecorationSet.empty;
  const marks: Decoration[] = [];
  // A field holding several matches is marked once, strongly if the current one is in it.
  const fields = new Map<number, { to: number; current: boolean }>();
  matches.forEach((m, i) => {
    if (m.field) fields.set(m.from, { to: m.to, current: (fields.get(m.from)?.current ?? false) || i === index });
    else marks.push(Decoration.inline(m.from, m.to, { class: i === index ? "kasten-find-match is-current" : "kasten-find-match" }));
  });
  for (const [from, { to, current }] of fields) marks.push(Decoration.node(from, to, { class: current ? "kasten-find-field is-current" : "kasten-find-field" }));
  return DecorationSet.create(doc, marks);
}

const EMPTY: FindState = { query: "", options: NO_OPTIONS, index: 0, matches: [], decorations: DecorationSet.empty };

export const findPlugin = $prose(
  () =>
    new Plugin<FindState>({
      key,
      state: {
        init: () => EMPTY,
        apply(tr, old) {
          const meta = tr.getMeta(key) as Meta | undefined;
          if (!meta && (!tr.docChanged || !old.query)) return old;
          const query = meta?.query ?? old.query;
          const options = meta?.options ?? old.options;
          if (!query) return { ...EMPTY, options };
          const matches = findMatches(tr.doc, query, options);
          const wanted = meta?.index ?? (meta?.query !== undefined ? 0 : old.index);
          const index = matches.length === 0 ? 0 : Math.min(Math.max(wanted, 0), matches.length - 1);
          return { query, options, index, matches, decorations: decorate(tr.doc, matches, index) };
        },
      },
      props: {
        decorations: (state) => key.getState(state)?.decorations,
      },
      view: (view) => ({ update: () => listeners.get(view)?.forEach((listener) => listener()) }),
    }),
);

const listeners = new WeakMap<EditorView, Set<() => void>>();

/** Calls `listener` after every change to the editor, until the returned
 * function is called: the find bar's count follows typing. */
export function onFindChange(view: EditorView, listener: () => void): () => void {
  const set = listeners.get(view) ?? new Set();
  listeners.set(view, set);
  set.add(listener);
  return () => void set.delete(listener);
}

export const findState = (state: EditorState): FindState => key.getState(state) ?? EMPTY;

/** Opens what hides `match`: the toggles around it and the folded section it is in. */
function reveal(view: EditorView, match: Match): void {
  const $pos = view.state.doc.resolve(match.from);
  // Around a field means around its node, which `resolve` leaves out.
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type.name === "toggle") openToggleAt($pos.before(depth), view);
  }
  revealPos(view, match.from);
}

/** Dispatches `tr`, then shows the current match: opens what hides it, selects
 * it and scrolls to it, without taking focus. Opening comes before the
 * selection, or a folded section's guard would move the caret out of it. A
 * title field is scrolled to but not selected, as its text is not the page's. */
function show(view: EditorView, tr: Transaction): void {
  view.dispatch(tr);
  const { matches, index } = findState(view.state);
  const match = matches[index];
  if (!match) return;
  reveal(view, match);
  if (match.field) {
    const dom = view.nodeDOM(match.from);
    if (dom instanceof HTMLElement) dom.scrollIntoView?.({ block: "nearest" });
    return;
  }
  const { state } = view;
  view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, match.from, match.to)).scrollIntoView());
}

/** Looks for `query`, from the match nearest the caret. */
export function setQuery(view: EditorView, query: string): void {
  const from = view.state.selection.from;
  const index = Math.max(0, findMatches(view.state.doc, query, findState(view.state).options).findIndex((m) => m.to >= from));
  show(view, view.state.tr.setMeta(key, { query, index }));
}

/** Changes what counts as a match (case, whole words), keeping the query. */
export function setOptions(view: EditorView, options: FindOptions): void {
  const { query } = findState(view.state);
  const from = view.state.selection.from;
  const index = Math.max(0, findMatches(view.state.doc, query, options).findIndex((m) => m.to >= from));
  show(view, view.state.tr.setMeta(key, { options, index }));
}

/** Moves to the next match, or back with -1, going round at the ends. */
export function step(view: EditorView, by: 1 | -1): void {
  const { matches, index } = findState(view.state);
  if (matches.length === 0) return;
  const next = (index + by + matches.length) % matches.length;
  show(view, view.state.tr.setMeta(key, { index: next }));
}

/** A title's new text, kept to what its field can hold: one line, and for a
 * toggle nothing that would end it in the file. */
function fieldText(node: Node, text: string): string {
  return node.type.name === "toggle" ? pastedToggle({ summary: text }).summary : text.replace(/[\r\n]+/g, " ");
}

/** Puts `text` where `match` is: in the page's text, or in a title's attribute (the node keeps its size). */
function replaceIn(tr: Transaction, match: Match, text: string): void {
  if (!match.field) {
    tr.insertText(text, match.from, match.to);
    return;
  }
  const node = tr.doc.nodeAt(match.from);
  if (!node) return;
  const { attr, start, end } = match.field;
  const value = String(node.attrs[attr] ?? "");
  tr.setNodeMarkup(match.from, undefined, { ...node.attrs, [attr]: fieldText(node, `${value.slice(0, start)}${text}${value.slice(end)}`) });
}

/** Replaces the current match and moves to the next after it. */
export function replaceCurrent(view: EditorView, text: string): void {
  const { query, options, matches, index } = findState(view.state);
  const match = matches[index];
  if (!match) return;
  const tr = view.state.tr;
  replaceIn(tr, match, text);
  // The next match after the new text, which may itself hold the query.
  const after = findMatches(tr.doc, query, options).findIndex((m) => {
    if (!match.field) return m.from >= match.from + text.length;
    return m.from > match.from || (m.field !== undefined && m.from === match.from && m.field.start >= match.field.start + text.length);
  });
  show(view, tr.setMeta(key, { index: Math.max(after, 0) }));
}

/** Replaces every match, in one step Mod+Z undoes. Returns how many. */
export function replaceAll(view: EditorView, text: string): number {
  const { matches } = findState(view.state);
  if (matches.length === 0) return 0;
  const tr = view.state.tr;
  // Last first, so the places still to do are where they were.
  for (const match of [...matches].reverse()) replaceIn(tr, match, text);
  view.dispatch(tr);
  return matches.length;
}

/** Stops finding: the marks go, the selection stays on the last match. */
export function clearFind(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(key, { query: "" }));
}
