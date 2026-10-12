// The link graph: the shapes of kasten-core's `graph` (serde, camelCase) and
// the one call. Notes, boards, decks and diagrams are nodes; a link to a page
// that does not exist is a ghost node, so the gap can be seen and filled.

/** How much of the vault to draw. */
export type GraphScope =
  | { kind: "vault" }
  /** The project's own things and what they link to or are linked from;
   * `path` is its `_project.md`, its folder or its name. */
  | { kind: "project"; path: string }
  /** A page (or board, deck or ghost, by its node id) and everything within
   * `depth` (1 to 3) links of it, in either direction. */
  | { kind: "around"; path: string; depth: number };

/** A node's kind: a note's own (`page`, `card`, `journal`, `project`, `chat`,
 * `highlight`…), or one of these. */
export type GraphKind = "board" | "deck" | "diagram" | "ghost";

export interface GraphNode {
  /** The vault path of what it stands for; `ghost:` and the missing title for a page that does not exist. */
  id: string;
  /** The vault path; null for a ghost. */
  path: string | null;
  title: string;
  kind: string;
  /** The project folder it lives in. */
  project: string | null;
  /** How many other nodes it is linked with, in either direction. */
  links: number;
  /** In a project's graph: a neighbour that is not in the project. */
  outside?: boolean;
}

/** A link, an embed or a board's card, by the nodes' places in `VaultGraph.nodes`. */
export interface GraphEdge {
  from: number;
  to: number;
  /** `![[…]]`. */
  embed?: boolean;
  /** The link names a title several pages share and nothing picks one. */
  ambiguous?: boolean;
  /** A board's card for the page. */
  board?: boolean;
}

export interface VaultGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export const WHOLE_VAULT: GraphScope = { kind: "vault" };

export interface GraphOps {
  /** The vault's link graph cut down to `scope`. Writes nothing. */
  graph(scope: GraphScope): Promise<VaultGraph>;
}
