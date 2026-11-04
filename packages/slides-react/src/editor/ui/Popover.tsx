import { type CSSProperties, type ReactNode, createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { editorOf, focusedNow, giveFocusBack, lastEditorRoot } from "../focus/home.ts";
import { holdCover } from "./covers.ts";
import { popoverLayer, wearLookOf } from "./popover-layer.ts";
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
  /** Moving the focus into it does not end the editing of a text box (a menu's keys and clicks are not typing elsewhere). */
  keepEditing?: boolean;
  label?: string;
  /** What it is for assistive technology: a panel to work in (`dialog`, the default), or nothing of its own because a menu inside it speaks for it (`none`). */
  role?: "dialog" | "none";
}

/** One open popover: its box, and the popover it was opened from (a submenu has its menu). */
interface Open {
  box: HTMLElement | null;
  parent: Open | null;
  editor: HTMLElement | null;
}

/** The popovers that are open, the innermost last: Escape closes that one alone. */
const stack: Open[] = [];
/** The popover whose children are being drawn. */
const Parent = createContext<Open | null>(null);

/** Whether `node` is in `one`, or in a popover opened from it (a press in a submenu is not a press outside its menu). */
function isInside(one: Open, node: Node): boolean {
  return stack.some((other) => {
    if (!other.box?.contains(node)) return false;
    for (let at: Open | null = other; at; at = at.parent) if (at === one) return true;
    return false;
  });
}

/** The box a marker stands for: the popover is drawn elsewhere (see `popoverWithin`). */
const boxes = new WeakMap<Element, HTMLElement>();
const MARK = "data-ks-pop-mark";

/** The popover opened from something inside `root`, for the code that gives it the focus; null when there is none. */
export function popoverWithin(root: Element | null): HTMLElement | null {
  const mark = root?.querySelector(`[${MARK}]`);
  return (mark && boxes.get(mark)) || null;
}

const GAP = 4;

/** Where a box of this size goes: next to its anchor, kept inside the window, and the corner it grows from. */
function placeFor(anchor: Anchor, side: boolean | undefined, width: number, height: number) {
  const room = { w: window.innerWidth, h: window.innerHeight };
  let left = side ? anchor.right : anchor.left;
  let top = side ? anchor.top : anchor.bottom + GAP;
  let flippedLeft = false;
  let up = false;
  if (left + width > room.w - GAP) {
    left = side ? anchor.left - width : room.w - width - GAP;
    flippedLeft = side || left < anchor.left;
  }
  if (top + height > room.h - GAP) {
    top = side ? room.h - height - GAP : Math.max(GAP, anchor.top - height - GAP);
    up = !side;
  }
  // The popover grows out of the corner nearest the thing that opened it.
  return { left: Math.max(GAP, left), top: Math.max(GAP, top), origin: `${flippedLeft ? "right" : "left"} ${up ? "bottom" : "top"}`, up };
}

type Placed = ReturnType<typeof placeFor>;
const same = (a: Placed | null, b: Placed): boolean => a !== null && a.left === b.left && a.top === b.top && a.origin === b.origin && a.up === b.up;

/**
 * A floating panel next to something. It is drawn in a layer of its own on the page (so no container clips it or moves it), wearing the
 * look of the place it opened from. It stays inside the window, is placed again when its content changes size, closes on Escape (the
 * innermost one first) and on a press outside it and the popovers opened from it.
 */
export function Popover({ anchor, onClose, children, className = "", side, keepFocus, keepEditing, label, role = "dialog" }: PopoverProps) {
  const mark = useRef<HTMLSpanElement>(null);
  const scope = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const parent = useContext(Parent);
  const [at, setAt] = useState<Placed | null>(null);
  const entry = useRef<Open>({ box: null, parent, editor: null });

  // Before it is shown: it takes the look of where it was opened from, and is told apart from the popovers it was opened from.
  useLayoutEffect(() => {
    const open = entry.current;
    open.box = ref.current;
    open.editor = parent?.editor ?? editorOf(mark.current);
    if (mark.current && ref.current) boxes.set(mark.current, ref.current);
    if (scope.current) wearLookOf(scope.current, mark.current?.parentElement ?? null);
    stack.push(open);
    return () => {
      const at = stack.indexOf(open);
      if (at >= 0) stack.splice(at, 1);
    };
  }, [parent]);

  // Measured before it is drawn, and again whenever it changes size (a row that arrives late) or the window does.
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const place = () => {
      const next = placeFor(anchor, side, box.offsetWidth, box.offsetHeight);
      setAt((now) => (same(now, next) ? now : next));
    };
    place();
    const watcher = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    watcher?.observe(box);
    window.addEventListener("resize", place);
    return () => {
      watcher?.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [anchor, side]);

  // The focus goes back to where it was when the popover goes (its own opener may be gone by then), else to the editor's home, unless
  // something else has taken it on purpose. Without this a closed menu drops the keys on the page.
  useEffect(() => {
    const before = focusedNow();
    const editor = entry.current.editor ?? lastEditorRoot();
    // A web view the host draws natively would cover the popover: it steps aside while this is open.
    const release = holdCover();
    return () => {
      release();
      giveFocusBack(before, editor);
    };
  }, []);

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !isInside(entry.current, event.target)) onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || stack[stack.length - 1] !== entry.current) return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape, true);
    };
  }, [onClose]);

  return (
    <>
      <span ref={mark} hidden aria-hidden="true" {...{ [MARK]: "" }} />
      {createPortal(
        <div ref={scope} className="ks-popover-scope">
          <div
            ref={ref}
            className={`ks-popover ${className}`}
            role={role}
            aria-label={role === "dialog" ? label : undefined}
            // Until it is measured it is see-through, not hidden: a hidden element cannot take the focus a menu asks for.
            data-placement={at?.up ? "top" : undefined}
            style={{ left: at?.left ?? anchor.left, top: at?.top ?? anchor.bottom, ...(at ? { "--ks-origin": at.origin } : { opacity: 0, pointerEvents: "none" }) } as CSSProperties}
            onMouseDown={keepFocus ? (event) => event.preventDefault() : undefined}
            {...(keepFocus || keepEditing ? { "data-ks-keep-focus": "" } : {})}
          >
            <Parent value={entry.current}>{children}</Parent>
          </div>
        </div>,
        popoverLayer(),
      )}
    </>
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
