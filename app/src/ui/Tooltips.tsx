// Tooltips for the whole window: any control with a `title` shows it after
// a moment in the app's own style, with a shortcut at its end in brackets
// drawn as a keycap: "Zoom in (+)". One layer serves every control, so the
// words stay in each control's `title` (where screen readers find them
// too) and the browser's slow grey box never shows. Nothing inside the
// editor's text is touched: the editor owns that part of the page.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

import { usePresence } from "../lib/presence";

/** A tooltip fades out in this long (the fast step). */
const TIP_EXIT_MS = 90;

/** How long the pointer rests on a control before its tooltip shows. */
export const TIP_DELAY_MS = 400;
/** Moving on to the next control this soon shows its tooltip at once. */
const WARM_MS = 300;
const GAP = 6;
const EDGE = 8;

/** Brackets at the end of a title that hold keys rather than words. */
const KEYS = /^(?:\S{1,3}|.*(?:Ctrl|Shift|Alt|Cmd|Option|⌘|⌥|⇧|Esc|Enter|Tab|Space|scroll|\+).*)$/;

/** A title's words, and the shortcut in brackets it ends with, if any. */
export function splitTip(title: string): { text: string; keys?: string } {
  const found = /^(.*\S)\s+\(([^()]{1,32})\)$/.exec(title.trim());
  if (!found || !KEYS.test(found[2]!)) return { text: title.trim() };
  return { text: found[1]!, keys: found[2]! };
}

interface Tip {
  text: string;
  keys?: string;
  at: DOMRect;
}

/** Below the control, centred, or above it near the window's bottom. */
function placeTip(at: DOMRect, size: DOMRect): CSSProperties {
  const left = Math.max(EDGE, Math.min(at.left + at.width / 2 - size.width / 2, window.innerWidth - EDGE - size.width));
  const below = at.bottom + GAP;
  const top = below + size.height > window.innerHeight - EDGE ? at.top - GAP - size.height : below;
  return { left, top };
}

/** The control a pointer or focus is on, if it has a tooltip to show. */
function tipped(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest<HTMLElement>("[title], [data-tip-title]");
  if (!el || el.closest(".ProseMirror, [contenteditable='true'], .kasten-tip")) return null;
  return el;
}

export function Tooltips() {
  const [tip, setTip] = useState<Tip | null>(null);
  const [style, setStyle] = useState<CSSProperties | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let target: HTMLElement | null = null;
    let shown = false;
    let lastShown = -Infinity;

    const hide = () => {
      clearTimeout(timer);
      if (target) {
        const title = target.dataset.tipTitle;
        // The control keeps a title the app gave it meanwhile.
        if (title !== undefined && !target.hasAttribute("title")) target.setAttribute("title", title);
        delete target.dataset.tipTitle;
      }
      if (shown) lastShown = performance.now();
      target = null;
      shown = false;
      setTip(null);
      setStyle(null);
    };
    const show = (el: HTMLElement) => {
      const title = el.getAttribute("title");
      if (!title?.trim() || !el.isConnected) return;
      // Taken off while the tooltip shows, so the browser's own stays away.
      el.dataset.tipTitle = title;
      el.removeAttribute("title");
      shown = true;
      setTip({ ...splitTip(title), at: el.getBoundingClientRect() });
    };
    const start = (el: HTMLElement) => {
      if (el === target) return;
      hide();
      target = el;
      timer = setTimeout(() => show(el), performance.now() - lastShown < WARM_MS ? 0 : TIP_DELAY_MS);
    };

    const onOver = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const el = tipped(event.target);
      if (el) start(el);
      else if (target) hide();
    };
    const onOut = (event: PointerEvent) => {
      if (target && !(event.relatedTarget instanceof Node && target.contains(event.relatedTarget))) hide();
    };
    const onFocus = (event: FocusEvent) => {
      const el = tipped(event.target);
      if (el && event.target instanceof Element && event.target.matches(":focus-visible")) start(el);
    };
    const onLeave = () => target && hide();

    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerout", onOut);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", onLeave);
    document.addEventListener("pointerdown", onLeave, true);
    document.addEventListener("keydown", onLeave, true);
    document.addEventListener("scroll", onLeave, true);
    window.addEventListener("blur", onLeave);
    return () => {
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerout", onOut);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", onLeave);
      document.removeEventListener("pointerdown", onLeave, true);
      document.removeEventListener("keydown", onLeave, true);
      document.removeEventListener("scroll", onLeave, true);
      window.removeEventListener("blur", onLeave);
      hide();
    };
  }, []);

  // Measured once drawn, then placed before the first paint.
  useLayoutEffect(() => {
    if (tip && box.current) setStyle(placeTip(tip.at, box.current.getBoundingClientRect()));
  }, [tip]);

  // The last tooltip stays, fading, for a moment after it is hidden.
  const { present, state } = usePresence(Boolean(tip), TIP_EXIT_MS);
  const last = useRef<{ tip: Tip; style: CSSProperties } | null>(null);
  if (tip && style) last.current = { tip, style };
  const view = tip ? { tip, style } : last.current;
  if (!present || !view) return null;
  return createPortal(
    <div ref={box} role="tooltip" data-state={state} className="kasten-tip" style={view.style ?? { left: 0, top: 0, visibility: "hidden" }}>
      <span>{view.tip.text}</span>
      {view.tip.keys && <kbd>{view.tip.keys}</kbd>}
    </div>,
    document.body,
  );
}
