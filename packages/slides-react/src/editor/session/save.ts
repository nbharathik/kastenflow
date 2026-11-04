// Writing the deck to the host: after a pause in the changes, one save at a
// time, never over a file that changed underneath (that is a conflict for
// the person to settle).

import type { SlidesHost } from "../host.ts";
import type { SaveState } from "./types.ts";

interface Deps {
  host: Pick<SlidesHost, "save">;
  /** The deck's text as it is now. */
  text(): string;
  report(state: SaveState): void;
  delay: number;
}

export class SaveQueue {
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** The whole round of saving: a write, and the writes of changes made while it ran. */
  private running: Promise<void> | null = null;
  private again: { overwrite: boolean } | null = null;
  /** The text last written to the host, or read from it. */
  private written: string | null = null;
  private held = false;

  constructor(private readonly deps: Deps) {}

  /**
   * Whether saving is paused because the file is not the one being edited. This
   * queue is the only owner of that: it stays so through any number of changes,
   * until the file is loaded (`markClean`) or the person's version is written
   * over it (`flush` with `overwrite`).
   */
  get conflicted(): boolean {
    return this.held;
  }

  /** The file changed outside while there are unsaved changes: pause saving and show both. */
  hold(theirs: string): void {
    clearTimeout(this.timer);
    this.held = true;
    this.deps.report({ status: "conflict", theirs });
  }

  /** Whether `text` is what this queue itself last wrote (the echo of our own save). */
  isOwn(text: string): boolean {
    return text === this.written;
  }

  /** The host holds `text` and nothing is waiting: after a load. */
  markClean(text: string): void {
    clearTimeout(this.timer);
    this.written = text;
    this.held = false;
  }

  /** A change was made: save once the changes pause. */
  schedule(): void {
    clearTimeout(this.timer);
    if (this.held) return;
    this.timer = setTimeout(() => void this.flush(), this.deps.delay);
  }

  /** Saves now. Resolves once everything changed up to now is written, the changes made during a write included. */
  async flush(options: { overwrite?: boolean } = {}): Promise<void> {
    clearTimeout(this.timer);
    if (this.running) {
      this.again = { overwrite: Boolean(options.overwrite || this.again?.overwrite) };
      return this.running;
    }
    this.running = this.round({ overwrite: Boolean(options.overwrite) });
    try {
      await this.running;
    } finally {
      this.running = null;
    }
  }

  private async round(first: { overwrite: boolean }): Promise<void> {
    let ask: { overwrite: boolean } | null = first;
    while (ask) {
      if (this.held && !ask.overwrite) return;
      const text = this.deps.text();
      if (!ask.overwrite && text === this.written) {
        this.deps.report({ status: "saved" });
        return;
      }
      this.deps.report({ status: "saving" });
      await this.write(text, ask.overwrite);
      // Asked to save during the write: go on while there is something to write.
      ask = this.again;
      this.again = null;
    }
  }

  private async write(text: string, overwrite: boolean): Promise<void> {
    try {
      const outcome = await this.deps.host.save(text, overwrite ? { overwrite } : undefined);
      if (outcome.status === "conflict") {
        this.held = true;
        this.deps.report({ status: "conflict", theirs: outcome.theirs, copy: outcome.copy });
        return;
      }
      this.held = false;
      this.written = text;
      // Changes made while it was being written are still to be saved.
      this.deps.report(this.deps.text() === text ? { status: "saved" } : { status: "unsaved" });
    } catch (thrown) {
      this.deps.report({ status: "error", message: thrown instanceof Error ? thrown.message : String(thrown) });
    }
  }
}
