// AI in a page: which text an answer is about, marked while the panel is
// open, and the panel's place in the page, just below that text. The panel
// itself is React (AiPanel.tsx), drawn into the element placed here.
// Nothing here changes the page; place.ts does, once an answer is taken.

import { Plugin, PluginKey, type EditorState } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

import type { WriteAction } from "../../../chat/types";
import { selectionMenu } from "./context-menu";

/** An opening of the panel. */
export interface AiOpen {
  action: WriteAction;
  /** An AI action to run at once (its slug), instead of the panel's own `action`. */
  slug?: string;
  /** Counts openings, so each starts afresh. */
  opened: number;
  /** Where the panel is drawn, in the page. */
  host: HTMLElement;
}

/** The text an answer is about (empty at the caret), mapped through edits. */
export interface AiRange {
  from: number;
  to: number;
}

interface AiState extends AiRange {
  host: HTMLElement;
}

type Meta = { open: AiState } | { close: true };

const key = new PluginKey<AiState | null>("KASTEN_AI");

const listeners = new WeakMap<EditorView, (open: AiOpen) => void>();
let opened = 0;

/** Where the panel goes: after the top-level block holding `pos`. */
export function blockEnd(state: EditorState, pos: number): number {
  const $pos = state.doc.resolve(pos);
  return $pos.depth >= 1 ? $pos.after(1) : pos;
}

/** The text the open panel is about, if one is open. */
export function aiRange(state: EditorState): AiRange | null {
  const open = key.getState(state);
  return open ? { from: open.from, to: open.to } : null;
}

/** Hears the openings of `view`'s panel; returns how to stop. */
export function onAiOpen(view: EditorView, listener: (open: AiOpen) => void): () => void {
  listeners.set(view, listener);
  return () => {
    if (listeners.get(view) === listener) listeners.delete(view);
  };
}

/** Opens the panel for `action` on the selection, or at the caret. False
 * where the editor has no panel, and for "explain" with nothing selected.
 * With `slug`, the panel runs that AI action at once on the selection (or,
 * with none, the page). */
export function openAi(view: EditorView, action: WriteAction, slug?: string): boolean {
  const listener = listeners.get(view);
  if (!listener) return false;
  const { from, to } = view.state.selection;
  if (action === "explain" && from === to) return false;
  const host = document.createElement("div");
  host.className = "kasten-ai-host";
  host.contentEditable = "false";
  // Asking, explaining and actions are about the selection, which stays marked;
  // continuing and summarizing start where it ends.
  const range = action === "ask" || action === "explain" || slug ? { from, to } : { from: to, to };
  view.dispatch(view.state.tr.setMeta(key, { open: { ...range, host } } satisfies Meta));
  listener({ action, ...(slug ? { slug } : {}), opened: ++opened, host });
  return true;
}

/** Closes the panel's place and mark; `tr` closes it as part of a change. */
export function closeAi(view: EditorView): void {
  if (key.getState(view.state)) view.dispatch(view.state.tr.setMeta(key, { close: true } satisfies Meta));
}

/** Marks `tr` as closing the panel too. */
export const closingAi = <T extends { setMeta(key: PluginKey, value: unknown): T }>(tr: T): T => tr.setMeta(key, { close: true } satisfies Meta);

export const aiPlugin = $prose(
  () =>
    new Plugin<AiState | null>({
      key,
      state: {
        init: () => null,
        apply(tr, was) {
          const meta = tr.getMeta(key) as Meta | undefined;
          if (meta) return "close" in meta ? null : meta.open;
          if (!was || !tr.docChanged) return was;
          const from = tr.mapping.map(was.from, 1);
          return { ...was, from, to: Math.max(from, tr.mapping.map(was.to, -1)) };
        },
      },
      props: {
        decorations(state) {
          const open = key.getState(state);
          if (!open) return null;
          const marks = [
            Decoration.widget(blockEnd(state, open.to), () => open.host, { key: "kasten-ai-panel", side: 1, ignoreSelection: true, stopEvent: () => true }),
          ];
          if (open.to > open.from) marks.push(Decoration.inline(open.from, open.to, { class: "kasten-ai-range" }));
          return DecorationSet.create(state.doc, marks);
        },
        handleDOMEvents: {
          // Right-click on selected text: Explain and Ask AI beside Copy and Cut.
          contextmenu: (view, event) => selectionMenu(view, event, (action) => void openAi(view, action)),
        },
      },
    }),
);
