// Where the reader is in a long PDF, kept as the page and how far down that
// page (a ratio, not pixels), so the same place can be found again when the
// pages change size (a zoom) or the PDF is rebuilt. Pure.

/** A page's place in the scrolled column, in CSS pixels. */
export interface PageBox {
  top: number;
  height: number;
}

export interface Anchor {
  /** 0-based. */
  page: number;
  /** How far down the page, 0 to 1. */
  ratio: number;
}

/** The column of pages: each size in points at `scale`, with a gap between pages and padding at both ends. */
export function pageBoxes(sizes: readonly { width: number; height: number }[], scale: number, gap: number, pad: number): PageBox[] {
  let top = pad;
  return sizes.map((size) => {
    const box = { top, height: size.height * scale };
    top += box.height + gap;
    return box;
  });
}

/** The total height of the column. */
export function columnHeight(boxes: readonly PageBox[], pad: number): number {
  const last = boxes[boxes.length - 1];
  return last ? last.top + last.height + pad : 0;
}

/** The page and the ratio at the scroll position `scrollTop`. */
export function anchorAt(scrollTop: number, boxes: readonly PageBox[]): Anchor {
  if (boxes.length === 0) return { page: 0, ratio: 0 };
  let page = 0;
  for (let at = 0; at < boxes.length; at++) {
    if (boxes[at]!.top <= scrollTop) page = at;
    else break;
  }
  const box = boxes[page]!;
  const ratio = box.height > 0 ? (scrollTop - box.top) / box.height : 0;
  return { page, ratio: Math.min(1, Math.max(0, ratio)) };
}

/** The scroll position that shows `anchor` in `boxes`. A page that is gone (a shorter PDF) puts the reader at the end. */
export function scrollFor(anchor: Anchor, boxes: readonly PageBox[]): number {
  if (boxes.length === 0) return 0;
  if (anchor.page >= boxes.length) {
    const last = boxes[boxes.length - 1]!;
    return last.top + last.height;
  }
  const box = boxes[anchor.page]!;
  return Math.max(0, Math.round(box.top + anchor.ratio * box.height));
}

/** Which pages (0-based) are in view for a window of `height` pixels at `scrollTop`, with `margin` pages on each side. */
export function pagesInView(scrollTop: number, height: number, boxes: readonly PageBox[], margin = 0): number[] {
  const hit: number[] = [];
  boxes.forEach((box, at) => {
    if (box.top + box.height >= scrollTop && box.top <= scrollTop + height) hit.push(at);
  });
  if (hit.length === 0) return [];
  const first = Math.max(0, hit[0]! - margin);
  const last = Math.min(boxes.length - 1, hit[hit.length - 1]! + margin);
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}
