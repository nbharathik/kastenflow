// The presenter's keys, shared by every presenter (a whiteboard's sections, a
// page's sections) so that the same keys do the same thing everywhere:
// arrows, Space, the Page keys, N and P go on and back, Home and End jump,
// Esc ends. Pure: no DOM, so a presenter reads its own events through it.

/** Keys that go on to the next slide. */
export const NEXT = new Set(["ArrowRight", "ArrowDown", "PageDown", "Enter", " ", "n"]);
/** Keys that go back to the one before. */
export const PREVIOUS = new Set(["ArrowLeft", "ArrowUp", "PageUp", "Backspace", "p"]);

export type PresentAction = "next" | "previous" | "first" | "last" | "end";

/** What a presenter reads of a key press: both the DOM's and React's events fit. */
export interface PresentKey {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
  target?: EventTarget | null;
}

/** What the key does while presenting, or null when it is not a presenter's key.
 * Chords (Ctrl, Cmd, Alt) and text being composed belong to the app. Space and
 * Enter on a button press that button, and nothing more. */
export function presentAction(event: PresentKey): PresentAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return null;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if ((key === " " || key === "Enter") && event.target instanceof Element && event.target.closest("button")) return null;
  if (key === " " && event.shiftKey) return "previous";
  if (NEXT.has(key)) return "next";
  if (PREVIOUS.has(key)) return "previous";
  if (key === "Home") return "first";
  if (key === "End") return "last";
  if (key === "Escape") return "end";
  return null;
}
