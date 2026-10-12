// "Mind map from this page": one map per page, found by the page's id (kept
// on the board as its source) however the page or the map were renamed or
// moved, made only when there is none. The page's card is the root and its
// outline (headings and list items, nested as written) the branches, laid
// out by the Mind map layout; map-sync.ts keeps them in step afterwards.
// Made through the core's board changes like any board, so it is an
// ordinary board to edit, and the page is left as it was.

import { splitFrontmatter } from "../pages/markdown/frontmatter";
import type { BoardInfo, NoteMeta, VaultClient } from "../../lib/vault/types";
import { applySync, mapKey, planSync, type Run } from "./map-sync";
import { readOutline } from "./outline";

type Client = Pick<VaultClient, "read" | "boards" | "boardsWith" | "board" | "boardApply" | "createBoard">;

/** What a map made from this page is called. */
export const mapTitle = (note: Pick<NoteMeta, "title">): string => `${note.title} map`;

/** Sends a sync's batches straight to the vault. */
export function sendTo(client: Pick<VaultClient, "boardApply">, path: string): Run {
  return async (changes) => (await client.boardApply(path, changes)).made;
}

/** The page's outline, as it is written now. */
export async function readPage(client: Pick<VaultClient, "read">, note: Pick<NoteMeta, "path">) {
  return readOutline(splitFrontmatter((await client.read(note.path)).text).body);
}

/** The maps of a page, best first: the ones that name it as their source
 * (most recently edited first), then older ones made before maps did, which
 * have its title and its card. Only the first is the map; the rest are
 * copies. `known` is the list of boards the window already has, which
 * saves reading it again. */
export async function mapsOf(client: Pick<VaultClient, "boards" | "boardsWith">, note: Pick<NoteMeta, "id" | "path" | "title">, known?: readonly BoardInfo[]): Promise<BoardInfo[]> {
  const boards = known ?? (await client.boards());
  const keys = new Set([mapKey(note), note.path]);
  const newest = (a: BoardInfo, b: BoardInfo) => b.modified - a.modified || b.path.localeCompare(a.path);
  const named = boards.filter((b) => b.source !== undefined && keys.has(b.source)).sort(newest);
  // Boards from before maps knew their page: the same title, showing the page.
  const title = mapTitle(note);
  const likely = boards.filter((b) => b.source === undefined && b.title === title);
  let older: BoardInfo[] = [];
  if (likely.length > 0) {
    const showing = new Set((await client.boardsWith(note.path)).map((b) => b.path));
    older = likely.filter((b) => showing.has(b.path)).sort(newest);
  }
  return [...named, ...older];
}

/** Makes the page's map as a new board; its path. */
async function makeMap(client: Client, note: NoteMeta): Promise<string> {
  const outline = await readPage(client, note);
  if (outline.tree.length === 0) throw new Error(`“${note.title}” has no headings or lists to map`);
  const path = await client.createBoard(mapTitle(note), note.project);
  const { board } = await client.boardApply(path, [{ kind: "card", path: note.path, x: 0, y: 0 }]);
  const plan = planSync(board, note, outline);
  if (!plan || !(await applySync(board, plan, sendTo(client, path)))) throw new Error(`The map of “${note.title}” could not be made`);
  return path;
}

/** Marks a map made before maps knew their page, from the lines it already has. */
async function adopt(client: Client, path: string, note: NoteMeta): Promise<void> {
  const outline = await readPage(client, note);
  const doc = await client.board(path);
  const plan = planSync(doc, note, outline);
  if (plan) await applySync(doc, plan, sendTo(client, path));
}

export interface OpenedMap {
  path: string;
  /** The map did not exist: it was made now. */
  created: boolean;
  /** Other maps of the page, which are copies of this one. */
  copies: BoardInfo[];
}

async function openMap(client: Client, note: NoteMeta): Promise<OpenedMap> {
  const [best, ...copies] = await mapsOf(client, note);
  if (!best) return { path: await makeMap(client, note), created: true, copies: [] };
  if (best.source === undefined) await adopt(client, best.path, note).catch(() => undefined);
  return { path: best.path, created: false, copies };
}

/** Pages whose map is being found or made right now. */
const asked = new Map<string, Promise<OpenedMap>>();

/** The page's map: the one that exists (the most recently edited if there
 * are several), made only when there is none. Asked twice at once, as a
 * double click does, it is still one map. */
export function findOrMakeMap(client: Client, note: NoteMeta): Promise<OpenedMap> {
  const key = mapKey(note);
  const running = asked.get(key);
  if (running) return running;
  const run = openMap(client, note).finally(() => asked.delete(key));
  asked.set(key, run);
  return run;
}

/** Makes the page's map as a board beside it, or finds the one it has; its path. */
export async function mapFromPage(client: Client, note: NoteMeta): Promise<string> {
  return (await findOrMakeMap(client, note)).path;
}
