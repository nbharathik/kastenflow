// Putting pages into a tag's database: dropping them on it, or "Add existing
// pages". A page joins by gaining the tag; it is not moved, and no other
// property is touched. All of them are one change, with one Undo. A page that
// the view's own filters then hide is said so, and can be revealed without
// changing anything on it.

import type { TagAdded } from "../../lib/vault/collection-types";
import type { NoteMeta, TagSchema, TagView, VaultClient } from "../../lib/vault/types";
import { titleOf } from "../workspace/names";
import { useWorkspace } from "../workspace/store";
import { applyView, notesWith, scoped } from "./model";

/** Where the pages are going: the view they should show up in. */
export interface Destination {
  tag: string;
  view: TagView;
  schema: TagSchema | null;
  /** The project folder a view saved for one project looks in. */
  folder: string | null;
  /** Shows these pages in the view although its filters hide them. */
  reveal?(paths: readonly string[]): void;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Takes an addition back: its one commit, else the tag off each page. */
export async function undoAdded(client: VaultClient, added: TagAdded): Promise<void> {
  const { noteChanged, refresh, toast } = useWorkspace.getState();
  if (added.commit) {
    const undone = await client.undoCommit(added.commit);
    // A page changed since is left as it is, and said so.
    if (undone.conflict) toast(`Not undone: ${undone.conflict.path} changed since (${undone.conflict.detail.toLowerCase()})`);
    await refresh();
    return;
  }
  for (const note of added.changed) noteChanged((await client.setTags(note.path, [], [added.tag])).meta);
}

/** The pages among `changed` that the view does not list now that they carry the tag. */
export function hiddenBy(changed: readonly NoteMeta[], destination: Destination, notes: readonly NoteMeta[]): string[] {
  const listed = new Set(applyView(scoped(notesWith(notes, destination.tag), destination.view, destination.folder), destination.view, destination.schema).map((n) => n.path));
  return changed.filter((n) => !listed.has(n.path)).map((n) => n.path);
}

/** Adds the tag to the pages at `paths` (pages only: a board or a PDF dropped with them is left out). Null when nothing could be done, which is toasted. */
export async function addPagesToTag(paths: readonly string[], destination: Destination): Promise<TagAdded | null> {
  const { client, noteChanged, toast } = useWorkspace.getState();
  const pages = [...new Set(paths.filter((p) => p.endsWith(".md")))];
  if (!client || pages.length === 0) return null;
  let added: TagAdded;
  try {
    added = await client.addTagToMany(pages, destination.tag);
  } catch (err) {
    toast(message(err));
    return null;
  }
  for (const note of added.changed) noteChanged(note);
  const { tag } = destination;
  if (added.changed.length === 0) {
    toast(added.already.length === 1 ? `That page is already in #${tag}` : `Those pages are already in #${tag}`);
    return added;
  }
  const had = added.already.length > 0 ? `, ${added.already.length} already had it` : "";
  const first = added.changed.length === 1 ? `“${titleOf(added.changed[0]!)}”` : plural(added.changed.length, "page");
  toast(`Added ${first} to #${tag}${had}`, { label: "Undo", run: () => void undoAdded(client, added).catch((err: unknown) => toast(message(err))) });
  const hidden = hiddenBy(added.changed, destination, useWorkspace.getState().notes);
  if (hidden.length > 0) {
    toast(`${plural(hidden.length, "added page")} ${hidden.length === 1 ? "is" : "are"} hidden by this view’s filters`, destination.reveal ? { label: "Reveal", run: () => destination.reveal!(hidden) } : undefined);
  }
  return added;
}
