// Notion's block handle beside the hovered block: "+" adds a block below (or
// above with Alt) and opens the slash menu there; the grip drags the block
// (block-drag.ts), and a click on it opens the block menu. It follows the
// pointer every frame and finds blocks as Notion does (units.ts).

import type { Node } from "@milkdown/kit/prose/model";
import { NodeSelection, Plugin, PluginKey, Selection } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

import { iconElement } from "../../../../ui/icon-dom";
import { firstDividerOf, toggleFold } from "../sections/api";
import { START } from "../sections/model";
import { el } from "../ui/dom";
import type { Popover } from "../ui/popover";
import { pressBlock, unitAt } from "./block-drag";
import { openBlockMenu } from "./block-menu";
import { pickedBlocks, type BlocksAt } from "./block-range";
import { startSlash } from "./slash";
import type { BlockAt } from "./units";

/** Where a block's first line of text may be, in order. */
const LINES = [":scope > .kasten-toggle-header", ".kasten-callout-header", "p, h1, h2, h3, h4, h5, h6", ".cm-line"];

/** The first line of a block's text, which the handle lines up with. */
function firstLine(block: HTMLElement): { top: number; height: number } {
  let line: HTMLElement | null = null;
  if (block.matches("p, h1, h2, h3, h4, h5, h6")) line = block;
  for (const selector of LINES) {
    if (line) break;
    const found = block.querySelector<HTMLElement>(selector);
    if (found && found.getBoundingClientRect().height > 0) line = found;
  }
  if (!line) return { top: block.getBoundingClientRect().top, height: 26 };
  const style = getComputedStyle(line);
  const height = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.5 || 26;
  return { top: line.getBoundingClientRect().top + (Number.parseFloat(style.paddingTop) || 0), height };
}

/** How far into the margin the pointer may go and keep the handle. */
const MARGIN = 72;
const HANDLE = 24;

/** The handle's plugin; its state dims the block being dragged. */
const handleKey = new PluginKey<DecorationSet>("kasten-block-handle");

class HandleView {
  private readonly root: HTMLElement;
  private readonly content: HTMLElement;
  private readonly grip: HTMLButtonElement;
  private readonly fold: HTMLButtonElement;
  private active: (BlockAt & { el: HTMLElement }) | null = null;
  private pointer: { x: number; y: number } | null = null;
  private frame = 0;
  private dragging = false;
  private cancelDrag: (() => void) | null = null;
  private menu: Popover | null = null;

  constructor(private readonly view: EditorView) {
    this.root = view.dom.parentElement ?? document.body;
    this.content = el("div", "kasten-block-handle");
    this.content.dataset.show = "false";
    const add = el("button", "kasten-handle-button kasten-handle-add", { type: "button" });
    add.append(iconElement("plus", 16, 2));
    add.title = "Click to add below\nAlt-click to add above";
    add.setAttribute("aria-label", "Add block");
    this.grip = el("button", "kasten-handle-button kasten-handle-grip", { type: "button" });
    this.grip.append(iconElement("grip", 16, 2));
    this.grip.title = "Drag to move\nClick to open menu";
    this.grip.setAttribute("aria-label", "Block menu");
    // Beside the "+" of a block above the first divider: folds that first
    // section, which has no divider of its own to carry the button.
    this.fold = el("button", "kasten-handle-button kasten-handle-fold", { type: "button", hidden: true });
    this.fold.append(iconElement("fold", 16, 2));
    this.fold.title = "Fold this section";
    this.fold.setAttribute("aria-label", "Fold section");
    this.content.append(this.fold, add, this.grip);
    this.root.appendChild(this.content);

    // Cancelling pointerdown also stops the mousedown that would select text.
    for (const button of [add, this.fold]) {
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
    }
    add.addEventListener("click", (event) => this.addBlock(event.altKey));
    this.fold.addEventListener("click", () => toggleFold(this.view, START));
    this.grip.addEventListener("pointerdown", this.onGripDown);
    this.grip.addEventListener("click", () => this.openMenu());
    document.addEventListener("mousemove", this.onMove, { passive: true });
    view.dom.addEventListener("keydown", this.onKey);
  }

  update(view: EditorView, before: { doc: Node }): void {
    // The page changed under the handle: find the block again where the pointer is.
    if (!view.state.doc.eq(before.doc) && this.active) this.schedule();
  }

  destroy(): void {
    this.cancelDrag?.();
    cancelAnimationFrame(this.frame);
    document.removeEventListener("mousemove", this.onMove);
    this.view.dom.removeEventListener("keydown", this.onKey);
    this.menu?.close();
    this.content.remove();
  }

  private readonly onKey = () => this.hide();

  private readonly onMove = (event: MouseEvent) => {
    // Still while text is being selected or a block dragged.
    if (this.dragging || event.buttons !== 0) return;
    this.pointer = { x: event.clientX, y: event.clientY };
    this.schedule();
  };

  private schedule(): void {
    if (!this.frame) this.frame = requestAnimationFrame(this.locate);
  }

  private readonly locate = () => {
    this.frame = 0;
    if (this.dragging) return;
    const at = this.pointer;
    if (!at || !this.view.editable || !this.view.dom.isConnected) return this.hide();
    const box = this.view.dom.getBoundingClientRect();
    if (at.y < box.top || at.y > box.bottom || at.x < box.left - MARGIN || at.x > box.right + 24) return this.hide();
    // The innermost block at the pointer's height, so the margin where the
    // handle lives, even inside a toggle, keeps the block beside it.
    const found = unitAt(this.view, at.y);
    if (!found || found.el.getBoundingClientRect().height === 0) return this.hide();
    this.show(found);
  };

  private show(active: BlockAt & { el: HTMLElement }): void {
    this.active = active;
    const block = active.el.getBoundingClientRect();
    const root = this.root.getBoundingClientRect();
    const line = firstLine(active.el);
    // The first section's fold button, for blocks above the first divider.
    const first = firstDividerOf(this.view.state);
    this.fold.hidden = !(first !== null && active.pos < first);
    const width = this.content.offsetWidth || 44;
    const left = block.left - root.left - width - 2;
    const top = line.top - root.top + (Math.min(line.height, 40) - HANDLE) / 2;
    this.content.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    this.content.dataset.show = "true";
  }

  private hide(): void {
    if (this.content.dataset.show === "false" || this.menu?.isOpen) return;
    this.content.dataset.show = "false";
    this.active = null;
  }

  /** The block under the handle, selected whole, as a press on the grip does in Notion. */
  private selectBlock(): NodeSelection | null {
    const active = this.active;
    if (!active || !NodeSelection.isSelectable(active.node)) return null;
    const { state } = this.view;
    if (state.doc.nodeAt(active.pos) !== active.node) return null;
    const selection = NodeSelection.create(state.doc, active.pos);
    this.view.dispatch(state.tr.setSelection(selection));
    this.view.focus();
    return selection;
  }

  /** The blocks selected as a range, when the block under the handle is one of them. */
  private heldRange(): BlocksAt | null {
    const picked = pickedBlocks(this.view.state.selection);
    const active = this.active;
    return picked && picked.count > 1 && active && active.pos >= picked.from && active.pos < picked.to ? picked : null;
  }

  /** A press on the grip selects the block, and drags it once the pointer
   * travels; on one of several selected blocks it drags them all. */
  private readonly onGripDown = (event: PointerEvent) => {
    const active = this.active;
    if (event.button !== 0 || !active || this.cancelDrag) return;
    // No focus on the grip and no text selection: the block is what is held.
    event.preventDefault();
    const range = this.heldRange();
    if (!range) this.selectBlock();
    const { view } = this;
    this.cancelDrag = pressBlock({
      view,
      root: this.root,
      source: active,
      ...(range ? { range } : {}),
      event,
      onLift: (blocks) => {
        this.dragging = blocks !== null;
        view.dom.dataset.dragging = String(this.dragging);
        if (blocks) this.content.dataset.show = "false";
        view.dispatch(view.state.tr.setMeta(handleKey, blocks));
      },
      onEnd: () => {
        this.dragging = false;
        this.cancelDrag = null;
      },
    });
  };

  private addBlock(above: boolean): void {
    const active = this.active;
    if (!active) return;
    const { view } = this;
    const { state } = view;
    const { pos, node } = active;
    // An empty paragraph is already a place to type.
    if (node.type.name === "paragraph" && node.content.size === 0) {
      startSlash(view, pos + 1);
    } else {
      // Inside a list the new paragraph gets wrapped in a list item; type where it lands.
      const at = above ? pos : pos + node.nodeSize;
      const tr = state.tr.insert(at, state.schema.nodes.paragraph!.create());
      const target = Selection.findFrom(tr.doc.resolve(at), 1, true);
      if (!target) return;
      view.dispatch(tr);
      startSlash(view, target.from);
    }
    this.content.dataset.show = "false";
  }

  private openMenu(): void {
    const active = this.active;
    if (!active) return;
    this.menu?.close();
    this.menu = openBlockMenu(this.view, active.pos, () => this.grip.getBoundingClientRect(), this.heldRange() ?? undefined);
  }
}

/** Kasten's block handle, as a ProseMirror plugin view. */
export const blockHandle = $prose(
  () =>
    new Plugin({
      key: handleKey,
      state: {
        init: () => DecorationSet.empty,
        apply(tr, lifted) {
          const blocks = tr.getMeta(handleKey) as BlockAt[] | null | undefined;
          if (blocks === undefined) return lifted.map(tr.mapping, tr.doc);
          return blocks ? DecorationSet.create(tr.doc, blocks.map((block) => Decoration.node(block.pos, block.pos + block.node.nodeSize, { class: "kasten-block-lifted" }))) : DecorationSet.empty;
        },
      },
      props: { decorations: (state) => handleKey.getState(state) },
      view: (view) => new HandleView(view),
    }),
);
