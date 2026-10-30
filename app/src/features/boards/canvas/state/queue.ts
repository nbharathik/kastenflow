// Saving a board: each gesture is one batch, sent to the core one after
// another in the order they were made. The board shows every batch at once
// (the last board the core returned, with the batches still on their way
// applied on top), and the core's answer then takes its place. A refused
// batch drops the ones queued after it, which were made on top of it, and
// the board is read again from disk.

import type { BoardChange, VaultClient } from "../../../../lib/vault/types";
import { applyChanges, type BoardDoc } from "../model/apply";
import { reconcile } from "../model/reconcile";

export interface Applied {
  changes: BoardChange[];
  /** What each change that makes something made, in order. */
  made: string[];
  /** The board as shown just before this batch. */
  before: BoardDoc;
}

/** A batch that was queued behind one the core refused. */
export class Dropped extends Error {
  constructor() {
    super("An earlier change to this board was refused, so this one was not sent");
  }
}

type Client = Pick<VaultClient, "board" | "boardApply">;

export class BoardQueue {
  private server: BoardDoc;
  private pending: BoardChange[][] = [];
  private chain: Promise<unknown> = Promise.resolve();
  /** Counts refusals; batches from before one are dropped. */
  private round = 0;
  /** Counts batches sent, so a read that started before one is not taken. */
  private sent = 0;
  /** The board as shown: the core's last answer and the batches on their way. */
  doc: BoardDoc;

  constructor(
    private readonly client: Client,
    readonly path: string,
    initial: BoardDoc,
    private readonly shown: (doc: BoardDoc) => void,
  ) {
    this.server = initial;
    this.doc = initial;
  }

  /** Whether batches are waiting or on their way. */
  get busy(): boolean {
    return this.pending.length > 0;
  }

  /** Sends `changes` after every batch before it; the board shows them at once. */
  send(changes: BoardChange[]): Promise<Applied> {
    const before = this.doc;
    const round = this.round;
    this.sent++;
    this.pending.push(changes);
    this.show();
    const run = this.chain.then(async () => {
      if (round !== this.round) throw new Dropped();
      try {
        const result = await this.client.boardApply(this.path, changes);
        this.pending.shift();
        this.server = reconcile(this.server, result.board);
        this.show();
        return { changes, made: result.made, before };
      } catch (err) {
        this.round++;
        this.pending = [];
        // The failure below is what the caller says; a reload that fails too keeps the board as it is.
        await this.reload().catch(() => {});
        throw err;
      }
    });
    // The chain only keeps order; each batch's own failure is reported through `run`.
    this.chain = run.catch(() => {});
    return run;
  }

  /** Resolves once every batch sent so far is done. */
  idle(): Promise<void> {
    return this.chain.then(() => {});
  }

  /** Reads the board again when nothing is on its way, and takes it only
   * if it differs (an agent may have added cards). Our own writes come
   * back here too, and change nothing. A read that a batch overtook may
   * miss that batch, so it is dropped; the batch's own change brings the
   * next read. */
  async refresh(): Promise<boolean> {
    if (this.busy) return false;
    const sent = this.sent;
    const fresh = await this.client.board(this.path);
    if (this.busy || sent !== this.sent) return false;
    const next = reconcile(this.server, fresh);
    if (next === this.server) return false;
    this.server = next;
    this.show();
    return true;
  }

  /** Takes the board from disk as it is, whatever is shown. */
  async reload(): Promise<void> {
    try {
      this.server = reconcile(this.server, await this.client.board(this.path));
    } finally {
      this.show();
    }
  }

  /** Shows the core's board with the batches on their way on top, keeping
   * the shown objects of what did not change. */
  private show(): void {
    const next = reconcile(
      this.doc,
      this.pending.reduce((doc, changes) => applyChanges(doc, changes), this.server),
    );
    if (next === this.doc) return;
    this.doc = next;
    this.shown(next);
  }
}
