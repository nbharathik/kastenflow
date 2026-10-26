// The columns block as the page draws it: its columns side by side, and a
// gutter between each two to drag (or to focus and nudge with the arrow keys)
// for their widths. The gutters are page furniture, not content.

import type { Node } from "@milkdown/kit/prose/model";
import type { EditorView, NodeView, ViewMutationRecord } from "@milkdown/kit/prose/view";
import { $view } from "@milkdown/kit/utils";

import { el } from "../ui/dom";
import { asPercent, dragGutter, ratioAfterDrag } from "./drag";
import { setColumnsRatio } from "./ops";
import { columnsSchema } from "./node";
import { formatRatio, MIN_SHARE, parseRatio } from "./serialize";
import "./columns.css";

/** How far an arrow key moves a gutter, in percent of the whole. */
const NUDGE = 5;
/** The columns' gap in pixels, as columns.css sets it. */
const GAP = 32;

class ColumnsView implements NodeView {
  readonly dom: HTMLElement;
  readonly contentDOM: HTMLElement;
  private readonly gutters: HTMLElement;
  private readonly handles: HTMLElement[] = [];
  /** Cancels a drag in progress when the block is redrawn or goes. */
  private stop: (() => void) | null = null;

  constructor(
    private node: Node,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
  ) {
    this.dom = el("div", "kasten-columns");
    this.contentDOM = el("div", "kasten-columns-body");
    this.gutters = el("div", "kasten-columns-gutters", { contentEditable: "false" });
    this.dom.append(this.contentDOM, this.gutters);
    this.render();
  }

  update(node: Node): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  destroy(): void {
    this.stop?.();
  }

  stopEvent(event: Event): boolean {
    return event.target instanceof globalThis.Node && this.gutters.contains(event.target);
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    if (mutation.type === "selection") return false;
    return !this.contentDOM.contains(mutation.target);
  }

  /** The widths now, as shares of 100. */
  private parts(): number[] {
    return asPercent(parseRatio(String(this.node.attrs.ratio), this.node.childCount));
  }

  private render(): void {
    this.show(this.parts());
  }

  /** Draws the columns at these widths (not yet written to the page). */
  private show(parts: readonly number[]): void {
    const count = parts.length;
    this.contentDOM.style.setProperty("--kf-columns", parts.map((p) => `minmax(0, ${p}fr)`).join(" "));
    while (this.handles.length > count - 1) this.handles.pop()!.remove();
    while (this.handles.length < count - 1) this.handles.push(this.addHandle(this.handles.length));
    let before = 0;
    this.handles.forEach((handle, i) => {
      before += parts[i]!;
      handle.style.setProperty("--kf-cut", String(before / 100));
      handle.style.setProperty("--kf-index", String(i + 1));
      handle.style.setProperty("--kf-count", String(count));
      handle.setAttribute("aria-valuenow", String(parts[i]));
      handle.setAttribute("aria-label", `Resize columns ${i + 1} and ${i + 2}`);
    });
  }

  private addHandle(cut: number): HTMLElement {
    const handle = el("div", "kasten-columns-gutter", { tabIndex: 0 });
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-orientation", "vertical");
    handle.setAttribute("aria-valuemin", String(MIN_SHARE));
    handle.setAttribute("aria-valuemax", String(100 - MIN_SHARE));
    handle.addEventListener("pointerdown", (event) => this.press(event, handle, cut));
    handle.addEventListener("keydown", (event) => this.nudge(event, cut));
    this.gutters.append(handle);
    return handle;
  }

  private write(parts: readonly number[]): void {
    const pos = this.getPos();
    if (pos === undefined) return;
    setColumnsRatio(pos, formatRatio(parts))(this.view.state, this.view.dispatch);
  }

  private press(event: PointerEvent, handle: HTMLElement, cut: number): void {
    if (event.button !== 0) return;
    event.preventDefault();
    handle.focus();
    const start = this.parts();
    const room = this.contentDOM.getBoundingClientRect().width - GAP * (start.length - 1);
    this.dom.classList.add("is-resizing");
    const end = () => {
      this.dom.classList.remove("is-resizing");
      this.stop = null;
    };
    this.stop = dragGutter(event, handle, {
      start,
      cut,
      room,
      onMove: (parts) => this.show(parts),
      onDrop: (parts) => {
        end();
        this.write(parts);
        this.render();
      },
      onCancel: () => {
        end();
        this.render();
      },
    });
  }

  /** Left and Right on a focused gutter move it; Home and End put the columns back to equal widths. */
  private nudge(event: KeyboardEvent, cut: number): void {
    const step = event.key === "ArrowLeft" ? -NUDGE : event.key === "ArrowRight" ? NUDGE : 0;
    if (step === 0 && event.key !== "Home") return;
    event.preventDefault();
    event.stopPropagation();
    this.write(step === 0 ? this.parts().map(() => 1) : ratioAfterDrag(this.parts(), cut, step));
  }
}

export const columnsView = $view(columnsSchema.node, () => (node, view, getPos) => new ColumnsView(node, view, getPos));
