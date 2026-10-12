// Zooming the slide: a wheel or a pinch zooms continuously about the pointer, and any other zoom (the menu, a key, Fit, 100%)
// glides there, keeping the place the person is looking at where it is. The slide is laid out at the new size at once (one
// drawing) and the browser moves it from the old size to the new one with a transform, so no step of the glide draws anything.

import { wheelZoomFactor } from "@kasten-slides/canvas";
import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";

import { EASE, motionOn, slowMs } from "../motion.ts";
import type { EditorUi } from "../ui-state.ts";

interface Look {
  /** Where the page was in the window, and how big it was drawn. */
  rect: DOMRect;
  zoom: number;
  /** What was asked for: "fit", or a number. A change of this is the person zooming; a change of "fit" alone is the window being resized. */
  request: "fit" | number;
}

/** The size a wheel notch or a pinch step means: a pinch arrives in small steps, a notch in about a hundred. */
export function wheelFactor(deltaY: number, deltaMode: number): number {
  const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1;
  const delta = deltaY * unit;
  return wheelZoomFactor(delta, Math.abs(delta) < 50);
}

/**
 * How far the stage must scroll for the slide point that was under `about` to stay there: where the page's top left is now,
 * less where it must be so that `slide` (in slide units) lands on `about` at the new `zoom`.
 */
export function scrollFor(now: { left: number; top: number }, about: { x: number; y: number }, slide: { x: number; y: number }, zoom: number): { dx: number; dy: number } {
  return { dx: now.left - (about.x - slide.x * zoom), dy: now.top - (about.y - slide.y * zoom) };
}

interface Options {
  stage: RefObject<HTMLElement | null>;
  page: RefObject<HTMLElement | null>;
  ui: EditorUi;
  /** The zoom the slide is drawn at, and what was asked for. */
  zoom: number;
  request: "fit" | number;
  /** The stage's size, for the places the page sits in when the window changes. */
  room: { w: number; h: number };
}

/** What a canvas can ask of its zoom motion. */
export interface StageZoom {
  /** Ends a glide that is under way, at once, with the slide where it is going: a press that comes mid-glide takes it where it will be. */
  settle(): void;
}

export function useStageZoom({ stage, page, ui, zoom, request, room }: Options): StageZoom {
  // A wheel with Ctrl, or a pinch, zooms about the pointer. The listener is not passive: the browser's own zoom must not follow.
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      ui.zoomBy(wheelFactor(event.deltaY, event.deltaMode), { x: event.clientX, y: event.clientY });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [stage, ui]);

  const last = useRef<Look | null>(null);
  const running = useRef<Animation | null>(null);
  const settle = useRef<StageZoom>({
    settle() {
      running.current?.finish();
      running.current = null;
    },
  });
  useLayoutEffect(() => {
    const el = page.current;
    const area = stage.current;
    if (!el || !area) return;
    running.current?.cancel();
    running.current = null;
    const rect = el.getBoundingClientRect();
    const before = last.current;
    last.current = { rect, zoom, request };
    // The first drawing, and a "fit" that follows the window, have nothing to glide from.
    if (!before || before.request === request) return;
    const how = ui.takeZoomIntent();
    const space = area.getBoundingClientRect();
    const about = how.about ?? { x: space.left + space.width / 2, y: space.top + space.height / 2 };
    // The place on the slide that was under `about` stays under it (or goes to `to`, when it is carried): the stage scrolls by what the new size moved it.
    const slide = { x: (about.x - before.rect.left) / before.zoom, y: (about.y - before.rect.top) / before.zoom };
    const { dx, dy } = scrollFor(rect, how.to ?? about, slide, zoom);
    area.scrollLeft += dx;
    area.scrollTop += dy;
    const after = el.getBoundingClientRect();
    last.current = { rect: after, zoom, request };
    if (how.instant || !motionOn() || typeof el.animate !== "function") return;
    const scale = before.rect.width / after.width;
    const x = before.rect.left - after.left;
    const y = before.rect.top - after.top;
    // A page that has no size (not drawn yet, or no layout to measure) has nowhere to glide from.
    if (!Number.isFinite(scale) || scale <= 0) return;
    if (Math.abs(scale - 1) < 0.002 && Math.abs(x) < 1 && Math.abs(y) < 1) return;
    const duration = slowMs(el);
    if (duration <= 0) return;
    try {
      running.current = el.animate(
        [
          { transformOrigin: "0 0", transform: `translate(${x}px, ${y}px) scale(${scale})` },
          { transformOrigin: "0 0", transform: "translate(0px, 0px) scale(1)" },
        ],
        { duration, easing: EASE },
      );
    } catch {
      // A page that cannot be animated just shows its new size.
    }
  }, [zoom, request, room.w, room.h]);

  // Where the page is changes as the stage scrolls: what a zoom starts from must be where it is.
  useEffect(() => {
    const area = stage.current;
    const el = page.current;
    if (!area || !el) return;
    const follow = () => {
      if (last.current && running.current?.playState !== "running") last.current = { ...last.current, rect: el.getBoundingClientRect() };
    };
    area.addEventListener("scroll", follow, { passive: true });
    return () => area.removeEventListener("scroll", follow);
  }, [stage, page]);
  return settle.current;
}
