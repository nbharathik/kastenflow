// Picking cards: toggles, Shift ranges and moving focus across the grid with
// the arrow keys. Pure, so the rules are easy to test.

/** The selection with `path` added, or removed when it was in. */
export function toggle(selected: ReadonlySet<string>, path: string): Set<string> {
  const next = new Set(selected);
  if (!next.delete(path)) next.add(path);
  return next;
}

/** Shift+click: everything from the anchor to `path` takes the anchor's
 * state, as in Gmail. With no anchor in `order`, only `path` toggles. */
export function selectRange(selected: ReadonlySet<string>, order: readonly string[], anchor: string | null, path: string): Set<string> {
  const from = anchor === null ? -1 : order.indexOf(anchor);
  const to = order.indexOf(path);
  if (from < 0 || to < 0) return toggle(selected, path);
  const on = selected.has(anchor!);
  const next = new Set(selected);
  for (let i = Math.min(from, to); i <= Math.max(from, to); i++) {
    if (on) next.add(order[i]!);
    else next.delete(order[i]!);
  }
  return next;
}

/** How a click with these keys acts on a card. With nothing selected yet,
 * Shift+click opens (the side stack can take it); after that it extends
 * the selection. */
export function clickAction(event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }, selecting: boolean): "toggle" | "range" | "open" {
  if (event.ctrlKey || event.metaKey) return "toggle";
  if (event.shiftKey && selecting) return "range";
  return "open";
}

/** The card an arrow key moves to in a grid `columns` wide; -1 for keys it ignores. */
export function moveFocus(index: number, key: string, columns: number, count: number): number {
  if (count === 0) return -1;
  const cols = Math.max(1, columns);
  const last = count - 1;
  const at = Math.min(Math.max(index, 0), last);
  switch (key) {
    case "ArrowRight":
      return Math.min(at + 1, last);
    case "ArrowLeft":
      return Math.max(at - 1, 0);
    case "ArrowDown":
      // Into a shorter last row, the last card is the one below.
      if (at + cols <= last) return at + cols;
      return Math.floor(at / cols) < Math.floor(last / cols) ? last : at;
    case "ArrowUp":
      return at - cols >= 0 ? at - cols : at;
    case "Home":
      return 0;
    case "End":
      return last;
    default:
      return -1;
  }
}

/** `moveFocus` over groups drawn one under another, each its own grid
 * `columns` wide (`sizes` are their card counts, in order, the cards numbered
 * through all of them). Down from a group's last row goes to the next group's
 * first row, in the same column or its last card; up is the reverse. */
export function moveInGroups(index: number, key: string, columns: number, sizes: readonly number[]): number {
  const count = sizes.reduce((a, b) => a + b, 0);
  if (sizes.length < 2 || (key !== "ArrowDown" && key !== "ArrowUp")) return moveFocus(index, key, columns, count);
  if (count === 0) return -1;
  const cols = Math.max(1, columns);
  const starts = sizes.map((_, g) => sizes.slice(0, g).reduce((a, b) => a + b, 0));
  let g = 0;
  while (g < sizes.length - 1 && index >= starts[g]! + sizes[g]!) g++;
  const offset = index - starts[g]!;
  const size = sizes[g]!;
  const column = offset % cols;
  if (key === "ArrowDown") {
    if (offset + cols < size) return index + cols;
    // Into a shorter last row, the last card is the one below.
    if (Math.floor(offset / cols) < Math.floor((size - 1) / cols)) return starts[g]! + size - 1;
    for (let h = g + 1; h < sizes.length; h++) if (sizes[h]! > 0) return starts[h]! + Math.min(column, sizes[h]! - 1);
    return index;
  }
  if (offset - cols >= 0) return index - cols;
  for (let h = g - 1; h >= 0; h--) {
    if (sizes[h]! === 0) continue;
    const last = sizes[h]! - 1;
    return starts[h]! + Math.min(Math.floor(last / cols) * cols + column, last);
  }
  return index;
}

/** Columns in a wrapped grid: the cards that share the first card's top.
 * Boxes with no height mean no layout (tests), so one column. */
export function columnsOf(boxes: readonly { top: number; height: number }[]): number {
  const first = boxes[0];
  if (!first || first.height === 0) return 1;
  let n = 1;
  while (n < boxes.length && Math.abs(boxes[n]!.top - first.top) < 1) n++;
  return n;
}
