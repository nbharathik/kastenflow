// The title bar a section has in the sections layout: its number and title, a
// button that folds it and one that presents from it. It is a widget drawn at
// the start of the section, not part of the page: the Markdown still has only
// the `---` line. Its title is read again when the section's text is typed in,
// since a widget is not drawn again for an edit inside a block.

import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";

import { el, withGlyph } from "../ui/dom";
import { startPresenting, toggleFold } from "./api";
import { sectionAtDivider, sectionTitle, START } from "./model";

export interface HeadSpec {
  /** The section's place among the sections, from 0. */
  index: number;
  folded: boolean;
  title: string;
  /** The section before the first divider, which has no divider of its own. */
  first: boolean;
}

/** How to read a title bar's title again, and where its section starts, by the bar. */
const refreshers = new WeakMap<HTMLElement, () => void>();
const places = new WeakMap<HTMLElement, () => number | undefined>();

/** The bar for a section; `getPos` is where the section's divider is (0 for the first section). */
export function sectionHead(view: EditorView, getPos: () => number | undefined, spec: HeadSpec): HTMLElement {
  const head = el("div", `kasten-sec-head${spec.folded ? " is-folded" : ""}`, { contentEditable: "false" });
  head.dataset.section = String(spec.index);
  // A chevron that turns when the section folds, and a presentation screen with its word:
  // two different marks, so neither reads as the other.
  const fold = withGlyph(el("button", "kasten-sec-fold", { type: "button", title: spec.folded ? "Unfold this section" : "Fold this section" }), "icon:chevron-down", 14);
  fold.setAttribute("aria-label", spec.folded ? "Unfold section" : "Fold section");
  fold.setAttribute("aria-expanded", String(!spec.folded));
  const title = el("span", "kasten-sec-title", { textContent: spec.title });
  const present = withGlyph(el("button", "kasten-sec-present", { type: "button", title: "Present from here" }), "icon:present", 14);
  present.setAttribute("aria-label", "Present from here");
  head.append(fold, el("span", "kasten-sec-number", { textContent: String(spec.index + 1) }), title, present);
  // Pressing a button must not move the caret or select the page.
  for (const button of [fold, present]) button.addEventListener("mousedown", (event) => event.preventDefault());
  fold.addEventListener("click", () => {
    const pos = getPos();
    if (pos !== undefined) toggleFold(view, spec.first ? START : pos);
  });
  present.addEventListener("click", () => {
    const pos = getPos();
    if (pos !== undefined) startPresenting(view, pos);
  });
  places.set(head, getPos);
  refreshers.set(head, () => {
    const pos = getPos();
    if (pos === undefined) return;
    const section = sectionAtDivider(view.state.doc, spec.first ? null : pos);
    const text = section ? sectionTitle(view.state.doc, section) : null;
    if (text !== null && title.textContent !== text) title.textContent = text;
  });
  return head;
}

/** The bottom edge of a section's card. In a section with nothing in it, it
 * is the place to click to start writing: `getPos` is where its blocks start. */
export function sectionFoot(view: EditorView, getPos: () => number | undefined, spec: { folded: boolean; empty: boolean }): HTMLElement {
  const foot = el("div", `kasten-sec-foot${spec.folded ? " is-folded" : ""}${spec.empty ? " is-empty" : ""}`, { contentEditable: "false" });
  if (!spec.empty) return foot;
  foot.title = "Click to write in this section";
  foot.addEventListener("mousedown", (event) => event.preventDefault());
  foot.addEventListener("click", () => {
    const pos = getPos();
    const paragraph = view.state.schema.nodes.paragraph;
    if (pos === undefined || !paragraph) return;
    const tr = view.state.tr.insert(pos, paragraph.create());
    view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1))).scrollIntoView());
    view.focus();
  });
  return foot;
}

/** Reads again the title of the section that position `at` is in: the title bar that starts it. */
export function refreshHeads(view: EditorView, at: number): void {
  let found: HTMLElement | null = null;
  let from = -1;
  for (const head of view.dom.querySelectorAll<HTMLElement>(".kasten-sec-head")) {
    const pos = places.get(head)?.();
    if (pos !== undefined && pos <= at && pos >= from) {
      found = head;
      from = pos;
    }
  }
  if (found) refreshers.get(found)?.();
}
