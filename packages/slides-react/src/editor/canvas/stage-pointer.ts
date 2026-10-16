// What the pointer does on the grey round the slide: a press there takes the selection off, ends the text being written, and (for a drag)
// begins a selection rectangle, whose corner may be off the slide. The pointer is the stage's from the press to the release.

import { type MutableRefObject, type PointerEvent, type RefObject, useRef } from "react";

import type { EditorSession } from "../session/session.ts";
import type { CanvasController, PointerInfo } from "./controller.ts";
import type { useEdgeScroll } from "./edge-scroll.ts";
import { clearSelection } from "./outside.ts";
import type { usePan } from "./pan.ts";
import type { useStageZoom } from "./stage-zoom.ts";

/** The keys and place of a pointer event, as the gesture reads them. */
export interface Keys {
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  button: number;
  detail: number;
}

export const keysOf = (event: Keys): Keys => ({ shiftKey: event.shiftKey, altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, button: event.button, detail: event.detail });

interface Deps {
  session: EditorSession;
  controller: CanvasController;
  stage: RefObject<HTMLDivElement | null>;
  pan: ReturnType<typeof usePan>;
  glide: ReturnType<typeof useStageZoom>;
  edge: ReturnType<typeof useEdgeScroll>;
  /** The last keys held, for the steps of a drag that goes on without the pointer moving. */
  held: MutableRefObject<Keys>;
  toInfo(event: PointerEvent<HTMLDivElement>): PointerInfo;
}

/** The pointer handlers of the stage itself (not of the slide on it, which has its own). */
export function useStagePointer({ session, controller, stage, pan, glide, edge, held, toInfo }: Deps) {
  // A selection rectangle that began on the grey stage: its pointer is the stage's, not the slide's.
  const fromStage = useRef(false);
  return {
    onPointerDown(event: PointerEvent<HTMLDivElement>): void {
      if (pan.wants(event)) return pan.press(event);
      // A press on the grey round the slide (not on the slide itself, which has its own) clears what is selected, ends the text
      // being written, and leaves the keys with the stage.
      if (event.target instanceof Element && event.target.closest(".ks-page")) return;
      // A press on the stage's own scroll bar is the scroll bar's.
      const room = stage.current;
      const at = room?.getBoundingClientRect();
      if (room && at && ((room.clientWidth > 0 && event.clientX - at.left >= room.clientWidth) || (room.clientHeight > 0 && event.clientY - at.top >= room.clientHeight))) return;
      glide.settle();
      stage.current?.focus({ preventScroll: true });
      clearSelection(session, event);
      // A drag from the grey draws a selection rectangle, as one from empty space on the slide does (its corner may be off the slide).
      held.current = keysOf(event);
      if (controller.stageDown(toInfo(event))) {
        fromStage.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
      }
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>): void {
      void pan.move(event);
      if (!fromStage.current || !controller.busy) return;
      held.current = keysOf(event);
      controller.move(toInfo(event));
      edge.follow(event.clientX, event.clientY);
    },
    onPointerUp(event: PointerEvent<HTMLDivElement>): void {
      void pan.release(event);
      if (!fromStage.current) return;
      fromStage.current = false;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      edge.stop();
      controller.up(toInfo(event));
    },
    onPointerCancel(): void {
      if (!fromStage.current) return;
      fromStage.current = false;
      controller.cancel();
    },
  };
}
