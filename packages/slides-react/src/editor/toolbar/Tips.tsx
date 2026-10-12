// Tooltips for the toolbar. The kit draws a tooltip with CSS below any control
// that has `data-tip`, but the toolbar clips whatever pokes out of its box
// (it does not scroll: what does not fit goes into the more menu), tooltips
// included. These are drawn with `position: fixed`, which the box does not
// clip, and are kept inside the window. They come after 400 ms, and the next
// one almost at once while the pointer moves along the row.

import { type FocusEvent, type JSX, type MouseEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

interface Tip {
  text: string;
  /** Where the tooltip is centred, and where its top edge is, in the window. */
  x: number;
  y: number;
}

const FIRST_DELAY = 400;
const NEXT_DELAY = 60;

/** Whether the focus got to `element` by the keyboard, which is when a tooltip is wanted without a pointer over it. */
function focusedByKeyboard(element: Element): boolean {
  try {
    return element.matches(":focus-visible");
  } catch {
    // A browser that does not know :focus-visible.
    return false;
  }
}

/** The handlers to put on the toolbar, and the tooltip to draw inside it. */
export function useTips() {
  const [tip, setTip] = useState<Tip | null>(null);
  const timer = useRef(0);
  const showing = useRef(false);

  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    showing.current = false;
    setTip(null);
  }, []);

  const show = useCallback((target: Element, delay: number) => {
    window.clearTimeout(timer.current);
    const text = target.getAttribute("data-tip");
    if (!text) return;
    timer.current = window.setTimeout(() => {
      const box = target.getBoundingClientRect();
      showing.current = true;
      setTip({ text, x: box.left + box.width / 2, y: box.bottom + 6 });
    }, delay);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const handlers = {
    onMouseOver(event: MouseEvent) {
      const target = event.target instanceof Element ? event.target.closest("[data-tip]") : null;
      if (target) show(target, showing.current ? NEXT_DELAY : FIRST_DELAY);
      else hide();
    },
    onMouseLeave: hide,
    onMouseDown: hide,
    onKeyDown: hide,
    onBlur: hide,
    onFocus(event: FocusEvent) {
      const target = event.target;
      if (target instanceof Element && target.hasAttribute("data-tip") && focusedByKeyboard(target)) show(target, 0);
    },
  };
  return { tip, handlers };
}

/** A tooltip, kept inside the window. */
export function TipView({ tip }: { tip: Tip }): JSX.Element {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const width = element.offsetWidth;
    element.style.left = `${Math.min(Math.max(tip.x - width / 2, 4), Math.max(4, window.innerWidth - width - 4))}px`;
  });
  return (
    <div ref={box} className="ks-tb-tip" role="tooltip" style={{ left: tip.x, top: tip.y }}>
      {tip.text}
    </div>
  );
}
