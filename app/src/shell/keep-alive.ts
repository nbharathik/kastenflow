// Which tabs of a pane stay mounted (hidden) after you leave them, so coming
// back is instant and keeps the scroll, the caret, a board's undo and the
// rest of the view's state. The most recently used stay; the others go and
// remount when opened again. Pure, so the order is easy to test.

/** "Keep recent tabs ready": how many other tabs stay ready, by default and at most. */
export const KEEP_DEFAULT = 4;
export const KEEP_MAX = 8;

/** The saved number, as a whole number from 0 (off) to 8; anything else is the usual. */
export function clampKeep(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return KEEP_DEFAULT;
  return Math.min(KEEP_MAX, Math.max(0, Math.round(value)));
}

/** How many visits are remembered; more than any setting can use. */
const REMEMBERED = 32;

/** `order` (most recent first) with `id` moved to the front. The same list comes back when it is already there. */
export function touch(order: readonly string[], id: string): readonly string[] {
  if (order[0] === id) return order;
  return [id, ...order.filter((o) => o !== id)].slice(0, REMEMBERED);
}

/** The tabs to keep mounted: the active one, then the `keep` most recently used others that still exist and can be kept. */
export function keptIds(order: readonly string[], active: string, keep: number, canKeep: (id: string) => boolean): Set<string> {
  const kept = new Set<string>([active]);
  const room = clampKeep(keep);
  let others = 0;
  for (const id of order) {
    if (others >= room) break;
    if (id === active || kept.has(id) || !canKeep(id)) continue;
    kept.add(id);
    others++;
  }
  return kept;
}
