// The browser preview's pages inside pages and copies, on MemoryNotes, as
// kasten-core's moving.rs has them: a page goes inside another page, moving
// to that page's project or the library with its sub-pages, or comes out to
// be a page of its own where it is; and a note is copied beside itself.
// A page goes to the trash with its sub-pages and comes back with them, as
// in kasten-core's trash.rs.

import type { NoteFile, NoteMeta, Placed, Trashed } from "../../../lib/vault/types";
import { splitFrontmatter } from "../../pages/markdown/frontmatter";
import { setFrontmatterKey, yamlList } from "../../pages/page/page-meta";
import { arranged } from "../tree-order";
import { relinkBoards } from "./board-extras";
import { eolOf, folderOf, isCard, MemoryNotes, metaFor } from "./memory-notes";
import { newId, slugify, stamps } from "./vault-text";

/** Where `fileNote` puts a note that goes back to the inbox. */
const INBOX = Symbol("inbox");

/** `root` and every sub-page below it. */
function subtree(notes: readonly NoteMeta[], root: NoteMeta): NoteMeta[] {
  const out = [root];
  for (let i = 0; i < out.length; i++) {
    const id = out[i]!.id;
    if (id) out.push(...notes.filter((n) => n.parent === id && !out.some((o) => o.path === n.path)));
  }
  return out;
}

/** For each of one trashing's files, the ones below it: sub-pages whose
 * parent, or parent's parent, went with it. */
function belowIn(metas: readonly (NoteMeta | null)[]): number[][] {
  return metas.map((_, top) => {
    const seen = new Set([top]);
    const queue = [top];
    for (let i = 0; i < queue.length; i++) {
      const id = metas[queue[i]!]?.id;
      if (!id) continue;
      metas.forEach((m, j) => {
        if (m?.parent === id && !seen.has(j)) {
          seen.add(j);
          queue.push(j);
        }
      });
    }
    return queue.slice(1);
  });
}

export class MemoryNesting extends MemoryNotes {
  async move(path: string, project: string | null): Promise<Placed> {
    return this.fileNote(path, project);
  }

  async moveToInbox(path: string): Promise<Placed> {
    return this.fileNote(path, INBOX);
  }

  /** Files a note and its sub-pages in a project, the library or the inbox. */
  private async fileNote(path: string, project: string | null | typeof INBOX): Promise<Placed> {
    const note = this.get(path);
    if (["journal", "project", "template"].includes(note.meta.kind)) throw new Error(`A ${note.meta.kind} note cannot move`);
    if (typeof project === "string" && (slugify(project) !== project || !Object.keys(this.data.files).some((p) => p.startsWith(`projects/${project}/`))))
      throw new Error(`No project called ${project}`);
    const notes = await this.list();
    const tree = [note.meta];
    for (let i = 0; i < tree.length; i++) {
      const id = tree[i]!.id;
      if (id) tree.push(...notes.filter((n) => n.parent === id && !tree.some((t) => t.path === n.path)));
    }
    let root = path;
    const moves: [string, string][] = [];
    for (const item of tree) {
      if (["journal", "project", "template"].includes(item.kind)) continue;
      const dir = project === INBOX ? "inbox" : project === null ? "library" : `projects/${project}/${isCard(item.kind) ? "cards" : "pages"}`;
      if (folderOf(item.path) === dir) continue;
      const stem = item.path.slice(item.path.lastIndexOf("/") + 1).replace(/\.md$/, "");
      const target = this.freePath(dir, stem);
      const file = this.data.files[item.path]!;
      delete this.data.files[item.path];
      this.data.files[target] = file;
      this.carry(item.path, target);
      moves.push([item.path, target]);
      if (item.path === path) root = target;
    }
    // A sub-page moved on its own leaves its parent, when that stays elsewhere.
    const parent = note.meta.parent ? notes.find((n) => n.id === note.meta.parent && n.path !== path) : undefined;
    if (root !== path && parent && folderOf(parent.path) !== folderOf(root)) {
      const file = this.data.files[root]!;
      const { prefix, body } = splitFrontmatter(file.text);
      this.data.files[root] = { ...file, text: setFrontmatterKey(prefix, "parent", null, eolOf(file.text)) + body };
    }
    relinkBoards(this.data.boards, moves);
    const relinked = this.keep(notes, await this.list(), new Map(moves));
    this.persist();
    return { ...this.get(root), moves, relinked };
  }


  /** Moves a note to the trash with every sub-page below it, as one
   * change; answers where the note went. */
  override async trash(path: string): Promise<string> {
    if (!path.endsWith(".md")) return super.trash(path);
    const going = subtree(await this.list(), this.get(path).meta).map((n) => n.path);
    const when = this.freeStamp();
    for (const p of going) {
      this.data.trash[`.trash/${when}/${p}`] = { text: this.get(p).text, when, original: p };
      delete this.data.files[p];
    }
    this.persist();
    return `.trash/${when}/${path}`;
  }

  /** The trash, a sub-page that went with its parent counted in the
   * parent's `inside` rather than listed apart. */
  override async listTrash(): Promise<Trashed[]> {
    const all = await super.listTrash();
    const out: Trashed[] = [];
    for (const when of new Set(all.map((t) => t.when))) {
      const group = all.filter((t) => t.when === when);
      const metas = group.map((t) => (t.original.endsWith(".md") ? metaFor(t.original, this.data.trash[t.trashed]!.text, 0) : null));
      const below = belowIn(metas);
      group.forEach((t, i) => {
        const above = below.flatMap((b, j) => (j !== i && b.includes(i) ? [j] : []));
        if (above.length === 0 || above.every((j) => below[i]!.includes(j))) out.push({ ...t, inside: below[i]!.length });
      });
    }
    return out;
  }

  /** Puts a trashed note back with the sub-pages that went with it. */
  override async restore(trashed: string): Promise<NoteFile> {
    const entry = this.data.trash[trashed];
    if (!entry) return super.restore(trashed);
    const group = Object.keys(this.data.trash).filter((k) => this.data.trash[k]!.when === entry.when && k.endsWith(".md"));
    const metas = group.map((k) => metaFor(this.data.trash[k]!.original, this.data.trash[k]!.text, 0));
    const top = group.indexOf(trashed);
    const note = await super.restore(trashed);
    for (const i of belowIn(metas)[top] ?? []) await super.restore(group[i]!);
    return note;
  }

  async nest(path: string, parent: string | null): Promise<Placed> {
    const note = this.get(path);
    if (!["page", "card"].includes(note.meta.kind) || path.startsWith("templates/")) throw new Error(`A ${note.meta.kind} note cannot go inside a page`);
    if (parent === null) return { ...(note.meta.parent ? this.setParent(path, null) : note), moves: [], relinked: [] };
    const holder = this.get(parent);
    if (holder.meta.kind !== "page" || parent.startsWith("templates/")) throw new Error("Only a page holds pages");
    if (subtree(await this.list(), note.meta).some((n) => n.path === parent)) throw new Error("A page cannot go inside itself or its own sub-page");
    const id = this.parentId(parent);
    const moved = await this.move(path, holder.meta.project);
    return { ...this.setParent(moved.meta.path, id), moves: moved.moves, relinked: moved.relinked };
  }

  /** Stores the sub-pages' order in the page's `children_order`, as
   * kasten-core does: only that key changes, unknown ids drop out, and the
   * sub-pages left out follow alphabetically. */
  async reorderChildren(parent: string, ids: string[]): Promise<NoteFile> {
    const holder = this.get(parent);
    if (holder.meta.kind !== "page" || parent.startsWith("templates/")) throw new Error("Only a page holds pages");
    const kids = (await this.list()).filter((n) => holder.meta.id && n.parent === holder.meta.id && n.path !== parent);
    const sorted = kids.sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
    // No ids at all goes back to alphabetical: the key is taken out.
    const stored =
      ids.length === 0
        ? []
        : arranged(ids, sorted)
            .map((n) => n.id)
            .filter((id): id is string => id !== null);
    const { prefix, body } = splitFrontmatter(holder.text);
    const next = setFrontmatterKey(prefix, "children_order", stored.length > 0 ? yamlList(stored) : null, eolOf(holder.text), true);
    return next === prefix ? holder : this.put(parent, next + body);
  }

  /** Copies a page or card beside itself as "<title> (copy)" with a new id
   * and times; every other key and the body stay byte for byte. */
  async duplicate(path: string): Promise<NoteFile> {
    const note = this.get(path);
    if (["journal", "project", "template"].includes(note.meta.kind)) throw new Error(`A ${note.meta.kind} note cannot be duplicated`);
    const title = `${note.meta.title} (copy)`;
    const eol = eolOf(note.text);
    const { prefix, body } = splitFrontmatter(note.text);
    const stamp = stamps(this.now()).rfc3339;
    let next = prefix;
    for (const [key, value] of [["id", newId(this.now())], ["title", title], ["created", stamp], ["updated", stamp]] as const) next = setFrontmatterKey(next, key, value, eol);
    return this.put(this.freePath(folderOf(path), slugify(title)), next + body);
  }

  /** Sets the note's `parent` key, or takes it out; every other byte stays. */
  private setParent(path: string, id: string | null): NoteFile {
    const file = this.get(path);
    const { prefix, body } = splitFrontmatter(file.text);
    return this.put(path, setFrontmatterKey(prefix, "parent", id, eolOf(file.text)) + body);
  }
}
