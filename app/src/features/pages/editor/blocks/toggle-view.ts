// The toggle as Notion shows it: a triangle, the summary, and a body that
// folds away. Folding is view state only, so reading a note never changes it.

import type { Node } from "@milkdown/kit/prose/model";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView, NodeView, ViewMutationRecord } from "@milkdown/kit/prose/view";
import { $view } from "@milkdown/kit/utils";

import { el } from "../ui/dom";
import { isBlankBody, toggleSchema } from "./toggle";

/** Live toggle views, so Ctrl+Enter can fold the one around the caret. */
const views = new Set<ToggleView>();
/** Folds kept for toggles drawn anew by a move, by node: a moved block is the same node. */
const carried = new WeakMap<Node, boolean>();

/** Keeps the folds of `editor`'s toggles from `from` to `to` for the redraw that moving them makes. */
export function carryFolds(editor: EditorView, from: number, to: number): void {
  const kept: Node[] = [];
  for (const toggle of views) {
    const pos = toggle.position();
    if (toggle.editor === editor && pos !== undefined && pos >= from && pos < to) kept.push(toggle.keepFold());
  }
  // Only for the redraw that follows at once.
  queueMicrotask(() => kept.forEach((node) => carried.delete(node)));
}

/** Folds or unfolds the toggle at `pos`; false if none is shown there. */
export function flipToggleAt(pos: number): boolean {
  for (const view of views) {
    if (view.position() === pos) {
      view.flip();
      return true;
    }
  }
  return false;
}

/** Opens the toggle at `pos` (of `editor`, when given) if it is closed, as
 * find does for a match inside it; true when one was opened. */
export function openToggleAt(pos: number, editor?: EditorView): boolean {
  for (const view of views) {
    if (view.position() === pos && (!editor || view.editor === editor)) return view.open();
  }
  return false;
}

class ToggleView implements NodeView {
  readonly dom: HTMLElement;
  readonly contentDOM: HTMLElement;
  private readonly arrow: HTMLButtonElement;
  private readonly summary: HTMLInputElement;
  private expanded: boolean;

  constructor(
    private node: Node,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
  ) {
    // A toggle opens as the file says; one with nothing inside yet opens for typing.
    const empty = isBlankBody(node);
    this.expanded = carried.get(node) ?? (Boolean(node.attrs.open) || empty);

    this.dom = el("div", "kasten-toggle");
    const header = el("div", "kasten-toggle-header", { contentEditable: "false" });
    this.arrow = el("button", "kasten-toggle-arrow", { type: "button" });
    this.summary = el("input", "kasten-toggle-summary", { type: "text", placeholder: "Toggle", spellcheck: true });
    this.summary.setAttribute("aria-label", "Toggle title");
    this.contentDOM = el("div", "kasten-toggle-body");
    header.append(this.arrow, this.summary);
    this.dom.append(header, this.contentDOM);

    this.arrow.addEventListener("mousedown", (event) => {
      event.preventDefault();
      this.setExpanded(!this.expanded);
    });
    this.summary.addEventListener("input", () => this.setAttrs({ summary: this.summary.value }));
    this.summary.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === "ArrowDown") {
        event.preventDefault();
        this.setExpanded(true);
        this.focusBody();
      }
    });
    this.render();
    views.add(this);
    if (empty && node.attrs.summary === "" && view.hasFocus()) queueMicrotask(() => this.summary.focus());
  }

  position(): number | undefined {
    return this.getPos();
  }

  get editor(): EditorView {
    return this.view;
  }

  /** Remembers this toggle's fold for a view of the same node drawn next; returns the node. */
  keepFold(): Node {
    carried.set(this.node, this.expanded);
    return this.node;
  }

  flip(): void {
    this.setExpanded(!this.expanded);
  }

  /** Opens it; false when it already was. */
  open(): boolean {
    if (this.expanded) return false;
    this.setExpanded(true);
    return true;
  }

  destroy(): void {
    views.delete(this);
  }

  update(node: Node): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  stopEvent(event: Event): boolean {
    const target = event.target as globalThis.Node | null;
    return !!target && (this.arrow.contains(target) || this.summary.contains(target));
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    if (mutation.type === "selection") return false;
    return !this.contentDOM.contains(mutation.target);
  }

  private render(): void {
    const summary = String(this.node.attrs.summary);
    if (document.activeElement !== this.summary && this.summary.value !== summary) this.summary.value = summary;
    this.dom.classList.toggle("is-open", this.expanded);
    this.arrow.setAttribute("aria-expanded", String(this.expanded));
    this.arrow.setAttribute("aria-label", this.expanded ? "Collapse" : "Expand");
  }

  private setExpanded(expanded: boolean): void {
    this.expanded = expanded;
    this.render();
  }

  private setAttrs(attrs: Record<string, string>): void {
    const pos = this.getPos();
    if (pos === undefined) return;
    this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, ...attrs }));
  }

  private focusBody(): void {
    const pos = this.getPos();
    if (pos === undefined) return;
    const { state } = this.view;
    this.view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(pos + 2))));
    this.view.focus();
  }
}

export const toggleView = $view(toggleSchema.node, () => (node, view, getPos) => new ToggleView(node, view, getPos));
