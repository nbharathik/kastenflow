// While a handle is dragged the pointer is no longer over it (the box moves under the pointer), and the page, which holds the
// pointer, would show its own cursor: an arrow in the middle of a resize. The page takes the handle's cursor for the length of
// the drag and gives back what it had.

import { type RefObject, useMemo, useRef } from "react";

const GRIPS = "[data-handle], [data-rotate], [data-end]";

export interface GripCursor {
  /** A press: if it is on a handle, the page shows that handle's cursor until `give`. */
  take(target: EventTarget | null): void;
  /** The drag is over. */
  give(): void;
}

export function useGripCursor(page: RefObject<HTMLElement | null>): GripCursor {
  const kept = useRef<string | null>(null);
  return useMemo<GripCursor>(
    () => ({
      take(target) {
        const element = page.current;
        const grip = target instanceof Element ? target.closest<HTMLElement>(GRIPS) : null;
        if (!element || !grip) return;
        kept.current ??= element.style.cursor;
        element.style.cursor = getComputedStyle(grip).cursor;
      },
      give() {
        const element = page.current;
        if (element && kept.current !== null) element.style.cursor = kept.current;
        kept.current = null;
      },
    }),
    [page],
  );
}
