// The one row a folded section leaves in the page: "▸ Title · 3 blocks",
// which unfolds it when clicked.

import type { EditorView } from "@milkdown/kit/prose/view";

import { el } from "../ui/dom";
import { sectionsKey } from "./key";
import { START } from "./model";

/** "1 block", "3 blocks". */
export const blocksLabel = (blocks: number) => `${blocks} ${blocks === 1 ? "block" : "blocks"}`;

/** The row for a section folded away: the first one (which has no divider) or the one whose divider is just before the row. */
export function summaryRow(view: EditorView, getPos: () => number | undefined, first: boolean, title: string, blocks: number): HTMLElement {
  const row = el("div", "kasten-section-summary", { contentEditable: "false", tabIndex: 0 });
  row.setAttribute("role", "button");
  row.setAttribute("aria-label", `Unfold section: ${title}`);
  row.append(el("span", "kasten-section-summary-arrow", { textContent: "▸" }), el("span", "kasten-section-summary-title", { textContent: title }), el("span", "kasten-section-summary-count", { textContent: `· ${blocksLabel(blocks)}` }));
  const unfold = () => {
    // Where the row is now, since the page may have grown above it.
    const at = getPos();
    if (at === undefined) return;
    view.dispatch(view.state.tr.setMeta(sectionsKey, { set: [first ? START : at - 1], folded: false }));
  };
  // Pressing it must not move the caret or start a text selection.
  row.addEventListener("mousedown", (event) => event.preventDefault());
  row.addEventListener("click", unfold);
  row.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    unfold();
  });
  return row;
}
