// Undo and redo for one board: each gesture's batch, once the core has it,
// leaves its inverse on the undo stack (model/invert.ts). Undoing sends that
// inverse as a new batch and keeps its own inverse for redo. Nothing is
// ever taken from git's history; undo is just more edits.

import type { BoardChange } from "../../../../lib/vault/types";
import { invert } from "../model/invert";
import type { Applied, BoardQueue } from "./queue";

interface Entry {
  changes: BoardChange[];
  /** Batches with the same group, one right after the other, undo as one. */
  group?: string;
  at: number;
}

export interface CommitOptions {
  /** Joins this batch's undo with the previous one's when both share the group. */
  group?: string;
  /** Joins only within this many milliseconds of the previous batch. */
  within?: number;
  /** False for a batch that is not the person's edit (a page-map sync): it is saved but leaves the stacks alone. */
  record?: boolean;
}

const MAX = 200;

export class BoardHistory {
  private undos: Entry[] = [];
  private redos: Entry[] = [];

  constructor(
    private readonly queue: BoardQueue,
    private readonly changed: () => void = () => {},
    private readonly now: () => number = Date.now,
  ) {}

  get canUndo(): boolean {
    return this.undos.length > 0;
  }

  get canRedo(): boolean {
    return this.redos.length > 0;
  }

  /** Sends a gesture's changes; resolves with what the core made. */
  async commit(changes: BoardChange[], options: CommitOptions = {}): Promise<Applied> {
    const applied = await this.queue.send(changes);
    if (options.record === false) return applied;
    const back = invert(applied.before, applied.changes, applied.made);
    this.redos = [];
    this.push(this.undos, back, options);
    return applied;
  }

  async undo(): Promise<void> {
    await this.step(this.undos, this.redos);
  }

  async redo(): Promise<void> {
    await this.step(this.redos, this.undos);
  }

  /** Forgets both stacks, after the board was read again from disk. */
  clear(): void {
    this.undos = [];
    this.redos = [];
    this.changed();
  }

  private async step(from: Entry[], to: Entry[]): Promise<void> {
    // What is on its way lands on the stacks first.
    await this.queue.idle();
    const entry = from.pop();
    if (!entry) return;
    this.changed();
    const applied = await this.queue.send(entry.changes);
    this.push(to, invert(applied.before, applied.changes, applied.made), {});
  }

  private push(stack: Entry[], changes: BoardChange[], { group, within }: CommitOptions): void {
    if (changes.length === 0) return this.changed();
    const top = stack[stack.length - 1];
    const now = this.now();
    if (group && top?.group === group && (within === undefined || now - top.at <= within)) {
      stack[stack.length - 1] = { changes: [...changes, ...top.changes], group, at: now };
    } else {
      stack.push({ changes, group, at: now });
      if (stack.length > MAX) stack.shift();
    }
    this.changed();
  }
}
