// Commands that make lists: bullets and numbers, their styles, and the counting
// ("restart numbering", "continue the previous list"). Taking a list off leaves
// the words where they stood, as Google Slides does.

import type { ListKind, ListStyle } from "@kasten-slides/wasm";
import type { Node as PMNode } from "prosemirror-model";
import type { EditorState, Transaction } from "prosemirror-state";

import { nodeToParagraph } from "./convert.ts";
import { kindOfStyle, layoutParagraphs, levelOf, listNumbers } from "./lists.ts";
import type { Command } from "./mark-commands.ts";
import { type ParagraphAttrs, paragraphOfAttrs } from "./paragraph-attrs.ts";
import { attrsOf } from "./schema.ts";
import { type EditorContext, selectedParagraphs } from "./selection-info.ts";
import { markerPoints } from "./text-style.ts";

/** Every paragraph of the document, with where it starts. */
export function allParagraphs(state: EditorState): { node: PMNode; pos: number }[] {
  const found: { node: PMNode; pos: number }[] = [];
  state.doc.forEach((node, pos) => found.push({ node, pos }));
  return found;
}

/** Where each paragraph of the document sets its lines now. */
export function placesOf(state: EditorState, ctx: EditorContext) {
  const paragraphs = allParagraphs(state).map(({ node }) => nodeToParagraph(node));
  return layoutParagraphs(
    paragraphs,
    paragraphs.map((paragraph) => markerPoints(ctx.theme, ctx.baseStyle, paragraph)),
  );
}

/** What taking a list off a paragraph that sets its words `margin` in changes: the words stay where they are. */
export const unlist = (margin: number): Partial<ParagraphAttrs> => ({ list: null, listStyle: null, start: null, bulletColor: null, bulletSize: null, indent: null, marginLeft: margin > 0 ? margin : null });

/** What putting a list on a paragraph changes: the list's own room decides where the words go. */
const relist = (kind: ListKind, style: ListStyle | null): Partial<ParagraphAttrs> => ({ list: kind, listStyle: style, marginLeft: null, indent: null });

/**
 * Makes the selected paragraphs a list of `kind` (in `style`, or the style they have or their level's own), or takes
 * the list off when `kind` is null. The words of a paragraph that loses its list stay where they were.
 */
export function setList(kind: ListKind | null, ctx: EditorContext, style: ListStyle | null = null): Command {
  return (state, dispatch) => {
    const picked = selectedParagraphs(state);
    if (picked.length === 0) return false;
    if (!dispatch) return true;
    const places = placesOf(state, ctx);
    const starts = new Map(allParagraphs(state).map(({ pos }, index) => [pos, index]));
    const tr = state.tr;
    for (const { node, pos } of picked) {
      const attrs = attrsOf(node);
      const index = starts.get(pos) ?? 0;
      const change: Partial<ParagraphAttrs> =
        kind === null
          ? unlist(places[index]?.margin ?? 0)
          : relist(kind, style ?? (attrs.listStyle !== null && kindOfStyle(attrs.listStyle) === kind ? attrs.listStyle : null));
      tr.setNodeMarkup(pos, undefined, { ...attrs, ...change });
    }
    dispatch(tr);
    return true;
  };
}

/** The bullet or number button: a list of `kind` on every selected paragraph, or off when they all are one already. */
export function toggleList(kind: ListKind, ctx: EditorContext): Command {
  return (state, dispatch) => {
    const all = selectedParagraphs(state).every(({ node }) => attrsOf(node).list === kind);
    return setList(all ? null : kind, ctx)(state, dispatch);
  };
}

/** One style of list on every selected paragraph, bullets or numbers as the style says. */
export const applyListStyle = (style: ListStyle, ctx: EditorContext): Command => setList(kindOfStyle(style), ctx, style);

/** The numbered paragraphs the selection touches, with the number each shows now. */
function numbered(state: EditorState) {
  const paragraphs = allParagraphs(state);
  const numbers = listNumbers(paragraphs.map(({ node }) => paragraphOfAttrs(attrsOf(node))));
  return { paragraphs, numbers };
}

/** Whether the first selected paragraph is a numbered item that does not begin counting at 1 by itself. */
export function canRestart(state: EditorState): boolean {
  const first = selectedParagraphs(state)[0];
  return first !== undefined && attrsOf(first.node).list === "number";
}

/** The number a numbered item would show if the list before it went on: one more than the last numbered item above it at its level. Null when there is none. */
export function continuedNumber(state: EditorState): number | null {
  const first = selectedParagraphs(state)[0];
  if (!first || attrsOf(first.node).list !== "number") return null;
  const { paragraphs, numbers } = numbered(state);
  const at = paragraphs.findIndex(({ pos }) => pos === first.pos);
  const level = levelOf(attrsOf(first.node));
  for (let i = at - 1; i >= 0; i--) {
    const above = paragraphs[i];
    const count = numbers[i];
    if (!above) break;
    const own = attrsOf(above.node);
    // Something at a shallower level than the item ends what it could continue.
    if (own.list !== null && levelOf(own) < level) return null;
    if (own.list === "number" && levelOf(own) === level && count !== null && count !== undefined) return count + 1;
  }
  return null;
}

/** Begins the counting of the first selected numbered item again at `at`, or lets it go on from the item above when `at` is null. */
function startAt(at: number | null): Command {
  return (state, dispatch) => {
    const first = selectedParagraphs(state)[0];
    if (!first || attrsOf(first.node).list !== "number") return false;
    if (dispatch) {
      const tr: Transaction = state.tr;
      tr.setNodeMarkup(first.pos, undefined, { ...attrsOf(first.node), start: at });
      dispatch(tr);
    }
    return true;
  };
}

/** "Restart numbering": the item shows 1 and the ones after it count on from there. */
export const restartNumbering: Command = startAt(1);

/** Sets the number the first selected item counts from; null to leave it to the items above. */
export const setStartNumber = (at: number | null): Command => startAt(at === null ? null : Math.max(1, Math.floor(at)));

/** "Continue previous list": the item goes on from the last numbered item above it, even across other paragraphs. */
export const continuePreviousList: Command = (state, dispatch) => {
  const first = selectedParagraphs(state)[0];
  const next = continuedNumber(state);
  if (!first || next === null) return false;
  // Where the count would reach this item without help, no number need be written down.
  const paragraphs = allParagraphs(state);
  const at = paragraphs.findIndex(({ pos }) => pos === first.pos);
  const attrs = attrsOf(first.node);
  const bare = listNumbers(paragraphs.map(({ node }, i) => paragraphOfAttrs(i === at ? { ...attrs, start: null } : attrsOf(node))))[at];
  return startAt(bare === next ? null : next)(state, dispatch);
};
