// Dragging slides to a new place with the pointer, for the filmstrip and the
// grid. The pointer's own events are used (not the browser's drag and drop),
// so it works the same in every webview. What is under the pointer is the
// view's business (`locate`); this file holds the gesture, the sums that turn
// a place into a move, and the moving.

import { type PointerEvent as ReactPointerEvent, type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { speedAt } from "../canvas/edge-scroll.ts";
import type { EditorSession } from "../session/session.ts";

/** A move worked out: where the slides go, and what the order becomes. */
export interface MovePlan {
  /** The moving slides, in deck order. */
  ids: string[];
  /** Where the first lands, counted among the slides that stay: what `slides.move` takes. */
  to: number;
  /** The order of the whole deck afterwards. */
  result: string[];
  /** Whether the move changes anything. */
  changed: boolean;
}

/**
 * Moves `moving` to the gap in `order` before the slide at index `gap` (the
 * number of slides is the gap after the last). The moving slides keep their
 * order among themselves, whichever way round they were picked.
 */
export function planMove(order: readonly string[], moving: readonly string[], gap: number): MovePlan {
  const chosen = new Set(moving);
  const ids = order.filter((id) => chosen.has(id));
  const staying = order.filter((id) => !chosen.has(id));
  const at = Math.min(Math.max(Math.round(gap), 0), order.length);
  const to = order.slice(0, at).filter((id) => !chosen.has(id)).length;
  const result = [...staying.slice(0, to), ...ids, ...staying.slice(to)];
  return { ids, to, result, changed: result.some((id, i) => id !== order[i]) };
}

/** Where a drop would land: the gap, and which side of its neighbour a line for it is drawn (a grid needs to say). */
export interface Spot {
  gap: number;
  side?: "start" | "end";
}

/** A drag under way: the slides being moved, and where they would land (null while the pointer points at nothing). */
export interface Drag {
  ids: readonly string[];
  spot: Spot | null;
  /** Alt, Ctrl or Cmd is held: where they are put down copies of them will be, and they stay where they are. */
  copy: boolean;
  /** Copies of the slides' thumbnails, which are drawn in the hand and follow the pointer; none where the view gives no way to copy them. */
  frames: readonly HTMLElement[];
}

/** How a drag ended, for the view to land the slides: where they were in the window, and whether they went to a new place. */
export interface Drop {
  ids: readonly string[];
  /** The top left of what was in the hand, in the window. */
  from: { x: number; y: number };
  /** The slides were moved to a place they were not in. */
  moved: boolean;
}

export interface ReorderOptions {
  session: EditorSession;
  /** The spot in the slide order that the pointer points at, or null when it is not over the list. */
  locate(x: number, y: number): Spot | null;
  /** The element that scrolls; it keeps scrolling while the pointer rests near its top or bottom edge. */
  scroller: RefObject<HTMLElement | null>;
  /** The drawing of a slide's thumbnail, to copy into the hand. */
  frameOf?(id: string): HTMLElement | null;
  /** Called as the slides are put down (or called off), before the order changes. */
  onDrop?(drop: Drop): void;
}

export interface Reorder {
  drag: Drag | null;
  /** Call from the pointer-down of a slide. A press that does not move stays a click. */
  begin(event: ReactPointerEvent, id: string): void;
  /** Whether the click that follows a drag should be ignored (asking clears it). */
  swallowClick(): boolean;
  /** Put on the element that holds the slides in the hand; it follows the pointer. */
  badge: RefObject<HTMLDivElement | null>;
}

/** How far the pointer must move before a press becomes a drag. */
const THRESHOLD = 4;
/** Where the slides in the hand are held, from the pointer, when the view gives no thumbnails to hold them by. */
const HELD_BY = { x: -14, y: -14 };

export function useReorder({ session, locate, scroller, frameOf, onDrop }: ReorderOptions): Reorder {
  const [drag, setDrag] = useState<Drag | null>(null);
  const badge = useRef<HTMLDivElement>(null);
  const pointer = useRef({ x: 0, y: 0 });
  // Where in the thumbnail the pointer took hold, so that it stays under the pointer as it goes.
  const grab = useRef<{ x: number; y: number }>(HELD_BY);
  const swallow = useRef(false);
  const quiet = useRef<number | undefined>(undefined);
  const where = useRef(locate);
  const end = useRef<(() => void) | null>(null);
  const hooks = useRef({ frameOf, onDrop });

  useLayoutEffect(() => {
    where.current = locate;
    hooks.current = { frameOf, onDrop };
  });

  const place = useCallback(() => {
    const element = badge.current;
    if (element) element.style.transform = `translate(${pointer.current.x - grab.current.x}px, ${pointer.current.y - grab.current.y}px)`;
  }, []);

  // The hand appears after the drag starts; put it at the pointer at once.
  useLayoutEffect(place, [drag === null, place]);
  useEffect(() => () => end.current?.(), []);

  const begin = useCallback(
    (event: ReactPointerEvent, id: string) => {
      // Shift is the range of a click. Ctrl, Cmd and Alt with a click add to the slides picked; pulled, they are a drag that copies.
      if (event.button !== 0 || event.shiftKey) return;
      end.current?.();
      window.clearTimeout(quiet.current);
      swallow.current = false;
      // With the pointer held by the slide, a release outside the window still ends the drag.
      try {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      } catch {
        // Not every environment can capture the pointer; the window's own events do.
      }
      const origin = { x: event.clientX, y: event.clientY };
      pointer.current = origin;
      let ids: string[] | null = null;
      let spot: Spot | null = null;
      let frame: number | undefined;

      const refresh = () => {
        if (!ids) return;
        const next = where.current(pointer.current.x, pointer.current.y);
        if (next?.gap === spot?.gap && next?.side === spot?.side) return;
        spot = next;
        setDrag((now) => (now ? { ...now, spot } : now));
      };

      // Near the top or bottom edge the list keeps scrolling by itself, faster the nearer the edge.
      const scroll = () => {
        frame = undefined;
        if (!ids) return;
        const element = scroller.current;
        const rect = element?.getBoundingClientRect();
        if (element && rect && rect.height > 0) {
          const speed = speedAt(pointer.current.y, rect.top, rect.bottom);
          const before = element.scrollTop;
          if (speed !== 0) element.scrollTop += speed;
          if (element.scrollTop !== before) refresh();
        }
        frame = requestAnimationFrame(scroll);
      };

      const finish = (dropped?: { moved: boolean }) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("keydown", onKey, true);
        if (frame !== undefined) cancelAnimationFrame(frame);
        frame = undefined;
        end.current = null;
        // The view lands the slides from where they were held, whether they went to a new place or home.
        if (ids && dropped) hooks.current.onDrop?.({ ids, from: { x: pointer.current.x - grab.current.x, y: pointer.current.y - grab.current.y }, moved: dropped.moved });
        setDrag(null);
      };

      // Alt, Ctrl or Cmd held: the slides are copied where they are put down.
      let copying = false;
      const copies = (keys: { altKey: boolean; ctrlKey: boolean; metaKey: boolean }) => keys.altKey || keys.ctrlKey || keys.metaKey;

      function onMove(move: PointerEvent) {
        pointer.current = { x: move.clientX, y: move.clientY };
        if (ids && copies(move) !== copying) {
          copying = copies(move);
          setDrag((now) => (now ? { ...now, copy: copying } : now));
        }
        if (!ids) {
          if (Math.hypot(move.clientX - origin.x, move.clientY - origin.y) < THRESHOLD) return;
          // Pressing an unselected slide and pulling it takes just that one; a selected one takes them all.
          if (!session.state.slideSelection.includes(id)) session.selectSlides([id]);
          const chosen = new Set(session.state.slideSelection);
          ids = session.state.deck.slides.map((slide) => slide.id).filter((other) => chosen.has(other));
          // The thumbnails go in the hand; the one pressed is held where it was taken.
          const copy = (other: string) => hooks.current.frameOf?.(other) ?? null;
          const held = copy(id)?.getBoundingClientRect();
          grab.current = held && held.width > 0 ? { x: Math.min(Math.max(origin.x - held.left, 0), held.width), y: Math.min(Math.max(origin.y - held.top, 0), held.height) } : HELD_BY;
          const frames = ids.flatMap((other) => {
            const source = copy(other);
            if (!source) return [];
            const clone = source.cloneNode(true) as HTMLElement;
            const box = source.getBoundingClientRect();
            if (box.width > 0) {
              clone.style.width = `${box.width}px`;
              clone.style.height = `${box.height}px`;
            }
            return [clone];
          });
          frame = requestAnimationFrame(scroll);
          copying = copies(move);
          setDrag({ ids, spot: null, frames, copy: copying });
        }
        place();
        refresh();
      }

      function onUp(up: PointerEvent) {
        const moving = ids;
        pointer.current = { x: up.clientX, y: up.clientY };
        if (!moving) return finish();
        const target = where.current(up.clientX, up.clientY);
        // Alt, Ctrl or Cmd held as they are put down: the slides stay, and copies of them land there, in one step.
        const copy = target !== null && copies(up);
        const plan =
          target && !copy
            ? planMove(
                session.state.deck.slides.map((slide) => slide.id),
                moving,
                target.gap,
              )
            : null;
        finish({ moved: plan?.changed ?? false });
        // The click that follows a press and a release is not a click on a slide.
        swallow.current = true;
        quiet.current = window.setTimeout(() => (swallow.current = false), 0);
        if (plan?.changed) session.slides.move(plan.ids, plan.to);
        if (copy && target) {
          const clip = session.slideClipboard.copy(moving, { remember: false });
          if (clip) session.slideClipboard.paste(clip, { gap: target.gap });
        }
      }

      function onCancel() {
        finish({ moved: false });
      }

      function onKey(key: KeyboardEvent) {
        if (key.key !== "Escape") return;
        key.preventDefault();
        key.stopPropagation();
        finish({ moved: false });
      }

      end.current = () => finish();
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("keydown", onKey, true);
    },
    [session, scroller, place],
  );

  const swallowClick = useCallback(() => {
    const was = swallow.current;
    swallow.current = false;
    return was;
  }, []);

  return { drag, begin, swallowClick, badge };
}
