// Saving one source file as it is typed. A save waits for a quiet spell (500 ms
// by default), goes out with the hash of the file as the editor last knew it
// ("base hash"), and one save is in flight at a time. The app merges changes
// made elsewhere on other lines; when the same lines changed it keeps the
// editor's text in a copy and leaves the file alone, and then saving stops
// until the person picks a way out (`keepMine` or `useDisk`).

import type { SourceFile, SourceSaved } from "./types";
import { sentence } from "./backend";

export interface AutosaveEvents {
  /** The text is on disk (also when it was already there). */
  saved(): void;
  /** Other lines changed on disk and were merged with the editor's text; this is the file now. */
  merged(text: string): void;
  /** The same lines changed: the editor's text is in `copy`, the file on disk says `text`. */
  conflict(info: { copy: string; text: string }): void;
  failed(message: string): void;
}

export interface AutosaveOptions {
  file: SourceFile;
  save(path: string, baseHash: string, text: string): Promise<SourceSaved>;
  events: AutosaveEvents;
  delayMs?: number;
}

export const SAVE_DELAY_MS = 500;

export class Autosaver {
  private base: string;
  private saved: string;
  private text: string;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  private failedLast = false;
  private disk: SourceFile | null = null;
  private gone = false;
  readonly path: string;
  delayMs: number;

  constructor(private readonly opts: AutosaveOptions) {
    this.path = opts.file.path;
    this.base = opts.file.hash;
    this.saved = opts.file.text;
    this.text = opts.file.text;
    this.delayMs = opts.delayMs ?? SAVE_DELAY_MS;
  }

  /** The editor's text is not on disk yet. */
  get dirty(): boolean {
    return this.text !== this.saved;
  }

  /** The same lines changed elsewhere; saving waits for a choice. */
  get conflicted(): boolean {
    return this.disk !== null;
  }

  /** The editor's text now (what a build sends while it is unsaved). */
  get current(): string {
    return this.text;
  }

  edit(text: string): void {
    this.text = text;
    this.failedLast = false;
    if (this.gone || this.disk) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, this.delayMs);
  }

  /** Saves now and waits until nothing is left to save (or saving cannot go on). */
  async flush(): Promise<void> {
    // Asked for on purpose (Ctrl+S, "Try again"): a failure before does not stop it.
    this.failedLast = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.run();
  }

  dispose(): void {
    this.gone = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** After a conflict: save the editor's text over the file on disk. */
  async keepMine(): Promise<void> {
    if (!this.disk) return;
    this.base = this.disk.hash;
    this.disk = null;
    await this.flush();
  }

  /** After a conflict: give up the editor's text for the file on disk; answers the file's text. */
  useDisk(): string {
    const disk = this.disk;
    if (!disk) return this.text;
    this.disk = null;
    this.base = disk.hash;
    this.saved = disk.text;
    this.text = disk.text;
    return disk.text;
  }

  private run(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.loop().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async loop(): Promise<void> {
    do {
      this.again = false;
      if (this.gone || this.disk || this.failedLast || !this.dirty) return;
      const sent = this.text;
      let result: SourceSaved;
      try {
        result = await this.opts.save(this.path, this.base, sent);
      } catch (err) {
        this.failedLast = true;
        this.opts.events.failed(sentence(err));
        return;
      }
      if (result.status === "conflict") {
        this.disk = result.file;
        this.opts.events.conflict({ copy: result.copy, text: result.file.text });
        return;
      }
      if (result.status === "merged") {
        if (this.text === sent) {
          this.base = result.file.hash;
          this.saved = result.file.text;
          this.text = result.file.text;
          this.opts.events.merged(result.file.text);
        } else {
          // Typed since: keep the old base, so the next save merges again instead of writing over the other lines.
          this.again = true;
        }
      } else {
        this.base = result.file.hash;
        this.saved = result.file.text;
        this.opts.events.saved();
      }
    } while (this.again || this.dirty);
  }
}
