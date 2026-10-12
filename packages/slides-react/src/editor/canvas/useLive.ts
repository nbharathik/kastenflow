import { type RefObject, useEffect, useMemo } from "react";

import { LiveBoxes } from "../../render/live.ts";
import type { Placement } from "../session/elements.ts";
import { findElement } from "../session/scope.ts";
import type { EditorSession } from "../session/session.ts";
import type { CanvasController } from "./controller.ts";
import { followersOf } from "./follow.ts";
import { LiveLayer } from "./live.ts";
import { baseOf } from "./live-math.ts";

/**
 * Wires a gesture to the page: each step the controller shows is written to the page at once, in the event that made it, and
 * nothing is drawn by React for it (see `live.ts`). Answers the boxes the slide is drawn with for the elements that are
 * resized, which the slide's elements read.
 */
export function useLive(session: EditorSession, controller: CanvasController, page: RefObject<HTMLElement | null>, zoom: RefObject<number>): LiveBoxes {
  const boxes = useMemo(() => new LiveBoxes(), [session, controller]);
  const layer = useMemo(
    () =>
      new LiveLayer(
        {
          page: () => page.current,
          zoom: () => zoom.current ?? 1,
          find: (id) => {
            const element = findElement(session.slide.elements, id);
            const box = element ? session.elements.boxOf(element) : null;
            return element && box ? { base: baseOf(box, element), element } : null;
          },
          followers: (moved) => followersOf(session.slide, session.deck.theme, moved) as ReadonlyMap<string, Placement>,
        },
        boxes,
      ),
    [session, controller, boxes, page, zoom],
  );
  useEffect(() => {
    const stop = controller.subscribe(() => layer.apply(controller.preview));
    return () => {
      stop();
      layer.release();
    };
  }, [controller, layer]);
  return boxes;
}
