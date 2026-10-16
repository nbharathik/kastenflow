// Which card an arrow key moves to. Pure, so the grid's geometry is tested
// without a layout engine.

/** The narrowest a gallery card gets, and the gap between cards, in pixels: hub.css asks for the same. */
export const CARD_MIN = 272;
export const CARD_GAP = 16;

/** The index the key moves to from `index` among `count` cards laid out `columns` to a row; null for a key that is not a move. */
export function nextIndex(key: string, index: number, count: number, columns: number, rows: number): number | null {
  if (count <= 0) return null;
  const last = count - 1;
  switch (key) {
    case "ArrowRight":
      return Math.min(index + 1, last);
    case "ArrowLeft":
      return Math.max(index - 1, 0);
    case "ArrowDown": {
      if (index + columns <= last) return index + columns;
      // The row below is shorter: its last card is nearest.
      return Math.floor(index / columns) < Math.floor(last / columns) ? last : index;
    }
    case "ArrowUp":
      return index - columns >= 0 ? index - columns : index;
    case "Home":
      return 0;
    case "End":
      return last;
    case "PageDown":
      return Math.min(index + rows * columns, last);
    case "PageUp":
      return Math.max(index - rows * columns, 0);
    default:
      return null;
  }
}

/** The columns of a grid: from its computed `grid-template-columns` when the
 * browser gives the sizes, else (a layout that is not there, as in a test) from
 * its width and the smallest card. */
export function columnsFor(template: string, width: number): number {
  const sizes = template.split(/\s+/).filter((part) => /^[\d.]+px$/.test(part));
  if (sizes.length > 0) return sizes.length;
  return Math.max(1, Math.floor((width + CARD_GAP) / (CARD_MIN + CARD_GAP)));
}
