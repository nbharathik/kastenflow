// The link graph in the browser preview, from the notes and files it keeps:
// the same nodes, ghosts and scopes as kasten-core's `graph` module (the app
// asks the core). Links are followed with the same `Directory` the editor uses.

import type { GraphEdge, GraphNode, GraphScope, NoteMeta, VaultGraph } from "../../../lib/vault/types";
import { splitFrontmatter } from "../../pages/markdown/frontmatter";
import { Directory, linkParts, linkSpans, pathKey } from "../links";
import { deckHead } from "./memory-decks";
import { boardTitle, readCanvas } from "./memory-extras";

/** A note's links to one target, counted, as the index's `link_rows` give them. */
export interface LinkRow {
  path: string;
  /** Lowercase, as the index keeps it. */
  target: string;
  embed: boolean;
  count: number;
}

/** A board, deck or diagram file. */
export interface FileNode {
  path: string;
  title: string;
  kind: "board" | "deck" | "diagram";
  project: string | null;
  /** For a board, the files its cards show. */
  cards: string[];
}

/** Endings of files a link may name that are not notes. */
const FILE_ENDINGS = new Set(["canvas", "deck", "drawio", "svg", "png", "jpg", "jpeg", "gif", "webp", "pdf", "mp3", "mp4", "mov", "webm", "wav", "csv", "json", "yaml", "yml", "txt", "bib", "html", "zip", "xlsx"]);

const isFileName = (target: string) => {
  const name = target.slice(target.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 && FILE_ENDINGS.has(name.slice(dot + 1));
};

const isRealDay = (text: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
};

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Every note's links, counted by target and kind. */
export function linkRowsOf(notes: readonly NoteMeta[], textOf: (path: string) => string): LinkRow[] {
  const rows: LinkRow[] = [];
  for (const note of notes) {
    if (note.kind === "template" || note.path.startsWith("templates/")) continue;
    const body = splitFrontmatter(textOf(note.path)).body;
    const counts = new Map<string, LinkRow>();
    for (const [start, end] of linkSpans(body)) {
      const target = linkParts(body.slice(start, end)).target.toLowerCase();
      if (!target) continue;
      const embed = body[start - 3] === "!";
      const key = `${embed ? "!" : ""}${target}`;
      const row = counts.get(key);
      if (row) row.count++;
      else counts.set(key, { path: note.path, target, embed, count: 1 });
    }
    rows.push(...counts.values());
  }
  return rows;
}

type To = { node: number } | { ghost: string };
interface Pending {
  from: number;
  to: To;
  embed: boolean;
  ambiguous: boolean;
}

/** The whole graph: notes, files and ghosts, every edge between them. */
function whole(notes: readonly NoteMeta[], rows: readonly LinkRow[], files: readonly FileNode[]): VaultGraph {
  const real = notes.filter((n) => n.kind !== "template" && !n.path.startsWith("templates/")).sort((a, b) => byText(a.path, b.path));
  const stored = [...files].sort((a, b) => byText(a.path, b.path));
  const nodes: GraphNode[] = [];
  const at = new Map<string, number>();
  for (const note of real) {
    at.set(note.path, nodes.length);
    nodes.push({ id: note.path, path: note.path, title: note.title, kind: note.kind, project: note.project ?? null, links: 0 });
  }
  const filePath = new Map<string, number>();
  const fileName = new Map<string, number[]>();
  for (const file of stored) {
    const index = nodes.length;
    const key = file.path.toLowerCase();
    filePath.set(key, index);
    const name = key.slice(key.lastIndexOf("/") + 1);
    fileName.set(name, [...(fileName.get(name) ?? []), index]);
    nodes.push({ id: file.path, path: file.path, title: file.title, kind: file.kind, project: file.project, links: 0 });
  }
  const fileFor = (target: string): number | undefined => {
    const key = target.trim().toLowerCase();
    const found = filePath.get(key);
    if (found !== undefined) return found;
    const named = fileName.get(key.slice(key.lastIndexOf("/") + 1));
    return named?.length === 1 ? named[0] : undefined;
  };

  const directory = new Directory(real);
  const pending: Pending[] = [];
  for (const row of rows) {
    const from = at.get(row.path);
    if (from === undefined) continue;
    const found = directory.resolve(row.target, { path: row.path, project: nodes[from]!.project });
    if (found && "note" in found) {
      const to = at.get(found.note.path)!;
      if (to !== from) pending.push({ from, to: { node: to }, embed: row.embed, ambiguous: false });
    } else if (found) {
      for (const choice of found.choices) {
        const to = at.get(choice.path)!;
        if (to !== from) pending.push({ from, to: { node: to }, embed: row.embed, ambiguous: true });
      }
    } else {
      const file = fileFor(row.target);
      const target = row.target.trim();
      if (file !== undefined) pending.push({ from, to: { node: file }, embed: row.embed, ambiguous: false });
      else if (!isFileName(target) && !isRealDay(target)) pending.push({ from, to: { ghost: target }, embed: row.embed, ambiguous: false });
    }
  }
  const ghosts = [...new Set(pending.flatMap((p) => ("ghost" in p.to ? [p.to.ghost] : [])))].sort(byText);
  const ghostAt = new Map<string, number>();
  for (const target of ghosts) {
    ghostAt.set(target, nodes.length);
    nodes.push({ id: `ghost:${target}`, path: null, title: target, kind: "ghost", project: null, links: 0 });
  }
  const edges: GraphEdge[] = pending.map((p) => ({ from: p.from, to: "node" in p.to ? p.to.node : ghostAt.get(p.to.ghost)!, embed: p.embed || undefined, ambiguous: p.ambiguous || undefined }));
  stored.forEach((file, offset) => {
    const from = real.length + offset;
    for (const card of file.cards) {
      const note = directory.note(card);
      const to = note ? at.get(note.path)! : filePath.get(card.toLowerCase());
      if (to !== undefined && to !== from) edges.push({ from, to, board: true });
    }
  });
  // One edge per pair, the plainest: a link beats an embed, a clear link a guess.
  const rank = (e: GraphEdge) => Number(Boolean(e.embed)) * 4 + Number(Boolean(e.ambiguous)) * 2 + Number(Boolean(e.board));
  edges.sort((a, b) => a.from - b.from || a.to - b.to || rank(a) - rank(b));
  const unique = edges.filter((e, i) => i === 0 || e.from !== edges[i - 1]!.from || e.to !== edges[i - 1]!.to);
  return { nodes, edges: unique.map(plain) };
}

/** An edge without its false flags, as the core sends it. */
const plain = (e: GraphEdge): GraphEdge => ({ from: e.from, to: e.to, ...(e.embed ? { embed: true } : {}), ...(e.ambiguous ? { ambiguous: true } : {}), ...(e.board ? { board: true } : {}) });

/** A project's folder name from its folder, its `_project.md` or the name. */
function projectName(path: string): string {
  const trimmed = path.trim().replace(/^\/+|\/+$/g, "");
  return (trimmed.startsWith("projects/") ? trimmed.slice(9) : trimmed).split("/")[0] ?? "";
}

/** The nodes marked in `kept`, in their order, and the edges `keep` allows. */
function subgraph(full: VaultGraph, kept: readonly boolean[], outside: readonly boolean[], keep: (e: GraphEdge) => boolean): VaultGraph {
  const moved: number[] = [];
  const nodes: GraphNode[] = [];
  full.nodes.forEach((node, i) => {
    if (!kept[i]) return;
    moved[i] = nodes.length;
    nodes.push(outside[i] ? { ...node, outside: true } : { ...node });
  });
  const edges = full.edges.filter(keep).map((e) => ({ ...e, from: moved[e.from]!, to: moved[e.to]! }));
  return { nodes, edges };
}

function project(full: VaultGraph, name: string): VaultGraph {
  const inside = full.nodes.map((n) => n.kind !== "ghost" && n.project === name);
  const kept = [...inside];
  for (const e of full.edges) if (inside[e.from] || inside[e.to]) kept[e.from] = kept[e.to] = true;
  const outside = full.nodes.map((n, i) => kept[i]! && !inside[i] && n.kind !== "ghost");
  return subgraph(full, kept, outside, (e) => inside[e.from]! || inside[e.to]!);
}

function around(full: VaultGraph, path: string, depth: number): VaultGraph {
  const key = pathKey(path);
  const start = full.nodes.findIndex((n) => n.id === path);
  const found = start >= 0 ? start : full.nodes.findIndex((n) => n.path !== null && pathKey(n.path) === key);
  if (found < 0) return { nodes: [], edges: [] };
  const neighbours: number[][] = full.nodes.map(() => []);
  for (const e of full.edges) {
    neighbours[e.from]!.push(e.to);
    neighbours[e.to]!.push(e.from);
  }
  const seen = full.nodes.map((_, i) => i === found);
  let frontier = [found];
  for (let step = 0; step < depth; step++) {
    const next: number[] = [];
    for (const node of frontier) {
      for (const other of neighbours[node]!) {
        if (!seen[other]) {
          seen[other] = true;
          next.push(other);
        }
      }
    }
    frontier = next;
  }
  return subgraph(full, seen, seen.map(() => false), (e) => seen[e.from]! && seen[e.to]!);
}

/** Each node's number of distinct neighbours. */
function countLinks(graph: VaultGraph): VaultGraph {
  const pairs = new Set(graph.edges.map((e) => (e.from < e.to ? `${e.from}:${e.to}` : `${e.to}:${e.from}`)));
  const counts = graph.nodes.map(() => 0);
  for (const pair of pairs) {
    const [a, b] = pair.split(":").map(Number) as [number, number];
    counts[a]!++;
    counts[b]!++;
  }
  return { nodes: graph.nodes.map((n, i) => ({ ...n, links: counts[i]! })), edges: graph.edges };
}

export function graphIn(notes: readonly NoteMeta[], rows: readonly LinkRow[], files: readonly FileNode[], scope: GraphScope): VaultGraph {
  const full = whole(notes, rows, files);
  const cut = scope.kind === "vault" ? full : scope.kind === "project" ? project(full, projectName(scope.path)) : around(full, scope.path, Math.min(3, Math.max(1, Math.round(scope.depth))));
  return countLinks(cut);
}

/** The preview's boards and decks as graph files. */
export function filesOf(boards: Readonly<Record<string, string>> = {}, decks: Readonly<Record<string, string>> = {}): FileNode[] {
  const projectOf = (path: string) => (path.startsWith("projects/") ? (path.split("/")[1] ?? null) : null);
  const out: FileNode[] = [];
  for (const [path, text] of Object.entries(boards)) {
    let canvas;
    try {
      canvas = readCanvas(text);
    } catch {
      // A board that cannot be read is left out, as the core does.
      continue;
    }
    const cards = canvas.nodes.filter((n) => n.type === "file" && typeof n.file === "string").map((n) => n.file as string);
    out.push({ path, title: boardTitle(path, canvas), kind: "board", project: projectOf(path), cards });
  }
  for (const [path, text] of Object.entries(decks)) {
    let title = "";
    try {
      title = deckHead(text).title?.trim() ?? "";
    } catch {
      // A deck that cannot be read keeps its file name.
    }
    const stem = path.slice(path.lastIndexOf("/") + 1).replace(/\.deck$/, "");
    out.push({ path, title: title || stem, kind: "deck", project: projectOf(path), cards: [] });
  }
  return out;
}
