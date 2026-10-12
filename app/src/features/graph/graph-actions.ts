// What a click, a double click or a drag on the graph does: open the page where
// the Open menu's rules say, make the page a ghost stands for, make a page
// where the person clicked, or make a page linked from another. Writing goes
// through the vault client (the core's ops), never straight to files.

import type { GraphNode, NoteFile, NoteMeta } from "../../lib/vault/types";
import { linkFor, placeOf } from "../workspace/links";
import type { Opens } from "../workspace/opens";
import { flushOpenPage, filesChanged } from "../workspace/page/open-page";
import { howFrom, howFromName, useWorkspace, type OpenHow } from "../workspace/store";
import { noteAt } from "../workspace/tree";
import type { Keys } from "./controller";
import type { GraphOpens } from "./graph-prefs";

/** Where a plain click opens: the choice made in the graph, or with `auto` the way Settings opens links, and to the right when that is the same tab. */
export function plainOpens(setting: GraphOpens, pageLinks: Opens): Opens {
  if (setting !== "auto") return setting;
  return pageLinks === "here" ? "right" : pageLinks;
}

/** Where a click opens: a key says (Ctrl a tab, Alt a split pane, Shift the side stack, Ctrl and Alt the pane to the right), else the plain way. */
export function howToOpen(keys: Pick<Keys, "ctrlKey" | "metaKey" | "shiftKey" | "altKey" | "button">, setting: GraphOpens, pageLinks: Opens): OpenHow {
  const how = howFrom(keys);
  return how === "here" ? howFromName(plainOpens(setting, pageLinks)) : how;
}

/** A missing page's title as the page is made: the index keeps links in lower case. */
export const ghostTitle = (title: string): string => title.charAt(0).toUpperCase() + title.slice(1);

const toast = (text: string) => useWorkspace.getState().toast(text);
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The project a missing page should be made in: the one its linking pages are in, else `fallback`. */
export function projectForGhost(linkedFrom: readonly (GraphNode | undefined)[], fallback: string | null): string | null {
  const found = linkedFrom.find((n) => n?.project);
  return found?.project ?? fallback;
}

/** Makes the page a ghost stands for, without opening it. */
export async function makeGhost(node: GraphNode, project: string | null): Promise<NoteFile | null> {
  return useWorkspace.getState().create({ kind: "page", title: ghostTitle(node.title), project }, false);
}

/** Opens what a node stands for; a ghost is made first. */
export async function openNode(node: GraphNode, how: OpenHow, project: string | null = null): Promise<void> {
  const { openPath } = useWorkspace.getState();
  if (node.kind === "ghost") {
    const made = await makeGhost(node, project);
    if (made) openPath(made.meta.path, how);
    return;
  }
  if (node.path) openPath(node.path, how);
}

/** A new, empty page for a double click on empty space. */
export async function makePage(project: string | null): Promise<NoteFile | null> {
  return useWorkspace.getState().create({ kind: "page", title: "Untitled", project }, false);
}

/** Makes a page and links it from `source` (a `[[link]]` added to the end of it), for a drag from a node to empty space. Resolves to the new page, or null (and says why). */
export async function makeLinkedPage(source: GraphNode, project: string | null): Promise<NoteFile | null> {
  const path = source.path;
  if (!path || !path.endsWith(".md") || source.kind === "ghost") {
    toast("Only a page can link to a new page. Make the missing page first, or drag from a page.");
    return null;
  }
  const state = useWorkspace.getState();
  const from: NoteMeta | undefined = noteAt(state.notes, path);
  if (!state.client || !from) return null;
  const made = await state.create({ kind: "page", title: "Untitled", project: source.project ?? project }, false);
  if (!made) return null;
  try {
    await flushOpenPage();
    // By title where that finds the new page, by path where another page shares it.
    const link = linkFor(made.meta, useWorkspace.getState().notes, placeOf(from));
    const saved = await state.client.append(path, link);
    useWorkspace.getState().noteChanged(saved.meta);
    filesChanged([path]);
  } catch (err) {
    toast(`The page was made, but linking it from “${from.title}” failed: ${message(err)}`);
  }
  return made;
}
