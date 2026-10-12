// Presenting a board: the view flies to each slide and fits it
// to the screen. The board takes the window (present.css) and the screen
// where it may, keeps the slide fitted as the window changes, and reads
// the presenter's keys: arrows, Space, Page keys, N and P, Home and End
// (lib/present-keys, which a page presenting its sections reads too).

import { useReactFlow } from "@xyflow/react";
import { useEffect, type KeyboardEvent, type MouseEvent, type RefObject } from "react";

import { fillScreen } from "../../../../lib/fullscreen";
import { motionMs } from "../../../../lib/motion";
import { presentAction } from "../../../../lib/present-keys";
import { useBoardState } from "../context";
import { shownRect } from "../model/geometry";
import { fitRect, slides } from "../model/slides";
import type { BoardController } from "../state/controller";
import { goTo, step, stopPresenting } from "../state/present";

/** How long the view takes to fly from one slide to the next. */
const FLY = 520;
/** Room around a slide, as a share of it: clear of the controls. */
const MARGIN = 0.08;
/** The controls, which a click on the slide does not go through. */
const CONTROLS = ".kasten-present, .kasten-zoombar, .kasten-board-menu, [role='dialog']";

export function usePresentation(board: BoardController, wrapper: RefObject<HTMLDivElement | null>) {
  const flow = useReactFlow();
  const presenting = useBoardState((s) => s.presenting);
  // How many slides there are now; only counted while presenting.
  const count = useBoardState((s) => (s.presenting === null ? 0 : slides(s.doc.nodes).length));
  const on = presenting !== null;

  // The view that shows slide `at` whole, in the board's size now.
  const show = (at: number, duration: number) => {
    const el = wrapper.current;
    const slide = slides(board.doc.nodes)[at];
    if (!el || !slide) return;
    void flow.setViewport(fitRect(shownRect(slide), el.offsetWidth, el.offsetHeight, MARGIN), { duration });
  };

  // The screen while presenting, the slide kept fitted to it, and the view
  // from before given back at the end.
  useEffect(() => {
    if (!on) return;
    const before = flow.getViewport();
    const el = wrapper.current;
    el?.focus({ preventScroll: true });
    let over = false;
    let giveBack: (() => void) | null = null;
    void fillScreen(() => stopPresenting(board)).then((back) => (over ? back() : (giveBack = back)));
    let size = el ? `${el.offsetWidth}×${el.offsetHeight}` : "";
    const resized = new ResizeObserver(() => {
      const now = el ? `${el.offsetWidth}×${el.offsetHeight}` : "";
      const at = board.store.getState().presenting;
      if (now === size || at === null) return;
      size = now;
      show(at, 0);
    });
    if (el) resized.observe(el);
    return () => {
      over = true;
      giveBack?.();
      resized.disconnect();
      void flow.setViewport(before, { duration: motionMs(FLY) });
    };
    // `show` reads the board and the view as they are when it runs.
  }, [on, board, wrapper]);

  useEffect(() => {
    if (presenting !== null) show(presenting, motionMs(FLY));
  }, [presenting, board]);

  // The board changed under the talk (an edit from outside): stay within
  // the slides there are, and end when there are none.
  useEffect(() => {
    if (presenting === null) return;
    if (count === 0) stopPresenting(board);
    else if (presenting >= count) goTo(board, count - 1);
  }, [presenting, count, board]);

  /** The presenter's keys; true when the key was one. */
  const onKey = (event: KeyboardEvent): boolean => {
    if (!on) return false;
    // The keys are the page presenter's too (lib/present-keys).
    const action = presentAction({ key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing, target: event.target });
    if (action === "previous") step(board, -1);
    else if (action === "next") step(board, 1);
    else if (action === "first") goTo(board, 0);
    else if (action === "last") goTo(board, Number.MAX_SAFE_INTEGER);
    else if (action === "end") stopPresenting(board);
    else return false;
    event.preventDefault();
    event.stopPropagation();
    return true;
  };

  /** A click on the slide goes on to the next one. */
  const onClick = (event: MouseEvent) => {
    if (on && event.button === 0 && !(event.target as HTMLElement).closest(CONTROLS)) step(board, event.shiftKey ? -1 : 1);
  };

  return { on, onKey, onClick };
}
