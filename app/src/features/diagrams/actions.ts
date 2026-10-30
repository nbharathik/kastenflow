// What a person does with diagrams, as the Diagrams view, the editor's menu
// and the palette ask for it: each is one call to the core's op and what
// follows (open tabs, the list, favourites, the notice). The core keeps the
// two files together and the links in order; nothing here writes a file.

import type { VaultClient } from "../../lib/vault/types";
import { pluginOff, turnPluginOn } from "../../plugins/off";
import { usePrefs } from "../workspace/prefs";
import { flushOpenPage, reloadOpenPage } from "../workspace/page/open-page";
import { useWorkspace, type OpenHow } from "../workspace/store";
import { stemOfTitle, titleOfPath, validTitle } from "./names";
import { diagramChanged, useDiagrams } from "./store";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Runs a vault call, showing its error as a notice instead of throwing. */
async function attempt<T>(run: (client: VaultClient) => Promise<T>): Promise<T | null> {
  const client = useWorkspace.getState().client;
  if (!client) return null;
  try {
    return await run(client);
  } catch (err) {
    useWorkspace.getState().toast(message(err));
    return null;
  }
}

/** Makes a diagram, in `project` or the library, and opens its editor at once (`template`: with the editor's own template dialog). */
export async function newDiagram(options: { project?: string | null; template?: boolean; title?: string; how?: OpenHow } = {}): Promise<string | null> {
  // With draw.io off there is nothing to draw it with: say so instead of leaving a diagram nobody can open.
  if (pluginOff("diagrams")) {
    useWorkspace.getState().toast("Turn on the draw.io plugin to make a diagram", { label: "Turn on", run: () => void turnPluginOn("diagrams") });
    return null;
  }
  const path = await attempt((c) => c.createDiagram(options.title ?? "Untitled diagram", options.project ?? null));
  if (!path) return null;
  diagramChanged(path);
  if (options.template) useDiagrams.setState({ templateFor: path });
  useWorkspace.getState().openPath(path, options.how);
  return path;
}

/** Follows the moves an op made in open tabs, favourites and recent places, and reloads the pages whose links it rewrote. */
function follow(moves: readonly (readonly [string, string])[], relinked: readonly string[]): void {
  const ws = useWorkspace.getState();
  const map = new Map(moves.map(([from, to]) => [from, to] as [string, string]));
  for (const [from, to] of map) usePrefs.getState().moveFavourite(from, to);
  ws.followMoves(map);
  for (const path of relinked) reloadOpenPage(path);
}

/** A new title: both files take the name, and every embed, link and card that named the file follows. */
export async function renameDiagram(path: string, title: string): Promise<string | null> {
  if (!validTitle(title)) {
    useWorkspace.getState().toast("A title needs some text and no [ ] or | characters");
    return null;
  }
  if (stemOfTitle(title.trim()) === stemOfTitleOfPath(path)) return path;
  const was = titleOfPath(path);
  await flushOpenPage();
  const moved = await attempt((c) => c.renameDiagram(path, title));
  if (!moved) return null;
  follow(moved.moves, moved.relinked);
  diagramChanged(path);
  diagramChanged(moved.path);
  useWorkspace.getState().toast(`Renamed “${was}” to “${titleOfPath(moved.path)}”`, { label: "Undo", run: () => void renameDiagram(moved.path, was) });
  return moved.path;
}

const stemOfTitleOfPath = (path: string) => stemOfTitle(titleOfPath(path));

/** Moves a diagram to a project folder, or with null to the library. */
export async function moveDiagram(path: string, project: string | null, where: string): Promise<string | null> {
  await flushOpenPage();
  const moved = await attempt((c) => c.moveDiagram(path, project));
  if (!moved) return null;
  follow(moved.moves, moved.relinked);
  diagramChanged(path);
  diagramChanged(moved.path);
  if (moved.moves.length > 0) useWorkspace.getState().toast(`Moved “${titleOfPath(moved.path)}” to ${where}`);
  return moved.path;
}

/** Copies a diagram beside itself and opens the copy. */
export async function duplicateDiagram(path: string): Promise<string | null> {
  await flushOpenPage();
  const copy = await attempt((c) => c.duplicateDiagram(path));
  if (!copy) return null;
  diagramChanged(copy);
  useWorkspace.getState().openPath(copy);
  return copy;
}

/** Imports files made elsewhere (`.drawio`, `.xml`, `.drawio.svg`, a PNG the editor made) as diagrams; says what came in. */
export async function importDiagrams(files: readonly File[], project: string | null): Promise<string[]> {
  const made: string[] = [];
  for (const file of files) {
    const path = await attempt(async (c) => c.importDiagram(file.name, new Uint8Array(await file.arrayBuffer()), project));
    if (path) made.push(path);
  }
  if (made.length > 0) {
    for (const path of made) diagramChanged(path);
    useWorkspace.getState().toast(made.length === 1 ? `Imported “${titleOfPath(made[0]!)}”` : `Imported ${made.length} diagrams`, { label: "Open", run: () => useWorkspace.getState().openPath(made[0]!) });
  }
  return made;
}

/** The file types the import takes. */
export const IMPORT_ACCEPT = ".drawio,.xml,.svg,.png";
