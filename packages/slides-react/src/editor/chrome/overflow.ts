// Which groups of a toolbar go into the "more" menu when the row is too narrow. The first to go are the ones the person needs least, and
// the groups that stay never change place, so the bar does not rearrange itself as it is resized.

export interface Slot {
  id: string;
  /** Pixels the group takes in the row (its natural width, with its margins). */
  width: number;
  /**
   * 0 stays whatever the width. The larger the number, the sooner the group goes. Groups of the same number go from the right, so the
   * ones further along the row (the ones about the slide, not about what is selected) go first.
   */
  drop: number;
}

/** The ids of the groups to move into the "more" menu: `available` pixels for the row, `more` of them for the menu's own button. */
export function chooseHidden(slots: readonly Slot[], available: number, more: number): Set<string> {
  const total = (shown: readonly Slot[]) => shown.reduce((sum, slot) => sum + slot.width, 0);
  if (total(slots) <= available) return new Set();
  const hidden = new Set<string>();
  const order = slots.map((slot, index) => ({ slot, index })).filter(({ slot }) => slot.drop > 0).sort((a, b) => b.slot.drop - a.slot.drop || b.index - a.index);
  let shown = [...slots];
  for (const { slot } of order) {
    if (total(shown) + more <= available) break;
    hidden.add(slot.id);
    shown = shown.filter((other) => other !== slot);
  }
  return hidden;
}
