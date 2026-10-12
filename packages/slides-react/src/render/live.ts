// Boxes drawn in place of what the slide says, while a drag is under way. The editor's canvas
// puts the place a resize has taken an element to here, and only the views of those elements
// are drawn again: the slide itself, and the hundred elements beside the one being resized,
// are left alone. Nothing here is part of a deck; when the drag ends the store is emptied and
// the deck, which the drag's one operation has changed, says where everything is.

import type { Element } from "@kasten-slides/wasm";
import { createContext, useContext, useMemo, useSyncExternalStore } from "react";

/** Where an element is drawn instead: its box, and any turn or flip the drag has given it. */
export interface Placed {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  flipH?: boolean;
  flipV?: boolean;
}

const EMPTY: ReadonlyMap<string, Placed> = new Map();

const samePlaced = (a: Placed | undefined, b: Placed | undefined): boolean =>
  a === b ||
  (a !== undefined && b !== undefined && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h && a.rotation === b.rotation && a.flipH === b.flipH && a.flipV === b.flipV);

/** What one view reads: how to be told of a change, and what the store has for the element now. */
export interface Watch {
  subscribe(listener: () => void): () => void;
  get(): Placed | undefined;
}

/**
 * The boxes a drag has taken elements to, by id. A view of one element watches its id and is
 * told only when that element's box changes. `wide` holds the boxes of elements whose
 * drawing is made from the whole slide (a composite is drawn as the primitives it expands
 * to), which only the slide can redraw.
 */
export class LiveBoxes {
  private values: ReadonlyMap<string, Placed> = EMPTY;
  private wideValues: ReadonlyMap<string, Placed> = EMPTY;
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly watches = new Map<string, Watch>();
  private readonly wideListeners = new Set<() => void>();

  /** The box an element is drawn in, if a drag has taken it one. */
  get(id: string): Placed | undefined {
    return this.values.get(id);
  }

  /** What a view of this element reads. The same object for the same id, so a view subscribes once. */
  watch(id: string): Watch {
    let watch = this.watches.get(id);
    if (!watch) {
      watch = {
        subscribe: (listener) => {
          let set = this.listeners.get(id);
          if (!set) this.listeners.set(id, (set = new Set()));
          set.add(listener);
          return () => {
            set.delete(listener);
            if (set.size === 0) this.listeners.delete(id);
          };
        },
        get: () => this.values.get(id),
      };
      this.watches.set(id, watch);
    }
    return watch;
  }

  /** Replaces what is drawn elsewhere. An element not named goes back to the slide's own box; one that did not change is not told. */
  set(next: ReadonlyMap<string, Placed>): void {
    const was = this.values;
    if (was.size === 0 && next.size === 0) return;
    const kept = new Map<string, Placed>();
    const changed: string[] = [];
    for (const [id, placed] of next) {
      const before = was.get(id);
      if (before && samePlaced(before, placed)) kept.set(id, before);
      else {
        kept.set(id, placed);
        changed.push(id);
      }
    }
    for (const id of was.keys()) if (!next.has(id)) changed.push(id);
    this.values = kept;
    for (const id of changed) for (const listener of [...(this.listeners.get(id) ?? [])]) listener();
  }

  /** Replaces the boxes the whole slide is drawn again for. */
  setWide(next: ReadonlyMap<string, Placed>): void {
    const was = this.wideValues;
    if (was.size === 0 && next.size === 0) return;
    const same = was.size === next.size && [...next].every(([id, placed]) => samePlaced(was.get(id), placed));
    if (same) return;
    this.wideValues = next.size === 0 ? EMPTY : next;
    for (const listener of [...this.wideListeners]) listener();
  }

  subscribeWide = (listener: () => void): (() => void) => {
    this.wideListeners.add(listener);
    return () => this.wideListeners.delete(listener);
  };

  getWide = (): ReadonlyMap<string, Placed> => this.wideValues;

  /** Forgets everything, and tells those who were drawn elsewhere. */
  clear(): void {
    this.set(EMPTY);
    this.setWide(EMPTY);
  }
}

/** The store the slide is drawn with while it is edited; none in a presentation, a thumbnail or an export. */
export const LiveContext = createContext<LiveBoxes | null>(null);

const NOBODY: Watch = { subscribe: () => () => {}, get: () => undefined };

/** The box a drag has taken `id` to, or undefined: the view of an element asks this, and is drawn again when the answer changes. */
export function useLiveBox(id: string): Placed | undefined {
  const live = useContext(LiveContext);
  const watch = useMemo(() => (live ? live.watch(id) : NOBODY), [live, id]);
  return useSyncExternalStore(watch.subscribe, watch.get, watch.get);
}

/** The element as a drag has placed it: the same object when it has not been taken anywhere. */
export function placedElement<T extends Element>(element: T, placed: Placed | undefined): T {
  if (!placed) return element;
  const out = { ...element, x: placed.x, y: placed.y, w: placed.w, h: placed.h } as T;
  if (placed.rotation !== undefined) out.rotation = placed.rotation;
  if (placed.flipH !== undefined) out.flipH = placed.flipH;
  if (placed.flipV !== undefined) out.flipV = placed.flipV;
  return out;
}
