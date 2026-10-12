// Dragging a block by its handle with pointer events rather than
// the browser's drag and drop, which let blocks fall into other blocks' text
// (a toggle's title took the dragged text) and felt different in every
// webview. A press on the grip that travels a few pixels lifts the block: it
// dims, a copy follows the pointer, and a line shows the gap it will land
// in, between blocks only. The page scrolls near its edges, letting go moves
// the block in one step (move-block.ts), and Escape puts it back.

import type { EditorView } from "@milkdown/kit/prose/view";

import { nudge, scrollerOf, SLOP, swallowClick } from "../../../../ui/pointer-drag";
import { carryFolds } from "../blocks/toggle-view";
import { el } from "../ui/dom";
import { blocksIn, type BlocksAt } from "./block-range";
import { keepBlockSelected } from "./block-nav";
import { moveBlockTo } from "./move-block";
import { moveBlocksTo } from "./move-blocks";
import { blockNear, dropGap, type BlockAt } from "./units";

/** Attributes the copy must not carry: it is only a picture. */
const PICTURE_ONLY = ["id", "contenteditable", "draggable", "tabindex", "role", "aria-label", "data-testid"];

/** A copy of the blocks to carry, with the same look. */
function picture(blocks: readonly HTMLElement[], width: number): HTMLElement {
  const ghost = el("div", "ProseMirror kasten-block-ghost");
  ghost.setAttribute("aria-hidden", "true");
  for (const block of blocks) {
    const copy = block.cloneNode(true) as HTMLElement;
    // Fields keep what they show: a toggle's title is an input's value.
    const fields = block.querySelectorAll<HTMLInputElement>("input, textarea");
    copy.querySelectorAll<HTMLInputElement>("input, textarea").forEach((field, i) => {
      field.value = fields[i]?.value ?? "";
    });
    for (const node of [copy, ...copy.querySelectorAll<HTMLElement>("*")]) for (const name of PICTURE_ONLY) node.removeAttribute(name);
    copy.classList.remove("ProseMirror-selectednode", "kasten-block-lifted", "kasten-range-picked");
    ghost.append(copy);
  }
  ghost.style.width = `${width}px`;
  return ghost;
}

/** Where a unit's insides start, across the page: a list item's text, past its bullet. */
function levelOf(view: EditorView, at: BlockAt): number {
  const dom = view.nodeDOM(at.pos);
  if (!(dom instanceof HTMLElement)) return 0;
  const text = at.node.type.name === "list_item" ? dom.querySelector<HTMLElement>(".children") : null;
  return (text ?? dom).getBoundingClientRect().left;
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/**
 * The innermost block at height `y` in the editor. It looks across the
 * middle of the text column, where blocks inside toggles, callouts and lists
 * are, rather than at the pointer, which sits in the margin by the handle.
 */
export function unitAt(view: EditorView, y: number): (BlockAt & { el: HTMLElement }) | null {
  const box = view.dom.getBoundingClientRect();
  const hit = view.posAtCoords({ left: (box.left + box.right) / 2, top: clamp(y, box.top + 1, box.bottom - 1) });
  const found = hit && blockNear(view.state.doc, hit);
  const dom = found && view.nodeDOM(found.pos);
  return found && dom instanceof HTMLElement ? { ...found, el: dom } : null;
}

interface Press {
  view: EditorView;
  /** The editor's positioned wrapper, where the copy and the line are drawn. */
  root: HTMLElement;
  /** The block whose grip was pressed. */
  source: BlockAt & { el: HTMLElement };
  /** Several blocks selected as a range, the grabbed one among them: they all move. */
  range?: BlocksAt;
  event: PointerEvent;
  /** The blocks were lifted, or put down (null). */
  onLift(blocks: BlockAt[] | null): void;
  /** The press is over, dragged or not. */
  onEnd(): void;
}

/** Follows a press on a block's grip; returns what ends it early, quietly (the editor is going). */
export function pressBlock({ view, root, source, range, event, onLift, onEnd }: Press): () => void {
  const pointer = event.pointerId;
  // What is carried: the block, or the whole range it is in.
  const several = range && range.count > 1 ? range : null;
  const start = several ? several.from : source.pos;
  const end = several ? several.to : source.pos + source.node.nodeSize;
  const moveTo = (state: typeof view.state, pos: number) => (several ? moveBlocksTo(state, several, pos) : moveBlockTo(state, source, pos));
  const x0 = event.clientX;
  const y0 = event.clientY;
  let x = x0;
  let y = y0;
  let ghost: HTMLElement | null = null;
  let line: HTMLElement | null = null;
  let grab = { x: 0, y: 0 };
  let level = 0;
  let scroller: HTMLElement | null = null;
  let target: number | null = null;
  let frame = 0;
  let done = false;

  /** The gap under the pointer and where its line goes, or null where the block cannot land. */
  const gapAt = () => {
    const unit = unitAt(view, y);
    if (!unit) return null;
    // Over the blocks themselves, or inside them: they stay where they are.
    if (unit.pos >= start && unit.pos < end) return null;
    const { doc } = view.state;
    const box = view.dom.getBoundingClientRect();
    const rect = unit.el.getBoundingClientRect();
    const held = level + (x - x0);
    const gap = dropGap(doc, unit, y > rect.top + rect.height / 2, (at) => levelOf(view, at) - held);
    const beside = view.nodeDOM(gap.at.pos);
    if (!(beside instanceof HTMLElement) || !moveTo(view.state, gap.pos)) return null;
    const edge = beside.getBoundingClientRect();
    return { pos: gap.pos, left: levelOf(view, gap.at), right: Math.max(edge.right, box.right), y: gap.after ? edge.bottom : edge.top };
  };

  const draw = () => {
    if (!ghost || !line) return;
    const box = root.getBoundingClientRect();
    ghost.style.transform = `translate3d(${Math.round(x - grab.x - box.left)}px, ${Math.round(y - grab.y - box.top)}px, 0)`;
    const gap = gapAt();
    target = gap?.pos ?? null;
    line.dataset.show = String(gap !== null);
    if (!gap) return;
    line.style.width = `${Math.round(gap.right - gap.left)}px`;
    line.style.transform = `translate3d(${Math.round(gap.left - box.left)}px, ${Math.round(gap.y - box.top) - 1}px, 0)`;
  };

  const tick = () => {
    frame = 0;
    const scrolled = scroller ? nudge(scroller, "y", y) : false;
    draw();
    if (scrolled) frame = requestAnimationFrame(tick);
  };

  const lift = () => {
    const rect = source.el.getBoundingClientRect();
    grab = { x: x0 - rect.left, y: y0 - rect.top };
    level = levelOf(view, source);
    scroller = scrollerOf(view.dom);
    const carried: BlockAt[] = several ? blocksIn(view.state.doc, several).map((node, i, all) => ({ node, pos: start + all.slice(0, i).reduce((sum, n) => sum + n.nodeSize, 0) })) : [source];
    ghost = picture(
      carried.flatMap((block) => {
        const dom = view.nodeDOM(block.pos);
        return dom instanceof HTMLElement ? [dom] : [];
      }),
      rect.width,
    );
    line = el("div", "kasten-drop-line");
    line.dataset.show = "false";
    root.append(line, ghost);
    document.documentElement.classList.add("kasten-dragging-block");
    onLift(carried);
  };

  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== pointer) return;
    // Let go somewhere the page never heard of it.
    if ((e.buttons & 1) === 0) return finish(false);
    x = e.clientX;
    y = e.clientY;
    if (!ghost) {
      if (Math.hypot(x - x0, y - y0) < SLOP) return;
      lift();
    }
    e.preventDefault();
    if (!frame) frame = requestAnimationFrame(tick);
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== pointer) return;
    x = e.clientX;
    y = e.clientY;
    if (ghost) draw();
    finish(true);
  };
  const onCancel = () => finish(false);
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    // Escape belongs to a drag; a mere press lets it through.
    if (ghost) {
      e.preventDefault();
      e.stopPropagation();
    }
    finish(false);
  };

  function finish(land: boolean, quiet = false): void {
    if (done) return;
    done = true;
    if (frame) cancelAnimationFrame(frame);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("blur", onCancel);
    // A click, not a drag: the grip's click opens the block menu.
    if (ghost) {
      ghost.remove();
      line?.remove();
      document.documentElement.classList.remove("kasten-dragging-block");
      swallowClick();
    }
    if (ghost && !quiet) {
      onLift(null);
      const tr = land && target !== null ? moveTo(view.state, target) : null;
      if (tr) {
        // An open toggle stays open where it lands.
        carryFolds(view, start, end);
        view.dispatch(tr);
        keepBlockSelected(view);
      }
    }
    onEnd();
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("blur", onCancel);
  return () => finish(false, true);
}
