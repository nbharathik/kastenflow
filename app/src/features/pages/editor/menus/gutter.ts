// The empty space beside and below the page's text. A short click there puts
// the caret where it points (focus.ts); a press that travels selects blocks
// instead: the blocks level with the pointer, from where it was pressed, as
// dragging in the margin does in Notion. The page marks its column
// `data-editor-gutter`; clicks on the editor's own text are the editor's.

import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

import { nudge, scrollerOf, SLOP, swallowClick } from "../../../../ui/pointer-drag";
import { rangeBetween } from "./block-range";
import { unitAt } from "./block-drag";
import { focusAt } from "./focus";

/** The column the press is in, when it is on empty space around `view`: the
 * column itself, a wrapper around the editor, or the room below it. */
export function gutterOf(view: EditorView, target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const column = target.closest<HTMLElement>("[data-editor-gutter]");
  if (!column || !column.contains(view.dom) || target === view.dom) return null;
  return target === column || target.contains(view.dom) || target.classList.contains("kasten-page-tail") ? column : null;
}

/** Follows a press in the gutter until it ends; returns what ends it early. */
export function pressGutter(view: EditorView, event: PointerEvent): () => void {
  const pointer = event.pointerId;
  const x0 = event.clientX;
  const y0 = event.clientY;
  let y = y0;
  let dragging = false;
  let scroller: HTMLElement | null = null;
  let frame = 0;
  let done = false;
  const from = unitAt(view, y0);

  const select = () => {
    const to = unitAt(view, y);
    const selection = from && to ? rangeBetween(view.state.doc, from.pos, to.pos) : null;
    if (selection && !selection.eq(view.state.selection)) view.dispatch(view.state.tr.setSelection(selection));
  };
  const tick = () => {
    frame = 0;
    const scrolled = scroller ? nudge(scroller, "y", y) : false;
    select();
    if (scrolled) frame = requestAnimationFrame(tick);
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== pointer) return;
    if ((e.buttons & 1) === 0) return finish(false);
    y = e.clientY;
    if (!dragging) {
      if (Math.hypot(e.clientX - x0, y - y0) < SLOP) return;
      dragging = true;
      scroller = scrollerOf(view.dom);
      view.focus();
    }
    e.preventDefault();
    if (!frame) frame = requestAnimationFrame(tick);
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== pointer) return;
    y = e.clientY;
    finish(true, e.clientX);
  };
  const onCancel = () => finish(false);

  function finish(land: boolean, x = x0): void {
    if (done) return;
    done = true;
    if (frame) cancelAnimationFrame(frame);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("blur", onCancel);
    if (!land || view.isDestroyed) return;
    if (dragging) {
      select();
      swallowClick();
      view.focus();
    } else focusAt(view, x, y);
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
  window.addEventListener("blur", onCancel);
  return () => finish(false);
}

export const gutter = $prose(
  () =>
    new Plugin({
      key: new PluginKey("KASTEN_GUTTER"),
      view: (view) => {
        let press: (() => void) | null = null;
        const onDown = (event: PointerEvent) => {
          if (event.button !== 0 || !view.editable || !gutterOf(view, event.target)) return;
          press?.();
          // No text selection or focus change: the press is the editor's to place.
          event.preventDefault();
          press = pressGutter(view, event);
        };
        document.addEventListener("pointerdown", onDown, true);
        return {
          destroy() {
            document.removeEventListener("pointerdown", onDown, true);
            press?.();
          },
        };
      },
    }),
);
