// The browser preview's part for saved collections (the client's collection
// calls, `CollectionOps`) and for finding a page that is already saved. Inside
// the app the core does these (engine/collections.rs, clip/dedupe.rs); here the
// collection files are texts kept with the rest of the preview's data.

import { frontUrl, urlKey } from "../../../lib/url-key";
import { MAX_TAGGED, type ClipOutcome, type Collection, type CollectionEdits, type TagAdded } from "../../../lib/vault/collection-types";
import type { NoteMeta, Trashed } from "../../../lib/vault/types";
import { splitFrontmatter } from "../../pages/markdown/frontmatter";
import { setFrontmatterKey, yamlList } from "../../pages/page/page-meta";
import { checkName, editCollectionText, isCollectionPath, newCollectionText, readCollection, slugOf } from "./collection-text";
import { MemoryProjects } from "./memory-projects";
import { eolOf } from "./memory-notes";
import { sign, type Signs } from "./memory-revision";
import { setValue } from "./tag-yaml";

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "") || "untitled";

export class MemoryCollections extends MemoryProjects {
  protected override revisionSigns(): Signs {
    return { ...super.revisionSigns(), collections: sign(this.data.views) };
  }

  /** The collection files by path (made when first written). */
  private viewFiles(): Record<string, string> {
    return (this.data.views ??= {});
  }

  private viewText(path: string): string {
    const text = isCollectionPath(path) ? this.viewFiles()[path] : undefined;
    if (text === undefined) throw new Error(`No collection at ${path}`);
    return text;
  }

  private viewLoad(path: string): Collection {
    // The preview keeps no file times for these.
    return readCollection(path, this.viewText(path), 0);
  }

  private viewFree(slug: string): string {
    for (let n = 1; ; n++) {
      const path = `views/${n === 1 ? slug : `${slug}-${n}`}.yaml`;
      if (this.viewFiles()[path] === undefined) return path;
    }
  }

  /** The text and collection to change, if the file is still as `baseHash` says and can be edited. */
  private viewWritable(path: string, baseHash: string): { text: string; found: Collection } {
    const text = this.viewText(path);
    const found = readCollection(path, text, 0);
    if (found.problem) throw new Error(found.problem);
    if (found.hash !== baseHash) throw new Error("This collection changed since you opened it. Open it again and make the change once more");
    return { text, found };
  }

  async collections(): Promise<Collection[]> {
    return Object.keys(this.viewFiles())
      .filter(isCollectionPath)
      .map((path) => this.viewLoad(path))
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.slug.localeCompare(b.slug));
  }

  async collection(path: string): Promise<Collection> {
    return this.viewLoad(path);
  }

  async createCollection(name: string, edits: CollectionEdits = {}): Promise<Collection> {
    const text = newCollectionText(name, edits);
    const path = this.viewFree(slugify(checkName(name)));
    this.viewFiles()[path] = text;
    this.persist();
    return this.viewLoad(path);
  }

  async updateCollection(path: string, edits: CollectionEdits, baseHash: string): Promise<Collection> {
    const { text, found } = this.viewWritable(path, baseHash);
    const edited = editCollectionText(text, edits);
    if (edited === text) return found;
    const next = readCollection(path, edited, 0);
    if (next.problem) throw new Error(next.problem);
    this.viewFiles()[path] = edited;
    this.persist();
    return this.viewLoad(path);
  }

  async renameCollection(path: string, name: string, baseHash: string): Promise<Collection> {
    const { text } = this.viewWritable(path, baseHash);
    const trimmed = checkName(name);
    const renamed = setValue(text, "name", trimmed);
    const slug = slugify(trimmed);
    const stem = slugOf(path);
    // Its own file name, numbered or not, is free to it.
    const target = stem === slug || new RegExp(`^${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-\\d+$`).test(stem) ? path : this.viewFree(slug);
    delete this.viewFiles()[path];
    this.viewFiles()[target] = renamed;
    this.persist();
    return this.viewLoad(target);
  }

  async trashCollection(path: string): Promise<string> {
    const text = this.viewText(path);
    const when = this.freeStamp();
    const trashed = `.trash/${when}/${path}`;
    this.data.trash[trashed] = { text, when, original: path };
    delete this.viewFiles()[path];
    this.persist();
    return trashed;
  }

  async restoreCollection(trashed: string): Promise<Collection> {
    const entry = this.data.trash[trashed];
    if (!entry || !isCollectionPath(entry.original)) throw new Error(`No collection at ${trashed}`);
    const path = this.viewFiles()[entry.original] === undefined ? entry.original : this.viewFree(slugOf(entry.original));
    delete this.data.trash[trashed];
    this.viewFiles()[path] = entry.text;
    this.persist();
    return this.viewLoad(path);
  }

  /** A collection in the trash is listed by its name. */
  override async listTrash(): Promise<Trashed[]> {
    const listed = await super.listTrash();
    return listed.map((item) => (isCollectionPath(item.original) ? { ...item, title: readCollection(item.original, this.data.trash[item.trashed]?.text ?? "", 0).name } : item));
  }

  async capturedFrom(url: string): Promise<NoteMeta[]> {
    const key = urlKey(url);
    if (key === null) return [];
    return (await this.list())
      .filter((note) => note.kind !== "template" && (urlKey(frontUrl(this.data.files[note.path]?.text ?? "") ?? "") === key || urlKey(String(note.props.url ?? "")) === key))
      .sort((a, b) => (a.created ?? "").localeCompare(b.created ?? "") || Number("snapshot_of" in a.props) - Number("snapshot_of" in b.props) || a.path.localeCompare(b.path));
  }

  async clipPage(_url: string, _again?: boolean): Promise<ClipOutcome> {
    throw new Error("Clipping a page needs the desktop app");
  }

  async addTagToMany(paths: string[], tag: string): Promise<TagAdded> {
    const clean = tag.trim().replace(/^#+/, "").trim();
    if (!/^[\p{L}\p{N}_\-/]{1,40}$/u.test(clean)) throw new Error(`“${clean.slice(0, 40)}” cannot be a tag: tags are letters, digits, dashes, underscores and slashes, up to 40 characters`);
    const unique = [...new Set(paths)];
    if (unique.length === 0) throw new Error("Name at least one page to tag");
    if (unique.length > MAX_TAGGED) throw new Error(`Tag at most ${MAX_TAGGED} pages at a time`);
    // Every page is read before any is written, so a missing one refuses the whole.
    const notes = unique.map((path) => this.get(path));
    const changed: NoteMeta[] = [];
    const already: string[] = [];
    for (const note of notes) {
      if (note.meta.tags.some((t) => t.toLowerCase() === clean.toLowerCase())) {
        already.push(note.meta.path);
        continue;
      }
      const { prefix, body } = splitFrontmatter(note.text);
      changed.push(this.put(note.meta.path, setFrontmatterKey(prefix, "tags", yamlList([...note.meta.tags, clean]), eolOf(note.text), true) + body).meta);
    }
    return { tag: clean, changed, already, commit: null };
  }
}
