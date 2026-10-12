// What every small panel on the board shares: a press outside it closes it,
// and so does Escape, which stops there so the board keeps its selection.

import { useEffect, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";

/** Closes while `open` on a press outside `root`. */
export function useDismiss(open: boolean, root: RefObject<HTMLElement | null>, close: () => void): void {
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open, root, close]);
}

/** Escape in an open panel closes it, and the board does not hear it. */
export function closeOnEscape(open: boolean, close: () => void) {
  return (event: ReactKeyboardEvent) => {
    if (!open || event.key !== "Escape") return;
    event.stopPropagation();
    event.preventDefault();
    close();
  };
}

/** The arrows, Home and End move along a panel's buttons, round at the ends,
 * and no key of a panel's goes on to the board (an arrow would nudge what is
 * selected). */
export function moveAlong(event: ReactKeyboardEvent<HTMLElement>): void {
  const steps: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: -Infinity, End: Infinity };
  const step = steps[event.key];
  if (step === undefined) return;
  const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled)")];
  if (buttons.length === 0) return;
  event.preventDefault();
  event.stopPropagation();
  const at = buttons.indexOf(document.activeElement as HTMLElement);
  const from = at < 0 ? (step > 0 ? -1 : 0) : at;
  const next = Number.isFinite(step) ? (from + step + buttons.length) % buttons.length : step < 0 ? 0 : buttons.length - 1;
  buttons[next]?.focus({ preventScroll: true });
}

/** A ref for a panel that takes the focus when it opens, so the keys work in
 * it at once. */
export function focusFirst(panel: HTMLElement | null): void {
  panel?.querySelector<HTMLElement>("button:not(:disabled), input")?.focus({ preventScroll: true });
}

/** Hands the keys back to the board, as it was after a panel's choice. */
export function focusBoard(from: Element | null): void {
  from?.closest<HTMLElement>(".kasten-board")?.focus({ preventScroll: true });
}
