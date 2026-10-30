// Dragging a bar with pointer events, no library: the body of a bar shifts its
// dates, its edges resize it. A press that travels a few pixels becomes a
// drag; the bar follows the pointer a day at a time (the preview lives in
// state, so only that bar redraws); the grid scrolls near its edges; letting
// go writes the new dates once (one gesture, one change); Escape puts it back.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

import { nudge, SLOP, swallowClick } from "../../../../ui/pointer-drag";
import { deltaDays, type Grip, type Scale } from "./layout";

/** A bar being carried: how far, in days, from where it was grabbed. */
export interface Preview {
  id: string;
  grip: Grip;
  delta: number;
}

interface Session {
  id: string;
  grip: Grip;
  pointer: number;
  x0: number;
  scroll0: number;
  x: number;
  moved: boolean;
  frame: number;
  delta: number;
  finish(land: boolean): void;
}

export interface BarDrag {
  preview: Preview | null;
  /** A press on a bar's body or edge (`grip`): it becomes a drag once the pointer travels. */
  press(event: ReactPointerEvent<HTMLElement>, id: string, grip: Grip): void;
}

export function useBarDrag(scroller: RefObject<HTMLElement | null>, scale: Scale, onDrop: (id: string, grip: Grip, delta: number) => void): BarDrag {
  const [preview, setPreview] = useState<Preview | null>(null);
  const latest = useRef({ scale, onDrop });
  useLayoutEffect(() => {
    latest.current = { scale, onDrop };
  });
  const active = useRef<Session | null>(null);
  // Leaving the view mid-drag puts the bar back.
  useEffect(() => () => active.current?.finish(false), []);

  const press = useCallback(
    (event: ReactPointerEvent<HTMLElement>, id: string, grip: Grip) => {
      // Modifier clicks open elsewhere and never drag.
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || active.current) return;
      const root = scroller.current;
      const s: Session = {
        id,
        grip,
        pointer: event.pointerId,
        x0: event.clientX,
        scroll0: root?.scrollLeft ?? 0,
        x: event.clientX,
        moved: false,
        frame: 0,
        delta: 0,
        finish: () => {},
      };

      /** The days the pointer is worth, counting what the grid has scrolled meanwhile. */
      const measure = () => {
        const travelled = s.x - s.x0 + ((root?.scrollLeft ?? 0) - s.scroll0);
        const delta = deltaDays(travelled, latest.current.scale);
        if (delta === s.delta) return;
        s.delta = delta;
        setPreview({ id, grip, delta });
      };
      const scroll = () => {
        s.frame = 0;
        if (!root || !nudge(root, "x", s.x)) return;
        measure();
        s.frame = requestAnimationFrame(scroll);
      };
      const onMove = (e: PointerEvent) => {
        if (e.pointerId !== s.pointer) return;
        // Let go somewhere the page never heard of it.
        if ((e.buttons & 1) === 0) return s.finish(false);
        s.x = e.clientX;
        if (!s.moved) {
          if (Math.abs(s.x - s.x0) < SLOP) return;
          s.moved = true;
          root?.setAttribute("data-dragging", "");
          document.getSelection()?.removeAllRanges();
        }
        e.preventDefault();
        measure();
        if (!s.frame && typeof requestAnimationFrame === "function") s.frame = requestAnimationFrame(scroll);
      };
      const onUp = (e: PointerEvent) => {
        if (e.pointerId !== s.pointer) return;
        s.x = e.clientX;
        if (s.moved) measure();
        s.finish(true);
      };
      const onCancel = () => s.finish(false);
      const onKey = (e: KeyboardEvent) => {
        if (e.key !== "Escape") return;
        // Escape belongs to a drag; a mere press lets it through.
        if (s.moved) {
          e.preventDefault();
          e.stopPropagation();
        }
        s.finish(false);
      };
      s.finish = (land) => {
        if (active.current !== s) return;
        active.current = null;
        if (s.frame) cancelAnimationFrame(s.frame);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("keydown", onKey, true);
        window.removeEventListener("blur", onCancel);
        root?.removeAttribute("data-dragging");
        setPreview(null);
        if (!s.moved) return; // A click, not a drag: the click opens the note.
        swallowClick();
        if (land && s.delta !== 0) latest.current.onDrop(id, grip, s.delta);
      };
      active.current = s;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("keydown", onKey, true);
      window.addEventListener("blur", onCancel);
    },
    [scroller],
  );

  return { preview, press };
}
