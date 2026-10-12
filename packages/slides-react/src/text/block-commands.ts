// Commands that shape paragraphs: alignment, spacing, indent, moving them, and
// what Enter, Shift-Enter and Backspace do at the edges of a paragraph.

import type { Align } from "@kasten-slides/wasm";
import { TextSelection } from "prosemirror-state";

import { addressBeforeCaret } from "./autolink.ts";
import { allParagraphs, placesOf, unlist } from "./list-commands.ts";
import { MAX_LEVEL, levelOf } from "./lists.ts";
import type { Command } from "./mark-commands.ts";
import { LINE_BREAK, LIST_STEP } from "./metrics.ts";
import type { ParagraphAttrs } from "./paragraph-attrs.ts";
import { attrsOf } from "./schema.ts";
import { type EditorContext, selectedParagraphs } from "./selection-info.ts";

export { applyListStyle, continuePreviousList, restartNumbering, setList, setStartNumber, toggleList } from "./list-commands.ts";

/** Changes the settings of every paragraph the selection touches. */
export function withParagraphs(change: (attrs: ParagraphAttrs) => Partial<ParagraphAttrs>): Command {
  return (state, dispatch) => {
    const paragraphs = selectedParagraphs(state);
    if (paragraphs.length === 0) return false;
    if (dispatch) {
      const tr = state.tr;
      for (const { node, pos } of paragraphs) {
        const attrs = attrsOf(node);
        tr.setNodeMarkup(pos, undefined, { ...attrs, ...change(attrs) });
      }
      dispatch(tr);
    }
    return true;
  };
}

/**
 * Changes the marker of every list item the selection touches (a caret touches the whole paragraph it is in), and
 * leaves the paragraphs that are no list alone. False where there is no list item to change.
 */
function withItems(change: (attrs: ParagraphAttrs) => Partial<ParagraphAttrs>): Command {
  return (state, dispatch) => {
    const items = selectedParagraphs(state).filter(({ node }) => attrsOf(node).list !== null);
    if (items.length === 0) return false;
    if (dispatch) {
      const tr = state.tr;
      for (const { node, pos } of items) {
        const attrs = attrsOf(node);
        const next = { ...attrs, ...change(attrs) };
        if (JSON.stringify(next) !== JSON.stringify(attrs)) tr.setNodeMarkup(pos, undefined, next);
      }
      if (tr.docChanged) dispatch(tr);
    }
    return true;
  };
}

/** What a marker can be set to as a multiple of its words' size: PowerPoint's 25% to 400%. */
export const BULLET_SIZES = { min: 0.25, max: 4 } as const;

/**
 * The size of the markers of the selected list items as a multiple of their own words' size (1.5 is 150%); null, or
 * 1, is the size of the words. Kept between 25% and 400%.
 */
export function setBulletSize(share: number | null): Command {
  if (share !== null && !Number.isFinite(share)) return () => false;
  const clamped = share === null ? 1 : Math.round(Math.min(BULLET_SIZES.max, Math.max(BULLET_SIZES.min, share)) * 100) / 100;
  return withItems(() => ({ bulletSize: clamped === 1 ? null : clamped }));
}

/** The colour of the markers of the selected list items, a theme token or `#rrggbb`; null takes the colour of the words. */
export const setBulletColor = (color: string | null): Command => withItems(() => ({ bulletColor: color === "" ? null : color }));

export const setAlign = (align: Align): Command => withParagraphs(() => ({ align }));

/** A multiple of the line height, or null for the text style's own. */
export const setLineSpacing = (value: number | null): Command => withParagraphs(() => ({ lineSpacing: value }));

/** Space before and after the selected paragraphs, in points; null leaves it to the text style, and undefined leaves it as it is. */
export const setParagraphSpacing = (spacing: { before?: number | null; after?: number | null }): Command =>
  withParagraphs(() => ({ ...(spacing.before !== undefined ? { spaceBefore: spacing.before } : {}), ...(spacing.after !== undefined ? { spaceAfter: spacing.after } : {}) }));

/**
 * Where the selected paragraphs start their lines: `marginLeft` is where the words
 * of every line after the first start, and `firstLine` where the first starts,
 * from that (negative hangs it out). Null for either goes back to what the
 * paragraph's list or level says; undefined leaves it as it is.
 */
export const setIndents = (indents: { marginLeft?: number | null; firstLine?: number | null }): Command =>
  withParagraphs(() => ({
    ...(indents.marginLeft !== undefined ? { marginLeft: indents.marginLeft === null ? null : Math.max(0, indents.marginLeft) } : {}),
    ...(indents.firstLine !== undefined ? { indent: indents.firstLine } : {}),
  }));

/** One level in or out for a paragraph: its list level, or its own margin if it has set one. */
function stepped(attrs: ParagraphAttrs, delta: 1 | -1): Partial<ParagraphAttrs> {
  if (attrs.marginLeft !== null) {
    const margin = Math.max(0, attrs.marginLeft + delta * LIST_STEP);
    return { marginLeft: margin === 0 ? null : margin };
  }
  const level = Math.min(MAX_LEVEL, Math.max(0, levelOf(attrs) + delta));
  return { level: level === 0 ? null : level };
}

/** Moves the selected paragraphs one level in or out, within the nine levels there are. The key is taken even at the end of the range, so it never moves focus away. */
export function indent(delta: 1 | -1): Command {
  return (state, dispatch) => {
    const paragraphs = selectedParagraphs(state);
    if (paragraphs.length === 0) return false;
    const moved = paragraphs.some(({ node }) => {
      const attrs = attrsOf(node);
      return Object.entries(stepped(attrs, delta)).some(([key, value]) => attrs[key as keyof ParagraphAttrs] !== value);
    });
    if (!moved) return true;
    return withParagraphs((attrs) => stepped(attrs, delta))(state, dispatch);
  };
}

/** Alt-Shift-Up and Alt-Shift-Down: the selected paragraphs change places with the one above or below them. */
export function moveParagraphs(delta: 1 | -1): Command {
  return (state, dispatch) => {
    const picked = selectedParagraphs(state);
    const first = picked[0];
    const last = picked[picked.length - 1];
    if (!first || !last) return false;
    const all = allParagraphs(state);
    const from = all.findIndex(({ pos }) => pos === first.pos);
    const to = all.findIndex(({ pos }) => pos === last.pos);
    const neighbour = all[delta < 0 ? from - 1 : to + 1];
    // At the edge of the text there is nothing to change places with; the key is still the editor's.
    if (!neighbour) return true;
    if (!dispatch) return true;
    const tr = state.tr;
    const start = first.pos;
    const end = last.pos + last.node.nodeSize;
    const { anchor, head } = state.selection;
    if (delta < 0) {
      tr.delete(neighbour.pos, neighbour.pos + neighbour.node.nodeSize);
      tr.insert(end - neighbour.node.nodeSize, neighbour.node);
      const shift = -neighbour.node.nodeSize;
      tr.setSelection(TextSelection.create(tr.doc, anchor + shift, head + shift));
    } else {
      tr.delete(neighbour.pos, neighbour.pos + neighbour.node.nodeSize);
      tr.insert(start, neighbour.node);
      const shift = neighbour.node.nodeSize;
      tr.setSelection(TextSelection.create(tr.doc, anchor + shift, head + shift));
    }
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/** Text styles that are one line of words, where Enter makes a new line and not a new paragraph. */
const ONE_PARAGRAPH = new Set(["title", "subtitle", "display", "big-number"]);

/**
 * Enter: splits the paragraph, and the new one is set like the old, so a list
 * goes on (a count that was begun again stays with the first of the two). Text
 * typed there carries on the formatting at the caret. In an empty list item it
 * ends the list instead, one level at a time. A title is one paragraph, so
 * there Enter is a line break.
 */
export function enter(ctx: EditorContext, autoLinks: () => boolean = () => true): Command {
  return (state, dispatch) => {
    const { selection } = state;
    const paragraph = state.schema.nodes.paragraph;
    if (!paragraph) return false;
    const { $from } = selection;
    const attrs = attrsOf($from.parent);
    if (selection.empty && $from.parent.content.size === 0 && attrs.list) {
      if (dispatch) {
        const change = levelOf(attrs) > 0 ? stepped(attrs, -1) : unlist(0);
        dispatch(state.tr.setNodeMarkup($from.before(), undefined, { ...$from.parent.attrs, ...change }));
      }
      return true;
    }
    if (ONE_PARAGRAPH.has(attrs.style ?? ctx.baseStyle) && !attrs.list) return softBreak(state, dispatch);
    if (!dispatch) return true;
    const marks = state.storedMarks ?? $from.marks();
    const tr = state.tr;
    // An address typed just before Enter becomes a link, as it does before a space.
    const address = autoLinks() ? addressBeforeCaret(state) : null;
    const linkType = state.schema.marks.link;
    if (address && linkType) tr.addMark(address.from, address.to, linkType.create({ href: address.href }));
    if (!selection.empty) tr.deleteSelection();
    const pos = tr.selection.from;
    const here = tr.doc.resolve(pos).parent.attrs;
    tr.split(pos, 1, [{ type: paragraph, attrs: { ...here, start: null } }]);
    tr.ensureMarks(marks);
    dispatch(tr);
    return true;
  };
}

/** Shift-Enter: a line break inside the paragraph, which is a `LINE_BREAK` in the text. */
export const softBreak: Command = (state, dispatch) => {
  dispatch?.(state.tr.insertText(LINE_BREAK));
  return true;
};

/**
 * Backspace at the start of a list item takes the bullet or number away first,
 * and the words stay where they were; at the start of an indented paragraph it
 * takes the indent away. Only then does it join the paragraph to the one before.
 */
export function backspaceStart(ctx: EditorContext): Command {
  return (state, dispatch) => {
    const { selection } = state;
    const { $from } = selection;
    if (!selection.empty || $from.parentOffset !== 0) return false;
    const attrs = attrsOf($from.parent);
    if (attrs.list) {
      if (dispatch) {
        const index = allParagraphs(state).findIndex(({ pos }) => pos === $from.before());
        dispatch(state.tr.setNodeMarkup($from.before(), undefined, { ...$from.parent.attrs, ...unlist(placesOf(state, ctx)[index]?.margin ?? 0) }));
      }
      return true;
    }
    if (attrs.marginLeft !== null || attrs.indent !== null || levelOf(attrs) > 0) {
      dispatch?.(state.tr.setNodeMarkup($from.before(), undefined, { ...$from.parent.attrs, marginLeft: null, indent: null, level: null }));
      return true;
    }
    return false;
  };
}
