// How wide the chat dock is, and whether the window has room for it beside
// the panes. The width is the person's, kept in the browser's storage like
// the side stack's; what is stored is checked, since anything may be there.

export const DOCK_WIDTH = { initial: 420, min: 320, max: 720 } as const;
/** The least room the panes keep beside a docked chat. */
export const PANE_MIN = 480;
export const WIDTH_KEY = "kasten.chat.dockWidth";

/** A width within the dock's limits, and within what the window leaves the
 * panes when it can: `space` is the room the dock and the panes share. The
 * narrowest dock is the least it gets, however narrow the window. */
export function clampWidth(width: number, space = Number.POSITIVE_INFINITY, paneMin = PANE_MIN): number {
  const most = Math.min(DOCK_WIDTH.max, Math.max(DOCK_WIDTH.min, space - paneMin));
  return Math.round(Math.max(DOCK_WIDTH.min, Math.min(most, width)));
}

/** The width kept, or the usual one when none is kept or the stored value is not a width. */
export function loadWidth(): number {
  try {
    const saved = localStorage.getItem(WIDTH_KEY);
    if (saved === null || !/^\d{1,4}$/.test(saved)) return DOCK_WIDTH.initial;
    const width = Number(saved);
    return width >= DOCK_WIDTH.min && width <= DOCK_WIDTH.max ? width : DOCK_WIDTH.initial;
  } catch {
    return DOCK_WIDTH.initial;
  }
}

export function keepWidth(width: number): void {
  try {
    localStorage.setItem(WIDTH_KEY, String(Math.round(width)));
  } catch {
    // The width is a convenience.
  }
}

export type DockLayout = "docked" | "expanded";

/** "docked" while the panes keep `paneMin` pixels beside a dock `width` wide
 * in `space` pixels; else "expanded", where the dock takes the whole area. */
export function dockLayout(space: number, width: number, paneMin = PANE_MIN): DockLayout {
  return space - width >= paneMin ? "docked" : "expanded";
}
