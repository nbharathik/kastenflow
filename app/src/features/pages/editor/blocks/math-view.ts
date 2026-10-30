// Math as it reads. Inline math is drawn with KaTeX; a click, or
// Enter on it, opens a small field under it with the TeX, drawn live as it
// changes. A block shows its drawing, and its TeX while the caret is in it.

import "./math.css";

import type { Node } from "@milkdown/kit/prose/model";
import { Plugin, TextSelection } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView, type NodeView } from "@milkdown/kit/prose/view";
import { $prose, $view } from "@milkdown/kit/utils";
import katex from "katex";

import { el } from "../ui/dom";
import { KATEX } from "./katex-limits";
import { mathBlockSchema, mathInlineSchema } from "./math";

export { KATEX };

/** Draws `tex` into `host`; says so, gently, when the TeX does not parse. */
function draw(host: HTMLElement, tex: string, displayMode: boolean): void {
  host.classList.toggle("is-empty", !tex.trim());
  if (!tex.trim()) {
    host.textContent = displayMode ? "An empty equation" : "New equation";
    return;
  }
  try {
    katex.render(tex, host, { ...KATEX, displayMode, throwOnError: true });
    host.classList.remove("is-error");
  } catch {
    katex.render(tex, host, { ...KATEX, displayMode, throwOnError: false });
    host.classList.add("is-error");
  }
}

class MathInlineView implements NodeView {
  readonly dom: HTMLElement;
  private editor: HTMLElement | null = null;

  constructor(
    private node: Node,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
  ) {
    this.dom = el("span", "kasten-math", { contentEditable: "false" });
    this.dom.title = "Edit the equation";
    draw(this.dom, String(node.attrs.value), false);
    this.dom.addEventListener("mousedown", (event) => {
      event.preventDefault();
      this.open();
    });
    // Just made from the slash menu: straight into typing it.
    if (!String(node.attrs.value)) queueMicrotask(() => this.open());
  }

  update(node: Node): boolean {
    if (node.type !== this.node.type) return false;
    if (node.attrs.value !== this.node.attrs.value) draw(this.dom, String(node.attrs.value), false);
    this.node = node;
    return true;
  }

  selectNode(): void {
    this.dom.classList.add("is-selected");
  }

  deselectNode(): void {
    this.dom.classList.remove("is-selected");
  }

  stopEvent(): boolean {
    return true;
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    this.close(false);
  }

  /** The field under the equation, with its TeX. */
  open(): void {
    if (this.editor || !this.view.editable) return;
    const editor = el("div", "kasten-math-editor");
    const field = el("input", "kasten-math-field", { type: "text", value: String(this.node.attrs.value), spellcheck: false, placeholder: "E = mc^2" });
    field.setAttribute("aria-label", "Equation in TeX");
    const hint = el("span", "kasten-math-hint", { textContent: "Enter" });
    editor.append(field, hint);
    document.body.append(editor);
    this.editor = editor;
    this.dom.classList.add("is-open");
    this.place();
    field.addEventListener("input", () => this.set(field.value));
    field.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === "Escape" || event.key === "Tab") {
        event.preventDefault();
        this.close(true);
      }
    });
    field.addEventListener("blur", () => this.close(false));
    field.focus();
    field.select();
  }

  /** Under the equation, or over it when the window ends first. */
  private place(): void {
    if (!this.editor) return;
    const box = this.dom.getBoundingClientRect();
    const height = this.editor.offsetHeight || 40;
    const below = box.bottom + 6 + height <= window.innerHeight - 8;
    this.editor.style.left = `${Math.max(8, Math.min(box.left, window.innerWidth - 340))}px`;
    this.editor.style.top = `${below ? box.bottom + 6 : Math.max(8, box.top - 6 - height)}px`;
  }

  private set(value: string): void {
    const pos = this.getPos();
    if (pos === undefined) return;
    this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, value }));
    this.place();
  }

  /** Closes the field: an equation left empty goes, and the caret lands after it. */
  private close(refocus: boolean): void {
    const editor = this.editor;
    if (!editor) return;
    this.editor = null;
    editor.remove();
    this.dom.classList.remove("is-open");
    const pos = this.getPos();
    if (pos === undefined) return;
    const { state } = this.view;
    const node = state.doc.nodeAt(pos);
    if (!node || node.type !== this.node.type) return;
    const empty = !String(node.attrs.value).trim();
    if (!empty && !refocus) return;
    const tr = empty ? state.tr.delete(pos, pos + node.nodeSize) : state.tr;
    const after = empty ? pos : pos + node.nodeSize;
    tr.setSelection(TextSelection.create(tr.doc, Math.min(after, tr.doc.content.size)));
    this.view.dispatch(tr);
    if (refocus) this.view.focus();
  }
}

class MathBlockView implements NodeView {
  readonly dom: HTMLElement;
  readonly contentDOM: HTMLElement;
  private readonly preview: HTMLElement;

  constructor(
    private node: Node,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
  ) {
    this.dom = el("div", "kasten-math-block");
    const source = el("pre", "kasten-math-source");
    this.contentDOM = el("code", "");
    source.append(this.contentDOM);
    this.preview = el("div", "kasten-math-preview", { contentEditable: "false" });
    this.dom.append(source, this.preview);
    draw(this.preview, node.textContent, true);
    // A click on the drawing edits the TeX, with the caret at its end.
    this.preview.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const pos = this.getPos();
      if (pos === undefined) return;
      const end = pos + 1 + this.node.content.size;
      this.view.dispatch(this.view.state.tr.setSelection(TextSelection.create(this.view.state.doc, end)));
      this.view.focus();
    });
  }

  update(node: Node): boolean {
    if (node.type !== this.node.type) return false;
    if (node.textContent !== this.node.textContent) draw(this.preview, node.textContent, true);
    this.node = node;
    return true;
  }

  ignoreMutation(mutation: { target: globalThis.Node }): boolean {
    return this.preview.contains(mutation.target);
  }
}

export const mathInlineView = $view(mathInlineSchema.node, () => (node, view, getPos) => new MathInlineView(node, view, getPos));
export const mathBlockView = $view(mathBlockSchema.node, () => (node, view, getPos) => new MathBlockView(node, view, getPos));

/** Marks the block the caret is in, so it shows its TeX. */
export const mathEditing = $prose(
  () =>
    new Plugin({
      props: {
        decorations(state) {
          const { $from } = state.selection;
          for (let depth = $from.depth; depth > 0; depth--) {
            const node = $from.node(depth);
            if (node.type.name === "math_block") {
              const pos = $from.before(depth);
              return DecorationSet.create(state.doc, [Decoration.node(pos, pos + node.nodeSize, { class: "is-editing" })]);
            }
          }
          return null;
        },
      },
    }),
);
