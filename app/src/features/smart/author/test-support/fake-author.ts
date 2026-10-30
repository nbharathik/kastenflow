// A stand-in for the app behind the code editor and the new-page flows: it
// keeps files by path with a hash that changes on every write, refuses a write
// against a stale hash like the real one, and records what it was asked.

import { type AuthorBackend, type FileContent, type Listing, type MadeSmart, type SavedTemplate, type StarterInfo, type Written, WriteRefused } from "../backend";

export const STARTERS: StarterInfo[] = [
  { id: "dashboard", name: "Dashboard", summary: "Counts and a table", mine: false },
  { id: "tracker", name: "Tracker", summary: "A table to tick off", mine: false },
  { id: "mine:reading", name: "Reading", summary: "Your own template", mine: true },
];

export class FakeAuthor implements AuthorBackend {
  disk = new Map<string, { text: string; hash: string }>();
  private counter = 0;
  writes: { path: string; text: string; base: string }[] = [];
  removed: string[] = [];
  made: { starter: string; project: string | null }[] = [];
  turned: { page: string; starter: string }[] = [];
  templates: { page: string; name: string }[] = [];
  /** When set, the next write fails with this sentence (once). */
  failNext: string | null = null;
  /** When set, listing the files fails with this sentence. */
  failListing: string | null = null;
  kit: [string, string][] = [["kit.css", "body{}"]];

  constructor(initial: Record<string, string> = { "index.html": "<h1>Hi</h1>", "app.js": "var a = 1;", "smart.yaml": "title: Hi\n" }) {
    for (const [path, text] of Object.entries(initial)) this.disk.set(path, { text, hash: this.next() });
  }

  private next(): string {
    this.counter += 1;
    return `h${this.counter}`;
  }

  /** The file changes on disk behind the editor's back. */
  changeOnDisk(path: string, text: string): void {
    this.disk.set(path, { text, hash: this.next() });
  }

  /** Files taken away behind the editor's back: a write against the hash it read is `gone`, one against "" makes it again. */
  private taken = new Set<string>();
  removeOnDisk(path: string): void {
    this.disk.delete(path);
    this.taken.add(path);
  }

  async starters(): Promise<StarterInfo[]> {
    return STARTERS;
  }
  async newPage(starter: string, project?: string | null): Promise<MadeSmart> {
    this.made.push({ starter, project: project ?? null });
    return { page: `library/${starter}.md`, id: "01NEW", title: starter, files: 3 };
  }
  async turnInto(page: string, starter: string): Promise<MadeSmart> {
    this.turned.push({ page, starter });
    return { page, id: "01OLD", title: "Old", files: 3 };
  }
  async saveTemplate(page: string, name: string): Promise<SavedTemplate> {
    this.templates.push({ page, name });
    return { slug: name.toLowerCase(), name, written: [] };
  }
  async files(page: string): Promise<Listing> {
    if (this.failListing) throw new Error(this.failListing);
    const files = [...this.disk.entries()].map(([path, file]) => ({ path, size: file.text.length, allowed: true }));
    return { page, dir: page.replace(/\.md$/, ".smart"), exists: files.length > 0, files, totalBytes: 0, problems: [] };
  }
  async read(_page: string, path: string): Promise<FileContent> {
    const file = this.disk.get(path);
    if (!file) throw new Error(`${path} is not there`);
    return { path, hash: file.hash, text: file.text, bytes: null };
  }
  async write(_page: string, path: string, text: string, base: string): Promise<Written> {
    this.writes.push({ path, text, base });
    if (this.failNext) {
      const message = this.failNext;
      this.failNext = null;
      throw new WriteRefused("refused", message);
    }
    const there = this.disk.get(path);
    if (!there && base !== "" && this.taken.has(path)) throw new WriteRefused("gone", `${path} is not there any more`);
    if (!there) this.taken.delete(path);
    if (there && base === "") throw new WriteRefused("refused", `${path} is already there`);
    if (there && base !== there.hash) throw new WriteRefused("conflict", `${path} changed since it was read`);
    const hash = this.next();
    this.disk.set(path, { text, hash });
    return { path: `page.smart/${path}`, rel: path, hash, created: !there, changed: true };
  }
  async remove(_page: string, path: string): Promise<void> {
    this.disk.delete(path);
    this.removed.push(path);
  }
  async kitFiles(): Promise<[string, string][]> {
    return this.kit;
  }
}
