// Exits: what opens also fades out. `usePresence` keeps a surface mounted for
// its exit and marks it `data-state="closing"`, for the CSS to animate.
// Panels that their parents mount and unmount (dialogs, menus) cannot be
// held by the parent, so they leave a ghost instead: a copy of their DOM
// that fades out on its own and removes itself. Under `data-motion="off"`
// (or before the setting is read) nothing is kept and nothing is copied.

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

/** A reduced-motion exit is a fade this long (the fast token). */
const FADE_MS = 90;

/** How long a surface stays for its exit: `ms` while motion is on, a short
 * fade where the computer asks for less motion, and none when it is off. */
export function exitMs(ms: number): number {
  const root = document.documentElement.dataset;
  if (root.motion === "on") return ms;
  if (root.motion === "off" && root.motionReduced !== undefined) return Math.min(ms, FADE_MS);
  return 0;
}

/** Whether a surface is on show, and its `data-state`. It stays on show for
 * `ms` after `open` turns false, as "closing"; with motion off it goes at once. */
export function usePresence(open: boolean, ms: number): { present: boolean; state: "open" | "closing" } {
  const [kept, setKept] = useState(open);
  const wait = open ? 0 : exitMs(ms);
  useEffect(() => {
    if (open) {
      setKept(true);
      return;
    }
    if (!wait) {
      setKept(false);
      return;
    }
    const timer = setTimeout(() => setKept(false), wait);
    return () => clearTimeout(timer);
  }, [open, wait]);
  return { present: open || (kept && wait > 0), state: open ? "open" : "closing" };
}

/** Where a menu grows from: the anchor's side and its centre, so it opens
 * out of the button that opened it. */
export function originFor(anchor: Pick<DOMRect, "left" | "width" | "top">, box: Pick<DOMRect, "left" | "width" | "bottom">): string {
  const x = Math.max(0, Math.min(anchor.left + anchor.width / 2 - box.left, box.width));
  return `${Math.round(x)}px ${anchor.top >= box.bottom ? "bottom" : "top"}`;
}

/** A copy of `el`, left on the page to fade out as `el` goes. `pin` fixes it
 * where `el` was, for panels that sit inside another box. */
export function leaveGhost(el: HTMLElement, ms: number, pin: boolean): void {
  const wait = exitMs(ms);
  if (!wait || !el.isConnected) return;
  const rect = el.getBoundingClientRect();
  const z = getComputedStyle(el).zIndex;
  const ghost = el.cloneNode(true) as HTMLElement;
  // The copy must not be found, focused, clicked or announced.
  for (const node of [ghost, ...ghost.querySelectorAll<HTMLElement>("[id]")]) node.removeAttribute("id");
  ghost.setAttribute("aria-hidden", "true");
  ghost.setAttribute("inert", "");
  ghost.dataset.state = "closing";
  ghost.dataset.ghost = "";
  ghost.style.pointerEvents = "none";
  if (pin) {
    Object.assign(ghost.style, {
      position: "fixed",
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      right: "auto",
      bottom: "auto",
      margin: "0",
      zIndex: z === "auto" ? "80" : z,
    });
  }
  // React takes `el` out in the same commit; if it is still there a moment
  // later (a development double mount), nothing left and nothing is copied.
  queueMicrotask(() => {
    if (el.isConnected) return;
    document.body.append(ghost);
    setTimeout(() => ghost.remove(), wait + 40);
  });
}

/** Leaves a ghost of the element in `ref` when its component unmounts. */
export function useLeaveGhost(ref: RefObject<HTMLElement | null>, ms: number, pin: boolean): void {
  const latest = useRef({ ms, pin });
  latest.current = { ms, pin };
  useLayoutEffect(() => {
    const el = ref.current;
    return () => {
      if (el) leaveGhost(el, latest.current.ms, latest.current.pin);
    };
  }, [ref]);
}
