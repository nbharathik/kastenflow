// The browser preview's whole vault: MemoryNotes' note ops plus a light
// history (each change kept as a version per note), capture, to-dos,
// mentions, settings and a simple check. Inside the app the core does all
// of this with git and SQLite.

import { isoDay } from "../../../lib/dates";
import { browserDownload } from "../../../lib/download";
import { splitFrontmatter } from "../../pages/markdown/frontmatter";
import { setFrontmatterKey, yamlList } from "../../pages/page/page-meta";
import type {
  Backlink,
  DayMention,
  BackupStatus,
  ChangedFile,
  CommitInfo,
  FindSpec,
  GraphScope,
  ImportOptions,
  ImportSummary,
  Imported,
  NewNote,
  NoteFile,
  NoteMatches,
  Placed,
  NoteStats,
  PropDef,
  RelatedNote,
  ReplaceRequest,
  Replaced,
  TagSchema,
  TagView,
  TaskRow,
  Undone,
  VaultClient,
  VaultConfig,
  VaultGraph,
  VaultRestore,
  VaultStatus,
  VerifyReport,
} from "../../../lib/vault/types";
import { splitCapture } from "./capture-split";
import { dayMentionsIn } from "./day-mentions";
import { dueAt } from "./day-times";
import { tasksIn } from "../tasks";
import { deckHead } from "./memory-decks";
import { MemoryReferences } from "./memory-references";
import { filesOf, graphIn, linkRowsOf } from "./memory-graph";
import { findUnderIn, planReplace } from "./memory-replace";
import { appendUnder, parseSchema, propsBlock, replaceSection } from "./memory-extras";
import { Directory, placeOf } from "../links";
import { linkingByNote } from "./keep-links";
import { eolOf } from "./memory-notes";
import { checkProps, relationIds, relationKeys } from "./props-check";
import { similarNotes } from "./similar";
import { checkProperties, checkViews, setList, tagFile } from "./tag-yaml";
import { newestFirst, readableLine, slugify, stamps, wikiLinks } from "./vault-text";

export { metaFor, type PreviewStorage } from "./memory-notes";

const DEFAULT_CONFIG: VaultConfig = {
  name: "Browser preview",
  git: { remote: null, push_delay_seconds: 120, push_interval_minutes: 60 },
  guardrails: { max_removed_fraction: 0.4, max_notes_per_session_10min: 25, max_trash_per_session: 5, max_board_nodes_removed: 10, max_slides_removed: 3, max_write_bytes: 204800, max_asset_bytes: 10485760, max_assets_per_session_10min: 30, max_asset_bytes_per_session_10min: 52428800 },
  ai: { providers: [] },
};

const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** The first day a task names (dates.rs `due_date`): a day that exists. */
export function dueDate(text: string): string | null {
  return dueAt(text)?.day ?? null;
}

const PREVIEW_IMPORT = "Importing reads a folder on your computer, so it needs the desktop app. The browser preview keeps its notes in the browser.";

export class MemoryVault extends MemoryReferences implements VaultClient {
  /** Each note's to-dos, with the text they were read from. */
  private taskCache = new Map<string, { text: string; found: Omit<TaskRow, "path" | "title" | "icon">[] }>();

  async history(path: string | null, limit = 100): Promise<CommitInfo[]> {
    const entries = Object.entries(this.data.versions ?? {})
      .filter(([p]) => path === null || p === path)
      .flatMap(([, list]) => [...list].reverse());
    return entries
      .sort(newestFirst)
      .slice(0, limit)
      .map((v) => ({
        id: v.id,
        summary: v.summary,
        message: v.summary,
        author: v.client ? `agent:${v.client}` : "You",
        time: v.time,
        agent: Boolean(v.client),
        session: v.session ?? null,
        op: v.client ? v.summary.slice(0, v.summary.indexOf(":")) || null : null,
        approvedBy: null,
        undoes: v.undoes ?? null,
      }));
  }

  async version(rev: string, path: string): Promise<string | null> {
    return this.data.versions?.[path]?.find((v) => v.id === rev)?.text ?? null;
  }

  async restoreVersion(path: string, rev: string): Promise<NoteFile> {
    const text = await this.version(rev, path);
    if (text === null) throw new Error("That version is not in the preview's history");
    this.verb = "restore";
    try {
      return this.put(path, text);
    } finally {
      this.verb = null;
    }
  }

  async commitEdits(): Promise<string | null> {
    return null;
  }

  async status(): Promise<VaultStatus> {
    const backup: BackupStatus = { state: "off", lastPush: null, failures: 0, lastError: null };
    return { name: (await this.getConfig()).name, root: "This browser", history: true, remote: null, backup, pending: 0 };
  }

  async startHistory(): Promise<void> {}

  // Importing reads a folder on the computer, which a browser page cannot.
  async planImport(_source: string, _options: ImportOptions): Promise<ImportSummary> {
    throw new Error(PREVIEW_IMPORT);
  }

  async importNotes(_source: string, _options: ImportOptions): Promise<Imported> {
    throw new Error(PREVIEW_IMPORT);
  }

  async clipUrl(_url: string): Promise<NoteFile> {
    throw new Error("Clipping fetches the page from the web, which needs the desktop app");
  }

  async restoreVault(_rev: string): Promise<VaultRestore> {
    throw new Error("Restoring the whole vault needs the desktop app; restore one page from its History tab");
  }

  async undoCommit(_commit: string): Promise<Undone> {
    throw new Error("Undoing one change needs the desktop app; undo a chat or an agent's changes from History");
  }

  async findUnder(root: string, spec: FindSpec, maxNotes = 200): Promise<NoteMatches[]> {
    return findUnderIn(await this.list(), (path) => this.get(path), root, spec, maxNotes);
  }

  /** Each page is written as its own version; there is no one commit to undo (`commit` is null). */
  async replaceUnder(request: ReplaceRequest): Promise<Replaced> {
    const edits = planReplace(await this.list(), (path) => this.get(path), request);
    for (const edit of edits) this.put(edit.path, edit.text);
    return { commit: null, notes: edits.map((e): [string, number] => [e.path, e.count]), total: edits.reduce((sum, e) => sum + e.count, 0) };
  }

  async graph(scope: GraphScope): Promise<VaultGraph> {
    const notes = await this.list();
    return graphIn(notes, linkRowsOf(notes, (path) => this.data.files[path]?.text ?? ""), filesOf(this.data.boards, this.data.decks), scope);
  }

  async pushNow(): Promise<BackupStatus> {
    throw new Error("The browser preview has no backup remote; run the desktop app for that");
  }

  async convert(path: string, kind: "card" | "page"): Promise<Placed> {
    const note = this.get(path);
    if (!["card", "page"].includes(note.meta.kind)) throw new Error(`A ${note.meta.kind} cannot become a ${kind}`);
    if (note.meta.kind === kind) return { ...note, moves: [], relinked: [] };
    const { prefix, body } = splitFrontmatter(note.text);
    const eol = eolOf(note.text);
    this.put(path, setFrontmatterKey(setFrontmatterKey(prefix, "type", kind, eol), "updated", stamps(this.now()).rfc3339, eol) + body);
    return this.move(path, note.meta.project);
  }

  async getConfig(): Promise<VaultConfig> {
    return structuredClone(this.data.config ?? DEFAULT_CONFIG);
  }

  async setConfig(config: VaultConfig): Promise<void> {
    this.data.config = structuredClone(config);
    this.persist();
  }

  async capture(markdown: string, tags: string[], project?: string | null): Promise<NoteFile> {
    if (project && !(await this.list()).some((n) => n.kind === "project" && n.project === project)) throw new Error(`No project called ${project}`);
    const split = splitCapture(markdown);
    const title = split.title.replace(/[[\]|]/g, "").trim() || "Quick note";
    const card = await this.create({ kind: "card", title, date: isoDay(new Date(this.now())), project: project ?? null });
    const { prefix } = splitFrontmatter(card.text);
    const all = [...card.meta.tags];
    for (const tag of tags.map((t) => t.trim().replace(/^#/, "")).filter(Boolean)) if (!all.some((a) => a.toLowerCase() === tag.toLowerCase())) all.push(tag);
    const eol = eolOf(card.text);
    const withTags = all.length ? setFrontmatterKey(prefix, "tags", yamlList(all), eol, true) : prefix;
    return this.put(card.meta.path, withTags + split.body.replace(/\n/g, eol));
  }

  async mentions(title: string, path: string): Promise<Backlink[]> {
    const wanted = title.trim().toLowerCase();
    if (!wanted) return [];
    const out: Backlink[] = [];
    for (const meta of await this.list()) {
      if (meta.kind === "template" || meta.path === path || this.linksOf(meta.path).has(wanted)) continue;
      const body = splitFrontmatter(this.data.files[meta.path]!.text).body;
      const line = body.split(/\r?\n/).find((l) => l.toLowerCase().includes(wanted));
      if (line !== undefined) out.push({ path: meta.path, title: meta.title, icon: meta.icon, snippet: line.trim().slice(0, 200) });
    }
    return out;
  }

  async dayMentions(from: string, to: string): Promise<DayMention[]> {
    return dayMentionsIn(await this.list(), (path) => this.data.files[path]?.text ?? "", from, to);
  }

  async related(path: string, limit = 8): Promise<RelatedNote[]> {
    const docs = (await this.list()).map((meta) => ({
      path: meta.path,
      title: meta.title,
      icon: meta.icon,
      kind: meta.kind,
      body: splitFrontmatter(this.data.files[meta.path]!.text).body,
      links: this.linksOf(meta.path),
    }));
    return similarNotes(docs, path, limit);
  }

  async tasks(): Promise<TaskRow[]> {
    const out: TaskRow[] = [];
    const notes = (await this.list()).filter((n) => n.kind !== "template").sort((a, b) => b.modified - a.modified);
    // Each note's to-dos are read again only when its text changed, as the
    // core's index does, so a save does not re-read the whole vault.
    const known = this.taskCache;
    this.taskCache = new Map();
    for (const meta of notes) {
      const text = this.data.files[meta.path]!.text;
      const cached = known.get(meta.path);
      const found = cached?.text === text ? cached.found : tasksIn(splitFrontmatter(text).body).map((task) => ({ line: task.line, done: task.done, text: readableLine(task.text), due: dueDate(task.text), at: dueAt(task.text)?.at ?? null }));
      this.taskCache.set(meta.path, { text, found });
      for (const task of found) out.push({ path: meta.path, title: meta.title, icon: meta.icon, ...task });
    }
    return out;
  }

  async verify(): Promise<VerifyReport> {
    const notes = await this.list();
    const problems: VerifyReport["problems"] = [];
    const ids = new Map<string, string>();
    const titles = new Set(notes.map((n) => n.title.toLowerCase()));
    const dir = new Directory(notes);
    for (const meta of notes) {
      if (meta.kind === "template") continue;
      if (meta.id && ids.has(meta.id)) problems.push({ kind: "duplicate-id", path: meta.path, detail: `Same id as ${ids.get(meta.id)}` });
      else if (meta.id) ids.set(meta.id, meta.path);
      for (const target of wikiLinks(splitFrontmatter(this.data.files[meta.path]!.text).body)) {
        if (isDay(target)) continue;
        const found = dir.resolve(target, placeOf(meta));
        if (found && "choices" in found) {
          const among = found.choices.map((n) => n.path).join(", ");
          problems.push({ kind: "ambiguous-link", path: meta.path, detail: `[[${target}]] could be any of ${among}; name one by path` });
        } else if (!found && !titles.has(target.toLowerCase())) problems.push({ kind: "unresolved-link", path: meta.path, detail: `[[${target}]] points to no note` });
      }
    }
    const decks = Object.keys(this.data.decks ?? {});
    for (const path of decks) {
      try {
        deckHead(this.data.decks![path]!);
      } catch (err) {
        problems.push({ kind: "deck", path, detail: err instanceof Error ? err.message : String(err) });
      }
    }
    return { notes: notes.length, boards: 0, decks: decks.length, gitObjects: 0, problems };
  }

  async noteStats(): Promise<NoteStats[]> {
    const notes = (await this.list()).filter((n) => n.kind !== "template");
    const bodyOf = (path: string) => splitFrontmatter(this.data.files[path]!.text).body;
    const outgoing = new Map(notes.map((n) => [n.path, wikiLinks(bodyOf(n.path)).length]));
    const linking = linkingByNote(notes, bodyOf);
    const onBoards = this.boardCounts();
    return notes.map((n) => ({
      path: n.path,
      backlinks: linking.get(n.path)?.size ?? 0,
      links: outgoing.get(n.path) ?? 0,
      boards: onBoards.get(n.path) ?? 0,
    }));
  }

  async tagSchemas(): Promise<TagSchema[]> {
    return Object.entries(this.data.tags ?? {}).map(([path, yaml]) => parseSchema(path, yaml));
  }

  async setTagViews(tag: string, views: TagView[]): Promise<TagSchema> {
    const name = tag.trim().replace(/^#+/, "").trim();
    checkViews(name, views);
    return this.setTagList(name, "views", views);
  }

  async setTagProperties(tag: string, properties: PropDef[]): Promise<TagSchema> {
    const name = tag.trim().replace(/^#+/, "").trim();
    checkProperties(name, properties);
    return this.setTagList(name, "properties", properties);
  }

  /** One list in the tag's file replaced, found by the name inside it. */
  private setTagList(name: string, key: string, items: readonly unknown[]): TagSchema {
    const slug = slugify(name);
    if (!slug) throw new Error(`Not a tag name: “${name}”`);
    const files = (this.data.tags ??= {});
    const found = Object.entries(files).find(([path, yaml]) => parseSchema(path, yaml).name.toLowerCase() === name.toLowerCase());
    const path = found?.[0] ?? `tags/${slug}.yaml`;
    const yaml = setList(found?.[1] ?? tagFile(name), key, items);
    const schema = parseSchema(path, yaml);
    files[path] = yaml;
    this.persist();
    return schema;
  }

  async updateProps(path: string, changes: Record<string, unknown>): Promise<NoteFile> {
    const schemas = await this.tagSchemas();
    const { tags } = this.get(path).meta;
    const props = checkProps(schemas, tags, changes);
    const notes = await this.list();
    for (const key of relationKeys(schemas, tags)) {
      const items = props[key];
      if (Array.isArray(items)) props[key] = relationIds(items as string[], notes, (p) => this.parentId(p));
    }
    // Read after: a note given an id may be this one.
    const current = this.get(path);
    const eol = eolOf(current.text);
    const merged: Record<string, unknown> = { ...current.meta.props };
    for (const [key, value] of Object.entries(props)) {
      if (value === null) delete merged[key];
      else merged[key] = value;
    }
    const { prefix, body } = splitFrontmatter(current.text);
    // A block mapping: `props:`, then one indented line per property.
    const block = propsBlock(merged, eol);
    const text = setFrontmatterKey(prefix, "props", block === null ? null : "\u0000", eol, true).replace("props: \u0000", `props:${block}`);
    return this.put(path, text + body);
  }

  async setTags(path: string, add: string[], remove: string[]): Promise<NoteFile> {
    const current = this.get(path);
    const clean = (t: string) => t.trim().replace(/^#/, "").trim();
    const gone = remove.map(clean).map((t) => t.toLowerCase());
    const tags = current.meta.tags.filter((t) => !gone.includes(t.toLowerCase()));
    for (const tag of add.map(clean).filter(Boolean)) if (!tags.some((t) => t.toLowerCase() === tag.toLowerCase())) tags.push(tag);
    const { prefix, body } = splitFrontmatter(current.text);
    return this.put(path, setFrontmatterKey(prefix, "tags", tags.length ? yamlList(tags) : null, eolOf(current.text), true) + body);
  }

  async saveDownload(name: string, bytes: Uint8Array, type: string): Promise<string> {
    await browserDownload({ name, bytes, type });
    return name;
  }

  async replaceSection(path: string, heading: string, markdown: string): Promise<NoteFile> {
    const current = this.get(path);
    const { prefix, body } = splitFrontmatter(current.text);
    return this.put(path, prefix + replaceSection(body, heading, markdown));
  }

  async append(path: string, markdown: string, heading?: string | null): Promise<NoteFile> {
    const current = this.get(path);
    const { prefix, body } = splitFrontmatter(current.text);
    return this.put(path, prefix + appendUnder(body, markdown, heading ?? null));
  }

  override async create(note: NewNote): Promise<NoteFile> {
    const { tags, props, body, ...base } = note;
    const wanted = props && Object.keys(props).length ? props : null;
    // Checked before anything is made, as the core does.
    if (wanted) {
      const template = base.template ? this.data.files[`templates/${slugify(base.template)}.md`] : undefined;
      const from = template ? splitFrontmatter(template.text).prefix : "";
      const templateTags = /^tags:\s*\[(.*)\]\s*$/m.exec(from)?.[1]?.split(",").map((t) => t.trim()).filter(Boolean) ?? [];
      checkProps(await this.tagSchemas(), [...templateTags, ...(tags ?? [])], wanted);
    }
    let file = await super.create(base);
    if (tags?.length) file = await this.setTags(file.meta.path, tags, []);
    if (wanted) file = await this.updateProps(file.meta.path, wanted);
    // A draft's first typing arrives with it, as the core writes it.
    if (body?.trim()) file = (await this.saveBody(file.meta.path, body.endsWith("\n") ? body : `${body}\n`, file.hash)).note;
    return file;
  }

  /** The preview keeps versions per note and board: a version's change to
   * its file. A board's version keeps the board before it. */
  async commitChanges(rev: string): Promise<ChangedFile[]> {
    for (const [path, list] of Object.entries(this.data.versions ?? {})) {
      const at = list.findIndex((v) => v.id === rev);
      if (at < 0) continue;
      const version = list[at]!;
      return [{ path, before: version.before !== undefined ? version.before : at > 0 ? list[at - 1]!.text : null, after: version.text }];
    }
    return [];
  }
}
