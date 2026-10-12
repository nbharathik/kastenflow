// Which editors are presenting and at which slide, so the page around an
// editor can draw its presenting frame, progress and keys without reaching into
// the editor. An editor is told apart by its element, not by the page it shows:
// a page's key can change while it is open (a draft becomes a page, a page is
// given an id), and the same page can be open in two panes. It imports nothing:
// the palette and the menus start with the window and the editor does not.

export interface PresentInfo {
  /** The slide shown, from 0. */
  index: number;
  /** How many slides there are. */
  count: number;
  /** The slide's title. */
  title: string;
  /** The editor presenting. */
  dom: HTMLElement;
}

const shown = new Map<HTMLElement, PresentInfo>();
const listeners = new Set<() => void>();

const same = (a: PresentInfo | undefined, b: PresentInfo | null) => (b === null ? a === undefined : a !== undefined && a.index === b.index && a.count === b.count && a.title === b.title);

/** Records that the editor `dom` is at a slide, or no longer presenting with null. */
export function setPresenting(dom: HTMLElement, info: PresentInfo | null): void {
  if (same(shown.get(dom), info)) return;
  if (info === null) shown.delete(dom);
  else shown.set(dom, info);
  for (const listener of [...listeners]) listener();
}

/** Where the editor inside `frame` is in its presentation, or null when none is presenting there. The same object until it changes. */
export function presentingIn(frame: Element | null): PresentInfo | null {
  if (!frame) return null;
  for (const [dom, info] of shown) if (frame.contains(dom)) return info;
  return null;
}

/** Calls `listener` when any editor starts, moves in or ends its presentation; returns how to stop. */
export function onPresenting(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
