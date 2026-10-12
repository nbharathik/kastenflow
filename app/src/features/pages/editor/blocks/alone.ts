// Links alone on their line, found in one pass over a page's own blocks (the
// page itself, and what holds blocks on it: toggles and callouts; never the
// text of a list item or a quote, where a link is part of a sentence):
//
// - a `[[page link]]` is marked, so its view draws a page block or an embed;
// - a web link whose text is not its address (`[Title](https://…)`) makes
//   its paragraph a bookmark card: title and domain, with no network request.
//   The card gives way to the link as written while the caret is in it.
//
// A mark that comes or goes redraws the view: ProseMirror keeps the view of
// an unchanged node without asking it, even when text joins it on its line.

import type { Node } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey, type EditorState } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

import { bookmarkDecoration, isBookmark } from "./bookmark-view";

/** What holds blocks of a page's own, besides the page. */
const HOLDERS = new Set(["toggle", "callout"]);

/** What a page link's mark says about the node it is on: it is alone in its paragraph. */
interface AloneSpec {
  alone?: boolean;
}

export const isAlone = (decorations: readonly Decoration[]) => decorations.some((d) => (d.spec as AloneSpec).alone);

function markParagraph(paragraph: Node, pos: number, out: Decoration[]): void {
  if (paragraph.childCount !== 1) return;
  const only = paragraph.firstChild!;
  if (only.type.name === "wiki_link") {
    out.push(Decoration.node(pos + 1, pos + 1 + only.nodeSize, {}, { alone: true } satisfies AloneSpec));
    return;
  }
  const card = bookmarkDecoration(paragraph, pos);
  if (card) out.push(card);
}

function visit(parent: Node, start: number, out: Decoration[]): void {
  parent.forEach((child, offset) => {
    if (child.type.name === "paragraph") markParagraph(child, start + offset, out);
    else if (HOLDERS.has(child.type.name)) visit(child, start + offset + 1, out);
  });
}

/** The marks for every link alone on its line in `doc`. */
export function aloneMarks(doc: Node): DecorationSet {
  const marks: Decoration[] = [];
  visit(doc, 0, marks);
  return DecorationSet.create(doc, marks);
}

interface AloneState {
  marks: DecorationSet;
  /** Whether the editor has the keys: a card shows its link as written only where the caret really is. */
  focused: boolean;
}

const key = new PluginKey<AloneState>("KASTEN_ALONE");

/** `marks` without the card the caret is in. */
function withoutCaretCard({ marks, focused }: AloneState, state: EditorState): DecorationSet {
  const { $from } = state.selection;
  if (!focused || $from.depth < 1) return marks;
  const start = $from.before();
  const hit = marks.find(start, start + $from.parent.nodeSize, isBookmark).filter((d) => d.from === start);
  return hit.length > 0 ? marks.remove(hit) : marks;
}

export const aloneLinks = $prose(
  () =>
    new Plugin<AloneState>({
      key,
      state: {
        init: (_, state) => ({ marks: aloneMarks(state.doc), focused: false }),
        apply(tr, prev) {
          const focus = tr.getMeta(key) as boolean | undefined;
          if (!tr.docChanged && focus === undefined) return prev;
          return { marks: tr.docChanged ? aloneMarks(tr.doc) : prev.marks, focused: focus ?? prev.focused };
        },
      },
      props: {
        decorations: (state) => withoutCaretCard(key.getState(state)!, state),
        handleDOMEvents: {
          focus(view) {
            if (!key.getState(view.state)?.focused) view.dispatch(view.state.tr.setMeta(key, true));
            return false;
          },
          blur(view) {
            if (key.getState(view.state)?.focused) view.dispatch(view.state.tr.setMeta(key, false));
            return false;
          },
        },
      },
    }),
);
