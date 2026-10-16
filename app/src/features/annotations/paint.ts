// Highlights painted over a captured page's words. The editor is given the
// highlights (their words and what stands around them) and finds each one in
// its text, again after every change, by the same exact rules that place them
// everywhere else (anchor.ts); one that is not found is simply not painted,
// and the page's own text is never touched.

import "./paint.css";

import type { Node } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

import type { TextAnchor } from "../../lib/vault/annotation-types";
import { placeHighlight } from "./anchor";
import { editorText, positionsOf } from "./doc-text";

/** A highlight to paint. */
export interface Painted {
  id: string;
  color: string;
  anchor: TextAnchor;
  /** The one being looked at: drawn stronger. */
  current?: boolean;
}

interface PaintState {
  list: readonly Painted[];
  decorations: DecorationSet;
}

const key = new PluginKey<PaintState>("KASTEN_TEXT_HIGHLIGHTS");

const COLORS = ["yellow", "green", "blue", "pink", "purple"];

function decorate(doc: Node, list: readonly Painted[]): DecorationSet {
  if (list.length === 0) return DecorationSet.empty;
  const text = editorText(doc);
  const decorations: Decoration[] = [];
  for (const h of list) {
    const range = placeHighlight(h.anchor, text);
    const at = range && positionsOf(text, range);
    if (!at) continue;
    const color = COLORS.includes(h.color) ? h.color : "yellow";
    decorations.push(Decoration.inline(at.from, at.to, { class: `kasten-text-hl is-${color}${h.current ? " is-current" : ""}`, "data-highlight": h.id }, { inclusiveStart: false, inclusiveEnd: false }));
  }
  return DecorationSet.create(doc, decorations);
}

export const annotationPaint = $prose(
  () =>
    new Plugin<PaintState>({
      key,
      state: {
        init: () => ({ list: [], decorations: DecorationSet.empty }),
        apply(tr, value, _old, state) {
          const change = tr.getMeta(key) as { list: readonly Painted[] } | undefined;
          if (!change && !tr.docChanged) return value;
          const list = change?.list ?? value.list;
          // Nothing to paint costs nothing, however the page is typed in.
          if (list.length === 0) return value.list.length === 0 ? value : { list, decorations: DecorationSet.empty };
          return { list, decorations: decorate(state.doc, list) };
        },
      },
      props: {
        decorations: (state) => key.getState(state)?.decorations,
      },
    }),
);

/** Gives the editor the highlights to paint (all of them, or none). */
export function setPainted(view: EditorView, list: readonly Painted[]): void {
  view.dispatch(view.state.tr.setMeta(key, { list }).setMeta("addToHistory", false));
}
