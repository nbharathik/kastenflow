// Keeping a page's mind map in step with the page. The map remembers, for
// every branch made from a line of the page, where it hangs and the words
// the page had for it (BoardSource). Reading the page again, lines are
// matched to branches from the root down, among each branch's children: the
// same words first, then a line reworded. A new line gets a new branch beside
// its parent, a reworded one gives its branch its new words, and a line that
// left the page leaves its branch where it is, dimmed. Nothing is ever taken
// off the board, and nodes the person moved, resized or added by hand are
// only left alone.

import type { BoardChange, BoardEdge, BoardNode, BoardSource, BoardView, SourceBranch } from "../../lib/vault/types";
import { childSpot, mindMap } from "./canvas/model/mind-map";
import { wordsOf, type OutlineNode } from "./outline";

/** A branch's width, and its height for one line and each line more. */
const WIDTH = 240;
const LINE = 22;
const CHARS_PER_LINE = 26;

/** A branch's size for its words. */
export function sizeOf(text: string): { width: number; height: number } {
  const lines = Math.min(5, Math.max(1, Math.ceil(text.length / CHARS_PER_LINE)));
  return { width: WIDTH, height: 40 + LINE * lines };
}

/** What names a page in its map's source: its id, else its path. */
export const mapKey = (note: { id: string | null; path: string }): string => note.id || note.path;

/** A line of the page the map has no branch for yet. */
export interface NewBranch {
  /** A name for it until the board gives it an id. */
  temp: string;
  /** The node it hangs from: on the board, or the `temp` of an earlier new line. */
  parent: string;
  text: string;
  key: string;
}

export interface SyncPlan {
  /** The node of the page's own card. */
  root: string;
  /** Lines that changed on the page: their branches take the new words. */
  retexts: { id: string; text: string }[];
  /** New lines, in reading order, each after the one it hangs from. */
  added: NewBranch[];
  /** Branches whose line has left the page, dimmed from now on. */
  stale: string[];
  /** Dimmed branches whose line is back. */
  revived: string[];
  /** The page has more lines than a map follows. */
  cut: boolean;
  /** Only the page's card is on the board: the new branches are laid out as a tree. */
  fresh: boolean;
  /** Whether anything needs writing. */
  changed: boolean;
  /** What to remember once the new branches have their ids (by `temp`). */
  next(ids: ReadonlyMap<string, string>): BoardSource;
}

/** The page's own card on a map: the node the source names, else the card
 * showing the page. */
function rootOf(doc: BoardView, path: string): BoardNode | undefined {
  const named = doc.source?.root ? doc.nodes.find((n) => n.id === doc.source!.root && n.kind === "file") : undefined;
  return named ?? doc.nodes.find((n) => n.kind === "file" && n.file === path);
}

/** The branches of a map made before maps remembered their lines: the sticky
 * notes joined to the page's card, each under the one that reaches it first. */
function derive(doc: BoardView, root: string): Record<string, SourceBranch> {
  const nodes = new Map(doc.nodes.filter((n) => n.kind === "text" && !n.shape && !n.draw).map((n) => [n.id, n]));
  const out: Record<string, SourceBranch> = {};
  const seen = new Set([root]);
  const queue = [root];
  for (const id of queue) {
    const next = doc.edges
      .filter((e) => e.from === id || e.to === id)
      .map((e) => nodes.get(e.from === id ? e.to : e.from))
      .filter((n): n is BoardNode => Boolean(n) && !seen.has(n!.id))
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const times = new Map<string, number>();
    for (const node of next) {
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      queue.push(node.id);
      const text = node.text ?? "";
      const words = wordsOf(text);
      const n = (times.get(words) ?? 0) + 1;
      times.set(words, n);
      out[node.id] = { parent: id === root ? "" : id, key: n === 1 ? words : `${words}#${n}`, text };
    }
  }
  return out;
}

const bigrams = (text: string): Map<string, number> => {
  const out = new Map<string, number>();
  for (let i = 0; i < text.length - 1; i++) out.set(text.slice(i, i + 2), (out.get(text.slice(i, i + 2)) ?? 0) + 1);
  return out;
};

/** How alike two keys are, 0 to 1 (character pairs they share). */
function similarity(a: string, b: string): number {
  const x = a.replace(/#\d+$/, "");
  const y = b.replace(/#\d+$/, "");
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const gx = bigrams(x);
  const gy = bigrams(y);
  let shared = 0;
  for (const [pair, n] of gx) shared += Math.min(n, gy.get(pair) ?? 0);
  const alike = (2 * shared) / (x.length - 1 + y.length - 1);
  // Words added to a line, or taken off it, leave it the same line.
  return Math.min(x.length, y.length) >= 3 && (x.includes(y) || y.includes(x)) ? Math.max(alike, 0.6) : alike;
}

/** Which of a branch's old children each line of the page is: the same key,
 * then the most alike of those left, then the one left on both sides. */
function pairUp(olds: readonly string[], branches: Record<string, SourceBranch>, items: readonly OutlineNode[]): Map<OutlineNode, string> {
  const taken = new Map<OutlineNode, string>();
  const used = new Set<string>();
  const byKey = new Map(items.map((item) => [item.key, item]));
  for (const id of olds) {
    const item = byKey.get(branches[id]!.key);
    if (item && !taken.has(item)) {
      taken.set(item, id);
      used.add(id);
    }
  }
  const left = () => olds.filter((id) => !used.has(id));
  const spare = () => items.filter((item) => !taken.has(item));
  const scored = left()
    .flatMap((id) => spare().map((item) => ({ id, item, score: similarity(branches[id]!.key, item.key) })))
    .sort((a, b) => b.score - a.score);
  for (const { id, item, score } of scored) {
    if (score < 0.5) break;
    if (used.has(id) || taken.has(item)) continue;
    taken.set(item, id);
    used.add(id);
  }
  const [id, ...more] = left();
  const [item, ...rest] = spare();
  if (id && item && more.length === 0 && rest.length === 0 && similarity(branches[id]!.key, item.key) >= 0.25) taken.set(item, id);
  return taken;
}

const sameBranches = (a: Record<string, SourceBranch>, b: Record<string, SourceBranch>): boolean => {
  const ids = Object.keys(a);
  return ids.length === Object.keys(b).length && ids.every((id) => b[id] && a[id]!.parent === b[id]!.parent && a[id]!.key === b[id]!.key && a[id]!.text === b[id]!.text && Boolean(a[id]!.stale) === Boolean(b[id]!.stale));
};

/** What bringing the map in step with the page would do; null when the
 * page's card is not on the board any more. */
export function planSync(doc: BoardView, note: { id: string | null; path: string }, outline: { tree: OutlineNode[]; cut: boolean }): SyncPlan | null {
  const root = rootOf(doc, note.path);
  if (!root) return null;
  const adopting = !doc.source;
  const old: Record<string, SourceBranch> = adopting ? derive(doc, root.id) : { ...doc.source!.branches };
  const onBoard = new Set(doc.nodes.map((n) => n.id));
  const children = new Map<string, string[]>();
  for (const [id, branch] of Object.entries(old)) children.set(branch.parent, [...(children.get(branch.parent) ?? []), id]);

  const next: Record<string, SourceBranch> = {};
  const claimed = new Set<string>();
  const retexts: SyncPlan["retexts"] = [];
  const added: NewBranch[] = [];
  const stale: string[] = [];
  const revived: string[] = [];

  /** A branch the page has no line for: it stays, dimmed, with whatever hangs from it. A
   * map from before this one remembered its lines hands such a branch to the person. */
  const leave = (id: string) => {
    claimed.add(id);
    const entry = old[id]!;
    if (onBoard.has(id) && !adopting) {
      // Past the lines a map follows, a line may still be there: leave it be.
      next[id] = outline.cut || entry.stale ? entry : { ...entry, stale: true };
      if (!entry.stale && !outline.cut) stale.push(id);
    }
    for (const child of children.get(id) ?? []) if (!claimed.has(child)) leave(child);
  };

  /** New lines and everything under them. */
  const grow = (parent: string, items: readonly OutlineNode[]) => {
    for (const item of items) {
      const temp = `new:${added.length}`;
      added.push({ temp, parent, text: item.text, key: item.key });
      grow(temp, item.children);
    }
  };

  /** The page's lines under one branch, against the branches it had. */
  const follow = (oldParent: string, items: readonly OutlineNode[], parentOnBoard: boolean) => {
    const parent = oldParent === "" ? root.id : oldParent;
    const olds = (children.get(oldParent) ?? []).filter((id) => !claimed.has(id));
    const taken = pairUp(olds, old, items);
    for (const item of items) {
      const id = taken.get(item);
      if (id === undefined) {
        // A branch taken off by hand leaves its new lines out too.
        if (parentOnBoard) grow(parent, [item]);
        continue;
      }
      claimed.add(id);
      const entry = old[id]!;
      const here = onBoard.has(id);
      next[id] = { parent: entry.parent, key: item.key, text: item.text };
      if (here && entry.text !== item.text) retexts.push({ id, text: item.text });
      if (here && entry.stale) revived.push(id);
      follow(id, item.children, here);
    }
    for (const id of olds) if (!claimed.has(id)) leave(id);
  };

  follow("", outline.tree, true);
  for (const id of Object.keys(old)) if (!claimed.has(id)) leave(id);

  const fresh = adopting && doc.nodes.length === 1 && doc.edges.length === 0;
  const changed = adopting || retexts.length > 0 || added.length > 0 || !sameBranches(old, next);
  const page = mapKey(note);
  return {
    root: root.id,
    retexts,
    added,
    stale,
    revived,
    cut: outline.cut,
    fresh,
    changed,
    next(ids) {
      const real = (ref: string) => ids.get(ref) ?? (ref === root.id ? "" : ref);
      const branches = { ...next };
      for (const branch of added) {
        const id = ids.get(branch.temp);
        if (id) branches[id] = { parent: real(branch.parent), key: branch.key, text: branch.text };
      }
      return { ...doc.source, page, root: root.id, branches };
    },
  };
}

type Spot = { x: number; y: number; width: number; height: number };

/** Where each new branch goes, by its `temp`. A map that is only the page's
 * card is laid out as a tree. Otherwise each goes beside its parent, below
 * the branches already there, and nothing that is on the board moves. */
export function spotsFor(doc: BoardView, plan: SyncPlan): Map<string, Spot> {
  const nodes: BoardNode[] = [...doc.nodes];
  const edges: BoardEdge[] = [...doc.edges];
  const spots = new Map<string, Spot>();
  for (const branch of plan.added) {
    const size = sizeOf(branch.text);
    const at = plan.fresh ? { x: 0, y: 0 } : childSpot(nodes, edges, branch.parent);
    spots.set(branch.temp, { ...at, ...size });
    nodes.push({ id: branch.temp, kind: "text", text: branch.text, ...at, ...size });
    edges.push({ id: `edge:${branch.temp}`, from: branch.parent, to: branch.temp, fromSide: "right", toSide: "left" });
  }
  if (plan.fresh) {
    const root = nodes.find((n) => n.id === plan.root);
    for (const change of root ? mindMap(nodes, edges, [root]) : []) {
      const spot = change.kind === "place" ? spots.get(change.id) : undefined;
      if (change.kind === "place" && spot) spots.set(change.id, { ...spot, x: change.x, y: change.y });
    }
  }
  return spots;
}

/** What each batch of a sync is sent through: it resolves with the ids of
 * what the batch made (in order), or null when the batch was refused. */
export type Run = (changes: BoardChange[]) => Promise<string[] | null>;

export interface SyncResult {
  added: number;
  updated: number;
  stale: number;
  revived: number;
  cut: boolean;
}

/** Writes a plan: new branches first (with the words that changed), then
 * their sizes, their joins and what the map remembers. Null if a batch was
 * refused; what the first batch made is then taken off again. */
export async function applySync(doc: BoardView, plan: SyncPlan, run: Run): Promise<SyncResult | null> {
  const result: SyncResult = { added: plan.added.length, updated: plan.retexts.length, stale: plan.stale.length, revived: plan.revived.length, cut: plan.cut };
  if (!plan.changed) return result;
  const texts = plan.retexts.map(({ id, text }): BoardChange => ({ kind: "text", id, text }));
  if (plan.added.length === 0) {
    const done = await run([...texts, { kind: "source", source: plan.next(new Map()) }]);
    return done ? result : null;
  }
  const spots = spotsFor(doc, plan);
  const at = (temp: string) => spots.get(temp)!;
  const made = await run([...texts, ...plan.added.map((a): BoardChange => ({ kind: "sticky", text: a.text, x: at(a.temp).x, y: at(a.temp).y }))]);
  if (!made || made.length !== plan.added.length) return null;
  const ids = new Map(plan.added.map((a, i) => [a.temp, made[i]!]));
  const real = (ref: string) => ids.get(ref) ?? ref;
  const joined = await run([
    ...plan.added.flatMap((a): BoardChange[] => [
      { kind: "place", id: ids.get(a.temp)!, x: at(a.temp).x, y: at(a.temp).y, width: at(a.temp).width, height: at(a.temp).height },
      { kind: "connect", from: real(a.parent), to: ids.get(a.temp)!, fromSide: "right", toSide: "left" },
    ]),
    { kind: "source", source: plan.next(ids) },
  ]);
  if (!joined) {
    await run([{ kind: "remove", ids: [...ids.values()] }]).catch(() => null);
    return null;
  }
  return result;
}

/** A sentence for what a sync did: "2 new, 1 changed". */
export function describe(result: SyncResult): string {
  const parts = [
    result.added ? `${result.added} new` : "",
    result.updated ? `${result.updated} changed` : "",
    result.stale ? `${result.stale} not in the page any more` : "",
    result.revived ? `${result.revived} back` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "nothing new";
}
