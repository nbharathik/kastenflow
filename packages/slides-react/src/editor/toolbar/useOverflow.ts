// Which groups of the toolbar do not fit. The widths of the groups are learned as they are drawn, so a group that is in the more menu is
// still known to need what it needed, and the row can take it back the moment there is room.

import { type RefObject, useLayoutEffect, useRef, useState } from "react";

import { chooseHidden } from "../chrome/overflow.ts";
import type { BarSlot } from "./slots.ts";

/** What the more button takes of the row. */
export const MORE_WIDTH = 32;

/** The room the bar keeps for its own padding. */
const PADDING = 16;

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => a.size === b.size && [...a].every((id) => b.has(id));

const NONE: ReadonlySet<string> = new Set();

/**
 * The ids of the groups that go into the more menu. `bar` is the whole row, `groups` the box the groups are drawn in and `pinned` what
 * stays at the right edge whatever the width. `width` is the bar's width (a change draws again), `look` anything else that changes how
 * wide a group is (the density).
 */
export function useOverflow(bar: RefObject<HTMLElement | null>, groups: RefObject<HTMLElement | null>, pinned: RefObject<HTMLElement | null>, slots: readonly BarSlot[], width: number, look: string): ReadonlySet<string> {
  const widths = useRef(new Map<string, number>());
  const lookOfWidths = useRef(look);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(NONE);
  const key = slots.map((slot) => `${slot.id}:${slot.drop}`).join(",");
  const hiddenKey = [...hidden].sort().join(",");

  useLayoutEffect(() => {
    const row = bar.current;
    const box = groups.current;
    // Without a layout (a test, a window not shown yet) there is nothing to measure, and everything stays in the bar.
    if (!row || !box || width === 0) return;
    // A different look makes every group a different width: what was learned is no good, and everything is drawn again to learn it.
    if (lookOfWidths.current !== look) {
      lookOfWidths.current = look;
      widths.current.clear();
      if (hidden.size > 0) return setHidden(NONE);
    }
    for (const node of box.querySelectorAll<HTMLElement>(":scope > [data-group]")) {
      const id = node.dataset.group;
      if (id) widths.current.set(id, node.offsetWidth);
    }
    const available = row.clientWidth - PADDING - (pinned.current?.offsetWidth ?? 0);
    const next = chooseHidden(
      slots.map((slot) => ({ id: slot.id, drop: slot.drop, width: widths.current.get(slot.id) ?? 0 })),
      available,
      MORE_WIDTH,
    );
    setHidden((now) => (sameSet(now, next) ? now : next));
    // `hidden` is read through its key: drawing it again with other groups shown measures those too.
  }, [bar, groups, pinned, key, width, look, hiddenKey]);

  return hidden;
}
