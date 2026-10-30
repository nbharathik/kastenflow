// A small panel beside a cell or header: its menus and pickers. It sits on
// the page's body, so the table's scrolling never clips it, follows its
// anchor as the table scrolls, and closes on a click elsewhere.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import { useLeaveGhost } from "../../../../lib/presence";
import { useOccludesElement } from "../../../browser/occlusion";
import { useLatest } from "./context";

interface FloatingProps {
  anchor: RefObject<HTMLElement | null>;
  label: string;
  /** A click outside the panel and its anchor. */
  onClose(): void;
  children: ReactNode;
  className?: string;
  role?: "dialog" | "menu";
  /** Its least width; it is at least as wide as the anchor otherwise. */
  minWidth?: number;
}

const GAP = 4;
const MARGIN = 8;

interface Place {
  left: number;
  top: number;
  minWidth: number;
}

/** Below the anchor, or above it when the window has no room below; kept inside the window. */
function placeBy(box: DOMRect, own: DOMRect | undefined, minWidth: number): Place {
  const width = Math.max(own?.width ?? 0, box.width, minWidth);
  const height = own?.height ?? 0;
  const below = box.bottom + GAP;
  const top = below + height > window.innerHeight - MARGIN && box.top - GAP - height > MARGIN ? box.top - GAP - height : below;
  const left = Math.max(MARGIN, Math.min(box.left, window.innerWidth - width - MARGIN));
  return { left, top, minWidth: Math.max(box.width, minWidth) };
}

const samePlace = (a: Place, b: Place) => a.left === b.left && a.top === b.top && a.minWidth === b.minWidth;

export function Floating({ anchor, label, onClose, children, className = "", role = "dialog", minWidth = 220 }: FloatingProps) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useLatest(onClose);
  // A browser tab's page beside the table steps aside while the panel is open (the menus and pickers of the table all sit in this panel).
  useOccludesElement(panel);
  // It fades out as its parent takes it away.
  useLeaveGhost(panel, 90, true);
  // Placed from the first render: a hidden panel could not take focus.
  const [place, setPlace] = useState<Place | null>(() => {
    const box = anchor.current?.getBoundingClientRect();
    return box ? placeBy(box, undefined, minWidth) : null;
  });

  useLayoutEffect(() => {
    let frame = 0;
    const measure = () => {
      const box = anchor.current?.getBoundingClientRect();
      if (!box) return;
      const next = placeBy(box, panel.current?.getBoundingClientRect(), minWidth);
      setPlace((p) => (p && samePlace(p, next) ? p : next));
    };
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", later, true);
    window.addEventListener("resize", later);
    // Its own size changes too, as a search narrows its list.
    const resized = new ResizeObserver(later);
    if (panel.current) resized.observe(panel.current);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", later, true);
      window.removeEventListener("resize", later);
      resized.disconnect();
    };
  }, [anchor, minWidth]);

  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panel.current?.contains(target) || anchor.current?.contains(target)) return;
      close.current();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [anchor, close]);

  return createPortal(
    <div
      ref={panel}
      role={role}
      aria-label={label}
      className={`kasten-table-pop ${className}`}
      style={place ? { left: place.left, top: place.top, minWidth: place.minWidth } : { left: MARGIN, top: MARGIN }}
      // A click on the panel itself (its padding, a heading) keeps the keys
      // where they were, so Escape and the arrows still work.
      onMouseDown={(e) => {
        if (!(e.target as Element).closest("input, textarea, button, a")) e.preventDefault();
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
