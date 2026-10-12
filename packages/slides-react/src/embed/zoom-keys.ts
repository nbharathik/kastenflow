// The keys and the wheel that zoom the page of an embed: Ctrl (or Cmd) with plus, minus and zero, and Ctrl with the wheel. What they
// mean is the same wherever an embed is zoomed (the editor, a presentation); where they apply is each place's own business.

export type ZoomWord = "in" | "out" | "fit";

interface KeyLike {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

/** What a key press asks of a page's zoom, or null when it asks nothing. Shift is let through: plus is a shifted key on most keyboards. */
export function zoomKeyOf(event: KeyLike): ZoomWord | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  if (event.key === "+" || event.key === "=" || event.code === "NumpadAdd") return "in";
  if (event.key === "-" || event.key === "_" || event.code === "NumpadSubtract") return "out";
  if (event.key === "0" || event.code === "Numpad0") return "fit";
  return null;
}

/** What a wheel turn asks, when Ctrl (or Cmd) is held: a turn away from the person zooms out, towards them in. */
export function zoomWheelOf(event: { ctrlKey: boolean; metaKey: boolean; deltaY: number }): ZoomWord | null {
  if (!(event.ctrlKey || event.metaKey) || event.deltaY === 0) return null;
  return event.deltaY < 0 ? "in" : "out";
}
