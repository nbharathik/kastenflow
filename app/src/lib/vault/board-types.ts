// Whiteboards as the core shows and edits them (crates/kasten-core/src/board).

export interface BoardInfo {
  path: string;
  title: string;
  project: string | null;
  nodes: number;
  modified: number;
  /** The id of the page this board is a map of, when it was made from one. */
  source?: string;
}

/** A branch of a page's map: where it hangs, and what the page said for it
 * when the map last followed the page. */
export interface SourceBranch {
  /** The branch it hangs from, by node id; "" for the page's own card. */
  parent: string;
  /** The line's text with its list marks and emphasis taken off, lower
   * case: what two readings of the page are compared by. */
  key: string;
  /** The words shown on the branch as the page had them. */
  text: string;
  /** The page no longer has this line; the branch stays, dimmed. */
  stale?: boolean;
}

/** What a board remembers about the page it was made from
 * (`x-kasten.source`): the core keeps the object as written. */
export interface BoardSource {
  /** The page's id (its path when it has none). */
  page: string;
  /** The node id of the page's own card, the map's root. */
  root?: string;
  /** Every branch made from a line of the page, by node id. */
  branches?: Record<string, SourceBranch>;
}

/** The outlines a text node may take, as draw.io names them. */
export type ShapeKind = "rect" | "rounded" | "ellipse" | "diamond" | "parallelogram" | "cylinder" | "hexagon" | "document" | "triangle";
export type LineStyle = "straight" | "curve" | "elbow";

/** A drawn stroke: `x,y` points relative to its node, and the pen's width. */
export interface BoardDrawing {
  points: string;
  size: number;
}

/** One node of a board; only its kind's fields are set. */
export interface BoardNode {
  id: string;
  /** file, text, link or group. */
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
  file?: string;
  /** The note's title, for file nodes. */
  title?: string;
  missing?: boolean;
  text?: string;
  url?: string;
  label?: string;
  /** "1" to "6" (JSON Canvas presets) or "#rrggbb". */
  color?: string;
  /** Cards: shown as the title only or expanded; unset shows title and first lines. */
  size?: "title" | "expanded";
  /** Sections: folded to their label. */
  collapsed?: boolean;
  /** Text nodes drawn as a shape. */
  shape?: ShapeKind;
  /** Text nodes that are a drawn stroke. */
  draw?: BoardDrawing;
}

export type BoardSide = "top" | "right" | "bottom" | "left";
export type BoardEnd = "none" | "arrow";

export interface BoardEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  color?: string;
  /** Unset: the renderer picks the sides facing each other. */
  fromSide?: BoardSide;
  toSide?: BoardSide;
  /** Unset: no arrowhead at the start, an arrow at the end. */
  fromEnd?: BoardEnd;
  toEnd?: BoardEnd;
  /** Unset: the renderer's own curve. */
  line?: LineStyle;
  dash?: boolean;
}

/** One edit on a board (the core's `BoardChange`). Coordinates are whole
 * pixels; ids name what is on the board or was made earlier in the batch. */
export type BoardChange =
  | { kind: "place"; id: string; x: number; y: number; width?: number; height?: number }
  /** Takes nodes off with their edges; the notes stay. */
  | { kind: "remove"; ids: string[] }
  /** A sticky's text, a section's label or a link's address. */
  | { kind: "text"; id: string; text: string }
  /** Nodes or edges; null goes back to the default colour. */
  | { kind: "color"; ids: string[]; color: string | null }
  | { kind: "sticky"; text: string; x: number; y: number }
  /** A card for a vault file (a note, or a `.canvas` for a nested board);
   * a new card takes `width` and `height` when given. */
  | { kind: "card"; path: string; x: number; y: number; width?: number; height?: number }
  | { kind: "link"; url: string; x: number; y: number }
  | { kind: "section"; label: string; x: number; y: number; width: number; height: number }
  | { kind: "wrap"; ids: string[]; label: string }
  | { kind: "connect"; from: string; to: string; label?: string; fromSide?: BoardSide; toSide?: BoardSide }
  /** Each field given replaces the old value; "" removes it (a side left
   * unset is the one facing the other node). */
  | { kind: "edge"; id: string; label?: string; color?: string; fromEnd?: BoardEnd | ""; toEnd?: BoardEnd | ""; fromSide?: BoardSide | ""; toSide?: BoardSide | "" }
  | { kind: "unlink"; ids: string[] }
  /** How a card shows; null goes back to its title and first lines. */
  | { kind: "card_size"; id: string; size: "title" | "expanded" | null }
  | { kind: "collapse"; id: string; collapsed: boolean }
  /** Puts back nodes and edges as they were, ids and all (undo). JSON Canvas
   * objects: `{id, type, x, y, width, height, ...}` and `{id, fromNode, toNode, ...}`. */
  | { kind: "restore"; nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] }
  /** A new shape with its label. */
  | { kind: "shape"; shape: ShapeKind; text: string; x: number; y: number; width: number; height: number }
  /** Another outline for a text node; "" makes it a sticky again. */
  | { kind: "reshape"; id: string; shape: ShapeKind | "" }
  /** A drawn stroke in the box at x, y, its points relative to that corner. */
  | { kind: "draw"; points: string; x: number; y: number; width: number; height: number; size: number; color?: string }
  /** How an edge is drawn; "" goes back to the default line. */
  | { kind: "line"; id: string; line?: LineStyle | ""; dash?: boolean }
  /** What the board remembers about the page it was made from; null forgets it. */
  | { kind: "source"; source: BoardSource | null };

export interface BoardApplied {
  /** The id of what each change that makes something made, in order. */
  made: string[];
  board: BoardView;
}

export interface BoardView {
  path: string;
  title: string;
  /** Lowest first: sections come before the cards in them. */
  nodes: BoardNode[];
  edges: BoardEdge[];
  /** Set on a page's mind map: what it was made from. */
  source?: BoardSource;
}

export interface BoardAdded {
  /** One node id per note, in order (new, or already on the board). */
  nodes: string[];
  created: string[];
  groups: string[];
}
