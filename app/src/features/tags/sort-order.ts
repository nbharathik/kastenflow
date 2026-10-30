// The order of a view's sort keys: the first sorts first, the next break its
// ties. Moving one is a drag in the bar or Alt with an arrow key. Pure, unit tested.

/** The list with the item at `from` moved to place `to`; the same list when nothing moves. */
export function moveSort<T>(sorts: readonly T[], from: number, to: number): readonly T[] {
  if (from === to || from < 0 || to < 0 || from >= sorts.length || to >= sorts.length) return sorts;
  const next = sorts.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

/** Where Alt with this key moves a sort key at `index`, or null when the key is not one for moving. */
export function altMove(key: string, index: number): number | null {
  if (key === "ArrowUp" || key === "ArrowLeft") return index - 1;
  if (key === "ArrowDown" || key === "ArrowRight") return index + 1;
  return null;
}
