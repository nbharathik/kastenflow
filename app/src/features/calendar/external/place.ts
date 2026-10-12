// Where an event's popover goes: under its chip, or over it when the window
// has no room below, and kept inside the window. Pure, so it is tested.

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Place {
  left: number;
  top: number;
}

/** Room kept between the popover and its chip, and the window's edges. */
const GAP = 6;
const MARGIN = 8;

export function placePopover(anchor: Box, size: { width: number; height: number }, view: { width: number; height: number }): Place {
  const below = anchor.top + anchor.height + GAP;
  const above = anchor.top - GAP - size.height;
  let top = below;
  if (below + size.height > view.height - MARGIN) top = above >= MARGIN ? above : Math.max(MARGIN, view.height - MARGIN - size.height);
  const left = Math.max(MARGIN, Math.min(anchor.left, view.width - MARGIN - size.width));
  return { left, top };
}
