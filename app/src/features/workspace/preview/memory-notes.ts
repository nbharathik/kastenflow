// The browser preview's notes: the same note ops as kasten-core, on files
// held in memory and, optionally, this browser's storage. It exists so the
// app can be tried without Tauri; inside the app every write goes through
// the core. The classes built on it add nesting (memory-nesting.ts), boards,
// history and agents (memory-agents.ts), sources and the rest (memory-vault.ts).

import { bodyUnder, splitFrontmatter } from "../../pages/markdown/frontmatter";
import { setFrontmatterKey } from "../../pages/page/page-meta";
import type { Backlink, Hit, MetaField, NewNote, NoteFile, NoteMeta, Renamed, Saved, Trashed } from "../../../lib/vault/types";
import { isLayoutKey, LAYOUT_VALUES } from "../page/page-layout";
import { dayAndTime, fillTemplate } from "../../templates/template-vars";
import { relinkBoards } from "./board-extras";
import { isOldJournalTemplate } from "./journal-template";
import { merge3 } from "./merge";
import { metaFor } from "./note-meta";
import { readStored, type PreviewStorage, type Stored } from "./stored";
import { titleKey } from "../links";
import { backlinksIn, keepInFiles } from "./keep-links";
import { contentHash, followsTitle, keyBlocks, newId, slugify, stamps, wikiLinks } from "./vault-text";

export type { PreviewStorage, Stored, Version } from "./stored";

export { metaFor };

const HEADER_KEYS = ["title", "icon", "cover"];
/** Texts kept by hash, as merge bases (the core keeps 64). */
const MAX_BASES = 64;
const OWN_KEYS = ["id", "title", "type", "created", "updated", "parent", "icon", "cover"];
export const eolOf = (text: string) => (text.includes("\r\n") ? "\r\n" : "\n");
/** Cards and highlight cards file into a project's cards/, and the inbox. */
export const isCard = (kind: string) => kind === "card" || kind === "highlight";
export const folderOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

export class MemoryNotes {
  readonly kind = "preview";
  readonly label = "Browser preview";
  readonly kept: "browser" | "memory";
  protected data: Stored;
  private readonly bases = new Map<string, string>();
  /** Journal days being made, by date. */
  private readonly makingDays = new Map<string, Promise<NoteFile>>();
  private readonly metas = new WeakMap<object, NoteMeta>();
  private readonly links = new WeakMap<object, Set<string>>();
  private readonly starters: Record<string, string>;
  /** The `.bib` files the preview started with, by path: the bibliography its decks cite from. They are samples, so they are not saved with the vault. */
  protected readonly bibFiles: Record<string, string>;

  constructor(
    seed: Record<string, string>,
    private readonly storage?: PreviewStorage,
    protected readonly now: () => number = Date.now,
  ) {
    this.kept = storage ? "browser" : "memory";
    const saved = storage?.load();
    const parsed = readStored(saved);
    const pick = (test: (path: string) => boolean) => Object.entries(seed).filter(([p]) => test(p));
    // The samples' templates are the starter set a saved preview may lack.
    this.starters = Object.fromEntries(pick((p) => p.startsWith("templates/") && p.endsWith(".md")));
    this.bibFiles = Object.fromEntries(pick((p) => p.endsWith(".bib") && !p.split("/").some((part) => part.startsWith("."))).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    this.data = parsed ?? {
      files: Object.fromEntries(pick((p) => p.endsWith(".md")).map(([p, text]) => [p, { text, modified: now() }])),
      trash: {},
      boards: Object.fromEntries(pick((p) => p.endsWith(".canvas"))),
      decks: Object.fromEntries(pick((p) => p.endsWith(".deck"))),
      tags: Object.fromEntries(pick((p) => p.startsWith("tags/") && p.endsWith(".yaml"))),
    };
  }

  protected persist(): void {
    this.storage?.save(JSON.stringify(this.data));
  }

  protected get(path: string): NoteFile {
    const file = this.data.files[path];
    if (!file) throw new Error(`No note at ${path}`);
    return { meta: metaFor(path, file.text, file.modified), text: file.text, hash: contentHash(file.text) };
  }

  protected put(path: string, text: string): NoteFile {
    this.data.files[path] = { text, modified: this.now() };
    this.persist();
    return this.remember(this.get(path));
  }

  /** Keeps a text a save may name as its base. */
  private remember(note: NoteFile): NoteFile {
    this.bases.delete(note.hash);
    this.bases.set(note.hash, note.text);
    if (this.bases.size > MAX_BASES) this.bases.delete(this.bases.keys().next().value!);
    return note;
  }

  protected freePath(dir: string, name: string): string {
    for (let n = 1; ; n++) {
      const file = n === 1 ? `${name}.md` : `${name}-${n}.md`;
      const candidate = dir ? `${dir}/${file}` : file;
      if (!this.data.files[candidate]) return candidate;
    }
  }

  async list(): Promise<NoteMeta[]> {
    return Object.keys(this.data.files)
      .sort()
      .map((path) => this.metaOf(path));
  }

  async missingTemplates(): Promise<string[]> {
    return Object.keys(this.starters)
      .filter((path) => !this.data.files[path])
      .sort()
      .map((path) => path.slice("templates/".length, -".md".length));
  }

  async addStarterTemplates(): Promise<string[]> {
    const added = (await this.missingTemplates()).map((name) => `templates/${name}.md`);
    for (const path of added) this.put(path, this.starters[path]!);
    return added;
  }

  async addTour(): Promise<string> {
    const path = "library/welcome-to-kasten.md";
    if (!this.data.files[path]) {
      const tour = await import("../../../../../crates/kasten-core/defaults/welcome.md?raw");
      this.put(path, tour.default);
    }
    return path;
  }

  async notesAt(paths: string[]): Promise<NoteMeta[]> {
    return paths.filter((path) => path.endsWith(".md") && this.data.files[path]).map((path) => this.metaOf(path));
  }

  /** A note's metadata, parsed once per version of its file (the core
   * answers from its index; this keeps the preview about as quick). */
  protected metaOf(path: string): NoteMeta {
    const file = this.data.files[path]!;
    const known = this.metas.get(file);
    if (known?.path === path) return known;
    const meta = metaFor(path, file.text, file.modified);
    this.metas.set(file, meta);
    return meta;
  }

  async read(path: string): Promise<NoteFile> {
    return this.remember(this.get(path));
  }

  async create(note: NewNote): Promise<NoteFile> {
    const day = dayAndTime(note.date)?.day;
    if (!day) throw new Error(`Not a day: ${note.date}`);
    const title = note.kind === "journal" ? day : note.title.trim();
    const project = note.project ? slugify(note.project) : null;
    let path: string;
    if (note.kind === "journal") path = `journal/${day.slice(0, 4)}/${day}.md`;
    else if (note.kind === "project") {
      let folder = slugify(title);
      for (let n = 2; Object.keys(this.data.files).some((p) => p.startsWith(`projects/${folder}/`)); n++) folder = `${slugify(title)}-${n}`;
      path = `projects/${folder}/_project.md`;
    } else if (note.parent) path = this.freePath(folderOf(note.parent), slugify(title));
    else if (project) path = this.freePath(`projects/${project}/${isCard(note.kind) ? "cards" : "pages"}`, slugify(title));
    else path = this.freePath(isCard(note.kind) ? "inbox" : "library", slugify(title));
    if (this.data.files[path]) return this.get(path);

    const template = note.template ? this.get(`templates/${slugify(note.template)}.md`).text : "";
    const text = fillTemplate(template, title, note.date, project ?? "", new Date(this.now()));
    const { prefix: start, body } = splitFrontmatter(text);
    const eol = eolOf(text);
    const stamp = stamps(this.now()).rfc3339;
    let prefix = start;
    const parent = note.parent ? this.parentId(note.parent) : null;
    const fields: [string, string | null][] = [
      ["id", newId(this.now())],
      ["title", title],
      ["type", note.kind],
      ["created", stamp],
      ["updated", stamp],
      ["parent", parent],
      ["icon", note.icon?.trim() ? note.icon : null],
    ];
    for (const [key, value] of fields) if (value !== null) prefix = setFrontmatterKey(prefix, key, value, eol);
    // A title in use may take other notes' links: they keep going where they went.
    const listed = await this.list();
    const before = listed.some((n) => n.kind !== "template" && titleKey(n.title) === titleKey(title)) ? listed : null;
    // A body given replaces the template's, as the core's create does.
    const given = note.body ?? "";
    const content = given.trim() === "" ? body : given.endsWith("\n") ? given : `${given}${eol}`;
    const made = this.put(path, prefix + content);
    if (before) this.keep(before, await this.list());
    return this.get(made.meta.path);
  }

  protected parentId(path: string): string {
    const parent = this.get(path);
    if (parent.meta.id) return parent.meta.id;
    const id = newId(this.now());
    const { prefix, body } = splitFrontmatter(parent.text);
    this.put(path, setFrontmatterKey(prefix, "id", id, eolOf(parent.text)) + body);
    return id;
  }

  async saveBody(path: string, body: string, baseHash: string): Promise<Saved> {
    const current = this.get(path);
    const parts = splitFrontmatter(current.text);
    // `updated` goes only into frontmatter that is there, not a byte order mark alone.
    const fenced = parts.prefix.replace(/^\uFEFF/, "") !== "";
    const write = (text: string) => this.put(path, (fenced ? setFrontmatterKey(parts.prefix, "updated", stamps(this.now()).rfc3339, eolOf(current.text)) : parts.prefix) + bodyUnder(parts.prefix, text));
    if (current.hash !== baseHash) {
      const base = this.bases.get(baseHash);
      const merged = base === undefined ? null : merge3(splitFrontmatter(base).body, body, parts.body);
      if (merged === null) return { status: "conflict", copy: this.conflictCopy(current, body), note: current };
      return { status: "merged", note: merged === parts.body ? current : write(merged) };
    }
    if (parts.body === bodyUnder(parts.prefix, body)) return { status: "unchanged", note: current };
    return { status: "written", note: write(body) };
  }

  private conflictCopy(current: NoteFile, body: string): string {
    const stem = current.meta.path.replace(/\.md$/, "");
    const label = `conflict ${stamps(this.now()).file}`;
    let path = `${stem} (${label}).md`;
    for (let n = 2; this.data.files[path]; n++) path = `${stem} (${label} ${n}).md`;
    const eol = eolOf(current.text);
    let { prefix } = splitFrontmatter(current.text);
    if (prefix) {
      prefix = setFrontmatterKey(prefix, "title", `${current.meta.title} (${label})`, eol);
      if (current.meta.id) prefix = setFrontmatterKey(prefix, "id", newId(this.now()), eol);
    }
    this.put(path, prefix + body);
    return path;
  }

  async setMeta(path: string, key: MetaField, value: string | null): Promise<NoteFile> {
    const layout = key === "locked" ? ["true"] : isLayoutKey(key) ? (LAYOUT_VALUES[key] as readonly string[]) : null;
    if (!HEADER_KEYS.includes(key) && !layout) throw new Error(`The page header cannot change \`${key}\``);
    if (layout && value !== null && !layout.includes(value)) throw new Error(`A page's ${key} is one of: ${layout.join(", ")}`);
    const current = this.get(path);
    const { prefix, body } = splitFrontmatter(current.text);
    const eol = eolOf(current.text);
    // The lock is a YAML boolean, `locked: true`, as the desktop writes it.
    const next = setFrontmatterKey(setFrontmatterKey(prefix, key, value, eol, key === "locked"), "updated", stamps(this.now()).rfc3339, eol);
    return this.put(path, next + body);
  }

  async rename(path: string, title: string): Promise<Renamed> {
    const name = title.trim();
    if (!name || /[[\]|\n\r]/.test(name)) throw new Error("A title needs some text and no [ ] or | characters");
    const current = this.get(path);
    if (current.meta.kind === "journal") throw new Error("Journal days are named by their date");
    const old = current.meta.title;
    if (old === name) return { note: current, relinked: [] };
    const before = await this.list();
    const { prefix, body } = splitFrontmatter(current.text);
    const eol = eolOf(current.text);
    const text = setFrontmatterKey(setFrontmatterKey(prefix, "title", name, eol), "updated", stamps(this.now()).rfc3339, eol) + body;
    const file = path.slice(path.lastIndexOf("/") + 1);
    const stem = file.replace(/\.md$/, "");
    let target = path;
    if (file !== "_project.md" && followsTitle(stem, old) && slugify(name) !== stem) target = this.freePath(folderOf(path), slugify(name));
    delete this.data.files[path];
    if (target !== path) this.carry(path, target);
    this.put(target, text);
    relinkBoards(this.data.boards, [[path, target]]);
    // Every link that went to a note keeps going there.
    const moved = new Map(target === path ? [] : [[path, target]]);
    const relinked = this.keep(before, await this.list(), moved).filter((p) => p !== target);
    return { note: this.get(target), relinked };
  }

  /** Keeps links going where they went across an op; the paths written. */
  protected keep(before: readonly NoteMeta[], after: readonly NoteMeta[], moved?: ReadonlyMap<string, string>): string[] {
    return keepInFiles((p) => this.data.files[p]?.text, (p, text) => void this.put(p, text), before, after, moved);
  }

  /** Called as a note's file moves from `from` to `to`, before anything is
   * written there; MemoryAgents takes its versions along. */
  protected carry(_from: string, _to: string): void {}

  /** A trash folder's stamp no trashing has used, as the core's is. */
  protected freeStamp(): string {
    const used = new Set(Object.values(this.data.trash).map((t) => t.when));
    let when = stamps(this.now()).compact;
    for (let n = 2; used.has(when); n++) when = `${stamps(this.now()).compact}-${n}`;
    return when;
  }

  async trash(path: string): Promise<string> {
    const current = this.get(path);
    const when = this.freeStamp();
    const trashed = `.trash/${when}/${path}`;
    this.data.trash[trashed] = { text: current.text, when, original: path };
    delete this.data.files[path];
    this.persist();
    return trashed;
  }

  async journal(date: string): Promise<NoteFile> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Not a day: ${date}`);
    const path = `journal/${date.slice(0, 4)}/${date}.md`;
    if (this.data.files[path]) return this.get(path);
    // Two openings at once make one day, as the core's write lock has it.
    const making = this.makingDays.get(date);
    if (making) return making;
    // The old default template's two headings stay out, as in the core.
    const saved = this.data.files["templates/journal.md"];
    // The template chosen in Settings, while the vault has it.
    const chosen = slugify(this.data.config?.journal_template?.trim() ?? "");
    const template = chosen && this.data.files[`templates/${chosen}.md`] ? chosen : saved && !isOldJournalTemplate(saved.text) ? "journal" : null;
    const made = this.create({ kind: "journal", title: date, date, template }).finally(() => this.makingDays.delete(date));
    this.makingDays.set(date, made);
    return made;
  }

  async applyTemplate(path: string, template: string, date: string): Promise<NoteFile> {
    const current = this.get(path);
    const parts = splitFrontmatter(current.text);
    if (parts.body.trim()) throw new Error("Templates only start empty pages");
    if (!dayAndTime(date)) throw new Error(`Not a day: ${date}`);
    const source = fillTemplate(this.get(`templates/${slugify(template)}.md`).text, current.meta.title, date, current.meta.project ?? "", new Date(this.now()));
    const templateParts = splitFrontmatter(source);
    const eol = eolOf(current.text);
    const have = new Set(keyBlocks(parts.prefix).map(([key]) => key));
    const extra = keyBlocks(templateParts.prefix).filter(([key]) => !OWN_KEYS.includes(key) && !have.has(key));
    let prefix = parts.prefix;
    if (extra.length > 0) {
      const text = extra.map(([, block]) => (block.endsWith("\n") ? block : block + eol)).join("");
      const close = prefix.replace(/[\r\n]+$/, "").lastIndexOf("\n") + 1;
      prefix = prefix ? prefix.slice(0, close) + text + prefix.slice(close) : `---${eol}${text}---${eol}`;
    }
    prefix = setFrontmatterKey(prefix, "updated", stamps(this.now()).rfc3339, eol);
    return this.put(path, prefix + templateParts.body);
  }

  async search(query: string, limit = 20): Promise<Hit[]> {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const hits: Hit[] = [];
    for (const meta of await this.list()) {
      if (meta.kind === "template") continue;
      const title = meta.title.toLowerCase();
      let score = title === needle ? 300 : title.startsWith(needle) ? 200 : title.includes(needle) ? 100 : 0;
      const body = splitFrontmatter(this.data.files[meta.path]!.text).body;
      const at = body.toLowerCase().indexOf(needle);
      let snippet = "";
      if (at >= 0) {
        score += Math.min(50, body.toLowerCase().split(needle).length - 1);
        const start = Math.max(0, at - 60);
        const end = Math.min(body.length, at + needle.length + 60);
        snippet = `${start > 0 ? "…" : ""}${body.slice(start, end).split(/\s+/).join(" ").trim()}${end < body.length ? "…" : ""}`;
      }
      if (score > 0) hits.push({ path: meta.path, title: meta.title, icon: meta.icon, snippet, score });
    }
    return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
  }

  /** The lower-cased titles a note links to, once per version of its file. */
  protected linksOf(path: string): Set<string> {
    const file = this.data.files[path]!;
    let found = this.links.get(file);
    if (!found) {
      found = new Set(wikiLinks(splitFrontmatter(file.text).body).map((t) => t.toLowerCase()));
      this.links.set(file, found);
    }
    return found;
  }

  /** Notes whose links go to the note at `path`. */
  async backlinks(path: string): Promise<Backlink[]> {
    return backlinksIn(await this.list(), path, (p) => splitFrontmatter(this.data.files[p]!.text).body, (p) => this.linksOf(p));
  }

  async listTrash(): Promise<Trashed[]> {
    return Object.entries(this.data.trash)
      .map(([trashed, t]) => ({ trashed, original: t.original, title: metaFor(t.original, t.text, 0).title, when: t.when, inside: 0 }))
      .sort((a, b) => b.when.localeCompare(a.when) || a.original.localeCompare(b.original));
  }

  async readTrashed(trashed: string): Promise<string> {
    const entry = this.data.trash[trashed];
    if (!entry) throw new Error(`Nothing in the trash at ${trashed}`);
    return entry.text;
  }

  async restore(trashed: string): Promise<NoteFile> {
    const entry = this.data.trash[trashed];
    if (!entry) throw new Error(`No note at ${trashed}`);
    const stem = entry.original.slice(entry.original.lastIndexOf("/") + 1).replace(/\.md$/, "");
    const target = this.data.files[entry.original] ? this.freePath(folderOf(entry.original), stem) : entry.original;
    delete this.data.trash[trashed];
    return this.put(target, entry.text);
  }
}
