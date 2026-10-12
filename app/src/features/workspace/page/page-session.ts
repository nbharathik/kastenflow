// Autosave for one open page. Edits to the body and the header wait until
// typing pauses, then go to the vault one at a time, each with the hash of
// the version it replaces, so a change made on disk meanwhile is never
// overwritten.

import { localStamp } from "../../templates/template-vars";
import { splitFrontmatter } from "../../pages/markdown/frontmatter";
import type { NoteFile, Renamed, VaultClient } from "../../../lib/vault/types";
import { merge3 } from "../preview/merge";

export type HeaderKey = "icon" | "cover" | "font" | "width" | "text" | "locked" | "opens" | "layout";
export type SaveState = "saved" | "edited" | "saving" | "failed";

export interface SessionEvents {
  onState(state: SaveState): void;
  /** The note as the vault now has it, after each write. */
  onNote(note: NoteFile): void;
  /** The note has a new title, and perhaps a new path. */
  onRenamed(from: string, renamed: Renamed): void;
  /** The file changed on disk; the editor's version went to `copy`. */
  onConflict(copy: string, note: NoteFile): void;
  /** The file changed on disk on other lines and both edits are now in
   * `note`. The editor should show it, or `pending` when newer typing is
   * waiting (merged into it too), and write that next. */
  onMerged(note: NoteFile, pending: string | null): void;
  onError(message: string): void;
  /** The note's file was gone (moved or deleted outside Kasten) while
   * typing waited: the typing was kept as `note` instead. */
  onRecovered?(note: NoteFile, title: string): void;
  /** Typing waits to be written, typed on the version `base`; or, with
   * null, none waits any more. */
  onUnsaved?(body: string | null, base: string): void;
}

/** Whether a read failed because the note is not there, as both vaults
 * say it, rather than for any other reason. */
const missing = (err: unknown) => (err instanceof Error ? err.message : String(err)).startsWith("No note at ");

/** How long to wait before trying a failed save again, one per failure in a row. */
export const RETRY_MS: readonly number[] = [2_000, 5_000, 15_000, 30_000];

export class PageSession {
  private hash: string;
  private savedBody: string;
  private body: string | null = null;
  private readonly header = new Map<HeaderKey, string | null>();
  private title: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** The next try after a save failed, and how many failed in a row. */
  private retry: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private chain: Promise<void> = Promise.resolve();
  private running = false;
  private stopped = false;

  constructor(
    private readonly client: VaultClient,
    private notePath: string,
    loaded: NoteFile,
    private readonly events: SessionEvents,
    private readonly delay = 600,
  ) {
    this.hash = loaded.hash;
    this.savedBody = splitFrontmatter(loaded.text).body;
    this.name = loaded.meta.title;
  }

  /** The note's title, for a page that keeps typing its file lost. */
  private name: string;

  /** Where the note is now; a rename can move it. */
  get path(): string {
    return this.notePath;
  }

  private get waiting(): boolean {
    return this.body !== null || this.header.size > 0 || this.title !== null;
  }

  /** Whether edits are waiting or being written. */
  get busy(): boolean {
    return this.running || this.waiting;
  }

  get currentHash(): string {
    return this.hash;
  }

  /** Takes in a change made to the note outside the editor, such as its
   * properties or tags from the side panel, so the next save builds on it.
   * Returns false when the body differs or edits are waiting: then the
   * page should reload instead. */
  adopt(note: NoteFile): boolean {
    if (note.meta.path !== this.notePath || this.busy) return false;
    if (splitFrontmatter(note.text).body !== this.savedBody) return false;
    this.hash = note.hash;
    this.events.onNote(note);
    return true;
  }

  editBody(body: string): void {
    if (this.stopped) return;
    if (body === this.savedBody && this.body === null) return;
    this.body = body;
    this.events.onUnsaved?.(body, this.hash);
    this.schedule();
  }

  editHeader(key: HeaderKey, value: string | null): void {
    if (this.stopped) return;
    this.header.set(key, value);
    this.schedule();
  }

  /** Renames the note, updating links to it. Written with the next flush;
   * the title field flushes when it loses focus. */
  rename(title: string): void {
    if (this.stopped) return;
    this.title = title;
    this.schedule();
  }

  /** Writes everything waiting now. */
  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.chain = this.chain.then(() => this.write());
    return this.chain;
  }

  /** Stops taking edits, after writing what is waiting. */
  close(): Promise<void> {
    const done = this.flush();
    this.stopped = true;
    return done;
  }

  /** Tries a failed save again after a while, waiting longer each time,
   * even once the page has closed: it is the last chance for its text. */
  private tryAgainLater(): void {
    if (this.retry) clearTimeout(this.retry);
    const wait = RETRY_MS[Math.min(this.failures, RETRY_MS.length - 1)]!;
    this.failures++;
    this.retry = setTimeout(() => {
      this.retry = null;
      void this.flush();
    }, wait);
  }

  private schedule(): void {
    this.events.onState("edited");
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.delay);
  }

  private async write(): Promise<void> {
    if (!this.waiting) return;
    this.running = true;
    this.events.onState("saving");
    // What this write takes on; whatever does not reach the vault goes back.
    let title: string | null = null;
    const header = new Map<HeaderKey, string | null>();
    let body: string | null = null;
    try {
      if (this.title !== null) {
        title = this.title;
        this.title = null;
        const from = this.notePath;
        const renamed = await this.client.rename(from, title);
        title = null;
        this.notePath = renamed.note.meta.path;
        this.hash = renamed.note.hash;
        this.name = renamed.note.meta.title;
        this.events.onRenamed(from, renamed);
      }
      for (const [key, value] of [...this.header]) {
        this.header.delete(key);
        header.set(key, value);
        const note = await this.client.setMeta(this.notePath, key, value);
        header.delete(key);
        this.hash = note.hash;
        this.follow(note);
        this.events.onNote(note);
      }
      if (this.body !== null) {
        body = this.body;
        this.body = null;
        const saved = await this.client.saveBody(this.notePath, body, this.hash);
        const written = body;
        body = null;
        if (saved.status === "merged") {
          this.events.onNote(saved.note);
          const merged = splitFrontmatter(saved.note.text).body;
          // Typing done meanwhile is based on the editor's text: bring the
          // other side's lines into it too. If they overlap, keep the old
          // base so the next save merges in the core or keeps a copy.
          const pending = this.body === null ? null : merge3(written, this.body, merged);
          if (this.body !== null && pending === null) return this.events.onState("edited");
          this.hash = saved.note.hash;
          this.savedBody = merged;
          this.body = null;
          this.stopped = true;
          this.events.onUnsaved?.(null, this.hash);
          this.events.onMerged(saved.note, pending);
          return;
        }
        if (saved.status === "conflict") {
          // Typing done during the save builds on the old version: it keeps
          // the old base, so its write merges or makes a copy in turn and
          // never overwrites the change made outside.
          if (this.body === null) {
            this.hash = saved.note.hash;
            this.events.onUnsaved?.(null, this.hash);
          }
          this.stopped = true;
          this.events.onConflict(saved.copy, saved.note);
          return;
        }
        this.hash = saved.note.hash;
        this.follow(saved.note);
        // As written: the vault may spell a rule on top of the page its own way.
        this.savedBody = splitFrontmatter(saved.note.text).body;
        this.events.onNote(saved.note);
      }
      this.failures = 0;
      if (!this.waiting) this.events.onUnsaved?.(null, this.hash);
      this.events.onState(this.waiting ? "edited" : "saved");
    } catch (err) {
      // Nothing typed is dropped: it is written with the next try, unless
      // newer edits have taken its place.
      if (title !== null && this.title === null) this.title = title;
      for (const [key, value] of header) if (!this.header.has(key)) this.header.set(key, value);
      if (body !== null && this.body === null) this.body = body;
      if (await this.recovered()) return;
      this.events.onState("failed");
      this.events.onError(err instanceof Error ? err.message : String(err));
      this.tryAgainLater();
    } finally {
      this.running = false;
    }
  }

  /** Goes on at the note's path when a write answered from another one: a
   * new page's draft (workspace/drafts.ts) became its page. */
  private follow(note: NoteFile): void {
    if (note.meta.path !== this.notePath) this.notePath = note.meta.path;
  }

  /** When the note's file is gone (moved or deleted outside Kasten), keeps
   * the waiting typing as a new page instead of trying the old one
   * forever. False when the file is there, or nothing could be kept. */
  private async recovered(): Promise<boolean> {
    // Only a note that is not there: a read that fails for another reason
    // (a locked or unreachable vault) keeps trying, and keeps the typing.
    const gone = await this.client.read(this.notePath).then(
      () => false,
      (err: unknown) => missing(err),
    );
    if (!gone) return false;
    const body = this.body;
    try {
      if (body !== null) {
        const title = `${this.name} (recovered)`;
        const made = await this.client.create({ kind: "page", title, date: localStamp() });
        const saved = await this.client.saveBody(made.meta.path, body, made.hash);
        this.events.onRecovered?.(saved.note, this.name);
      }
    } catch {
      return false;
    }
    // Header and title changes had nowhere to go: the note is not there.
    this.body = null;
    this.header.clear();
    this.title = null;
    this.stopped = true;
    this.failures = 0;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.events.onUnsaved?.(null, this.hash);
    this.events.onState("saved");
    return true;
  }
}
