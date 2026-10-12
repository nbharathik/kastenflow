// A divider (`---`) as the page shows it: its line, and on hover the title of
// the section it opens, a button that folds that section and one that presents
// the page from it. The Markdown is still a thematic break; the buttons are the
// view's. A divider inside a toggle, a list or a quote cuts no section, so it
// is a line and nothing more.

import "./divider.css";

import { hrSchema } from "@milkdown/kit/preset/commonmark";
import type { Node } from "@milkdown/kit/prose/model";
import type { Decoration, EditorView, NodeView } from "@milkdown/kit/prose/view";
import { $view } from "@milkdown/kit/utils";

import { startPresenting, toggleFold } from "../sections/api";
import { sectionTitle, sectionsOf } from "../sections/model";
import { el, withGlyph } from "../ui/dom";

const isFolded = (decorations: readonly Decoration[]) => decorations.some((d) => (d.spec as { folded?: boolean }).folded === true);

class DividerView implements NodeView {
  readonly dom: HTMLElement;
  private readonly fold: HTMLButtonElement;
  private readonly present: HTMLButtonElement;
  private readonly title: HTMLElement;

  constructor(
    private node: Node,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
    folded: boolean,
  ) {
    this.dom = el("div", "kasten-divider");
    const tools = el("span", "kasten-divider-tools");
    // Two different marks: a chevron that turns when the section folds, and a small
    // presentation screen with its word, so neither reads as the other.
    this.fold = withGlyph(el("button", "kasten-divider-fold", { type: "button" }), "icon:chevron-down", 14);
    this.present = withGlyph(el("button", "kasten-divider-present", { type: "button", title: "Present from here" }), "icon:present", 14, "Present");
    this.present.setAttribute("aria-label", "Present from here");
    this.title = el("span", "kasten-divider-title");
    tools.append(this.fold, this.present, this.title);
    this.dom.append(el("hr", "kasten-divider-line"), tools);
    // Pressing a button must not move the caret or select the divider.
    for (const button of [this.fold, this.present]) button.addEventListener("mousedown", (event) => event.preventDefault());
    this.fold.addEventListener("click", () => {
      const pos = this.getPos();
      if (pos !== undefined) toggleFold(this.view, pos);
    });
    this.present.addEventListener("click", () => {
      const pos = this.getPos();
      if (pos !== undefined) startPresenting(this.view, pos);
    });
    // The title is worked out only when someone looks for it.
    this.dom.addEventListener("mouseenter", () => this.readTitle());
    this.dom.addEventListener("focusin", () => this.readTitle());
    this.show(folded);
  }

  update(node: Node, decorations: readonly Decoration[]): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.show(isFolded(decorations));
    return true;
  }

  stopEvent(event: Event): boolean {
    return event.target instanceof globalThis.Node && (this.fold.contains(event.target) || this.present.contains(event.target));
  }

  ignoreMutation(): boolean {
    return true;
  }

  /** Whether it is among the page's own blocks, where it cuts a section. */
  private topLevel(): boolean {
    const pos = this.getPos();
    return pos !== undefined && this.view.state.doc.resolve(pos).depth === 0;
  }

  private show(folded: boolean): void {
    this.dom.classList.toggle("is-nested", !this.topLevel());
    this.dom.classList.toggle("is-folded", folded);
    this.fold.setAttribute("aria-expanded", String(!folded));
    this.fold.setAttribute("aria-label", folded ? "Unfold section" : "Fold section");
    this.fold.title = folded ? "Unfold this section" : "Fold this section";
  }

  private readTitle(): void {
    const pos = this.getPos();
    const { doc } = this.view.state;
    const section = pos === undefined ? undefined : sectionsOf(doc).find((s) => s.divider === pos);
    this.dom.classList.toggle("is-nested", !section);
    this.title.textContent = section ? sectionTitle(doc, section) : "";
  }
}

export const dividerView = $view(hrSchema.node, () => (node, view, getPos, decorations) => new DividerView(node, view, getPos, isFolded(decorations)));
