// What the graph canvas tells the view, and what the view tells it.

import type { ColourBy } from "./graph-model";

/** The modifier keys a click or key carries, which say where something opens. */
export interface Keys {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  button: number;
}

export interface Handlers {
  /** The pointer or a key moved the selection (`-1` clears it). */
  select(index: number): void;
  /** A click on a node, once it is clear it was not the first half of a double click. */
  open(index: number, keys: Keys): void;
  /** A double click on a node. */
  openHere(index: number): void;
  /** A right click, or the menu key: `index` is the node, or -1 for empty space. */
  context(index: number, at: { x: number; y: number }): void;
  /** A double click on empty space, at this place in the graph. */
  createAt(x: number, y: number): void;
  /** A link dragged from a node and dropped on empty space, at this place in the graph. */
  linkTo(from: number, x: number, y: number): void;
}

export interface Settings {
  colourBy: ColourBy;
  /** The node selected, or -1. */
  selected: number;
  /** Names every node that has room, whatever the zoom: a small graph. */
  nameAll: boolean;
  /** Whether double clicks and drags make pages (the whole graph, not a small one). */
  editable: boolean;
}

/** How long a click waits to see whether a second one follows. */
export const DOUBLE_CLICK_MS = 230;
