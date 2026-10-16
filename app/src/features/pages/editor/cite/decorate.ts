// Citation chips, drawn by the editor and never written to the page. A
// citation stays plain text in the document (`[@key]`, `[see @a; @b, p. 4]`),
// so the Markdown opens and saves byte for byte; the editor hides its words
// and shows a chip in their place ("Vaswani et al., 2017"), with a card on
// hover. The words come back, to be edited, while the caret or a selection
// touches the citation. A key the bibliography lacks is drawn as the key, in a
// warning colour. No node, mark or schema is added.

import { Plugin, PluginKey, TextSelection, type EditorState } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

import { shortAuthors, shorten, workOf } from "../../../references/labels";
import { openReference } from "../../../references/requests";
import { el } from "../ui/dom";
import { bookReady, ensureBook, lookup, onBook } from "./book";
import { cardOwner, hideCard, scheduleCard, scheduleHide } from "./card";
import { groupAt, scanDoc, type DocGroup } from "./doc-groups";
import { groupLabel } from "./label";
import { registerCiter } from "./registry";
import { startCitePick } from "./cite-pick";

import "./cite.css";

interface CiteState {
  groups: DocGroup[];
  decorations: DecorationSet;
}

const key = new PluginKey<CiteState>("KASTEN_CITE");

/** Who and when a key's work is, for a chip. */
function nameOf(citeKey: string): { who: string; year: string } | null {
  const found = lookup(citeKey);
  if (!found) return null;
  const work = workOf(found.entry);
  return { who: shortAuthors(work) || shorten(work.title, 40) || citeKey, year: work.year };
}

/** Where `pos` is on screen; the editor's corner when there is no layout (tests) or the position is stale. */
function anchorAt(view: EditorView, pos: number) {
  try {
    return view.coordsAtPos(pos);
  } catch {
    return view.dom.getBoundingClientRect();
  }
}

/** The chip for a group: its label, and its listeners. */
function chip(view: EditorView, getPos: () => number | undefined, group: DocGroup, label: string, missing: boolean): HTMLElement {
  const keys = group.items.map((i) => i.key);
  const span = el("span", `kasten-cite${missing ? " is-missing" : ""}`, { textContent: label });
  span.contentEditable = "false";
  span.dataset.citeKeys = keys.join(" ");
  span.setAttribute("role", "img");
  span.setAttribute("aria-label", `Citation: ${label}`);
  span.addEventListener("mouseenter", () => scheduleCard(span, () => span.getBoundingClientRect(), keys));
  span.addEventListener("mouseleave", () => scheduleHide());
  span.addEventListener("mousedown", (event) => {
    event.preventDefault();
    hideCard();
    // Ctrl or Cmd with a click follows the citation, as it does a link.
    if (event.ctrlKey || event.metaKey) {
      openReference(keys[0]!);
      return;
    }
    // A plain click opens the citation's words for editing, with the caret at their end.
    const pos = getPos();
    if (pos === undefined) return;
    const at = Math.min(pos + (group.to - group.from) - 1, view.state.doc.content.size);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
    view.focus();
  });
  return span;
}

function decorate(state: Pick<EditorState, "doc" | "selection">, groups: readonly DocGroup[]): DecorationSet {
  if (groups.length === 0) return DecorationSet.empty;
  const { selection } = state;
  const marks: Decoration[] = [];
  for (const group of groups) {
    // The words are shown while the caret or a selection is in or beside the citation.
    if (selection.from <= group.to && selection.to >= group.from) {
      marks.push(Decoration.inline(group.from, group.to, { class: "kasten-cite-src is-editing" }));
      continue;
    }
    const names = group.items.map((i) => nameOf(i.key));
    const missing = names.some((n) => n === null);
    const label = groupLabel(
      group.source,
      group.items.map((i) => ({ key: i.key, at: i.at - group.from, keyTo: i.to - group.from, suppress: i.suppress })),
      nameOf,
    );
    marks.push(Decoration.inline(group.from, group.to, { class: "kasten-cite-src" }));
    marks.push(
      Decoration.widget(group.from, (view, getPos) => chip(view, getPos, group, label, missing && bookReady()), {
        side: -1,
        key: `cite:${missing && bookReady()}:${label}`,
        stopEvent: () => true,
        ignoreSelection: true,
      }),
    );
  }
  return DecorationSet.create(state.doc, marks);
}

export const citeState = (state: EditorState): CiteState | undefined => key.getState(state);

/** Draws the citations of the page as chips; adds the citation menu to the palette's reach. */
export const citePlugin = $prose(
  () =>
    new Plugin<CiteState>({
      key,
      state: {
        init: (_config, state) => {
          const groups = scanDoc(state.doc);
          return { groups, decorations: decorate(state, groups) };
        },
        apply: (tr, old, _before, state) => {
          if (!tr.docChanged && !tr.selectionSet && tr.getMeta(key) === undefined) return old;
          const groups = tr.docChanged ? scanDoc(tr.doc) : old.groups;
          return { groups, decorations: decorate(state, groups) };
        },
      },
      props: {
        decorations: (state) => key.getState(state)?.decorations,
        // Ctrl or Cmd with Enter, in a citation, opens the reference: the keyboard's way of following a chip.
        handleKeyDown(view, event) {
          if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return false;
          const { selection } = view.state;
          if (!selection.empty) return false;
          const group = groupAt(key.getState(view.state)?.groups ?? [], selection.from);
          if (!group) return false;
          const item = group.items.find((i) => selection.from >= i.at && selection.from <= i.to) ?? group.items[0];
          if (!item) return false;
          hideCard();
          openReference(item.key);
          return true;
        },
      },
      view: (view) => {
        // The card the caret asks for is this editor's own.
        const caret = {};
        let watching: DocGroup | undefined;
        const note = (before?: EditorState) => {
          const state = view.state;
          const groups = key.getState(state)?.groups ?? [];
          if (groups.length > 0) ensureBook();
          const { selection } = state;
          const inside = selection.empty ? groups.find((g) => selection.from > g.from && selection.from < g.to) : undefined;
          if (before && before.doc !== state.doc && cardOwner() === caret) hideCard();
          if (inside) {
            watching = inside;
            scheduleCard(caret, () => anchorAt(view, inside.from), inside.items.map((i) => i.key), 700);
          } else if (watching) {
            watching = undefined;
            if (cardOwner() === caret) scheduleHide();
          }
        };
        const unwatch = onBook(() => view.dispatch(view.state.tr.setMeta(key, "book")));
        const forget = registerCiter({
          dom: view.dom,
          insert: () => {
            if (!view.editable) return false;
            startCitePick(view);
            return true;
          },
        });
        note();
        return {
          update: (_view, before) => note(before),
          destroy: () => {
            unwatch();
            forget();
            if (cardOwner() === caret) hideCard();
          },
        };
      },
    }),
);
