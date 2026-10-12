import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

import "./menu.css";

export interface Anchor {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface PopoverProps {
  /** Where it opens from: the trigger's rectangle in the window. */
  anchor: Anchor;
  onClose(): void;
  children: ReactNode;
  className?: string;
  /** Open to the side of the anchor instead of below it (a submenu). */
  side?: boolean;
  /** Keep focus where it is (a toolbar menu over a text editor). */
  keepFocus?: boolean;
  label?: string;
}

/**
 * A floating panel next to something. It stays inside the window, closes on
 * Escape and on a press outside, and is drawn fixed so no container clips it.
 */
export function Popover({ anchor, onClose, children, className = "", side, keepFocus, label }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number; origin: string; up: boolean } | null>(null);

  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const gap = 4;
    const room = { w: window.innerWidth, h: window.innerHeight };
    let left = side ? anchor.right : anchor.left;
    let top = side ? anchor.top : anchor.bottom + gap;
    let flippedLeft = false;
    let up = false;
    if (left + box.width > room.w - gap) {
      left = side ? anchor.left - box.width : room.w - box.width - gap;
      flippedLeft = side || left < anchor.left;
    }
    if (top + box.height > room.h - gap) {
      top = side ? room.h - box.height - gap : Math.max(gap, anchor.top - box.height - gap);
      up = !side;
    }
    const placed = { left: Math.max(gap, left), top: Math.max(gap, top) };
    // The popover grows out of the corner nearest the thing that opened it.
    setAt({ ...placed, origin: `${flippedLeft ? "right" : "left"} ${up ? "bottom" : "top"}`, up });
  }, [anchor, side]);

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target)) onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape, true);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className={`ks-popover ${className}`}
      role="dialog"
      aria-label={label}
      // Until it is measured it is see-through, not hidden: a hidden element cannot take the focus a menu asks for.
      data-placement={at?.up ? "top" : undefined}
      style={{ left: at?.left ?? anchor.left, top: at?.top ?? anchor.bottom, ...(at ? { "--ks-origin": at.origin } : { opacity: 0, pointerEvents: "none" }) } as CSSProperties}
      onMouseDown={keepFocus ? (event) => event.preventDefault() : undefined}
      {...(keepFocus ? { "data-ks-keep-focus": "" } : {})}
    >
      {children}
    </div>
  );
}

/** The rectangle of an element, for a popover to open from. */
export function anchorOf(element: Element): Anchor {
  const { left, top, right, bottom } = element.getBoundingClientRect();
  return { left, top, right, bottom };
}

/** A point, for a menu opened by a right click. */
export function pointAnchor(x: number, y: number): Anchor {
  return { left: x, top: y, right: x, bottom: y };
}

/** Opens a popover from a button: the state and the handlers for it. */
export function usePopover() {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  return {
    anchor,
    openFrom: (element: Element) => setAnchor(anchorOf(element)),
    toggleFrom: (element: Element) => setAnchor((now) => (now ? null : anchorOf(element))),
    close: () => setAnchor(null),
  };
}
