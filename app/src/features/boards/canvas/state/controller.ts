// One open board: its view store, the queue that saves its batches and the
// undo history. Every change to the board goes through `commit`, one batch
// per gesture; a refused batch shows its message and the board is read
// again from disk.

import type { BoardChange, NoteFile, NoteMeta, VaultClient } from "../../../../lib/vault/types";
import type { Draft, OpenHow } from "../../../workspace/store";
import type { BoardDoc } from "../model/apply";
import { rectOf, shownRect } from "../model/geometry";
import { forgetPreview } from "../nodes/nested-preview";
import type { CommitOptions } from "./history";
import { BoardHistory } from "./history";
import { BoardQueue, Dropped, type Applied } from "./queue";
import { createBoardStore, showDoc, startDrag, type BoardStore, type Drag } from "./store";

/** What a board needs from the rest of the app. */
export interface BoardDeps {
  client: Pick<VaultClient, "board" | "boardApply" | "createBoard" | "saveAsset" | "importDiagram">;
  notes(): readonly NoteMeta[];
  toast(text: string): void;
  open(path: string, how: OpenHow): void;
  /** A new note, not opened. */
  create(draft: Draft): Promise<NoteFile | null>;
  /** Moves a note to the trash (with the app's own undo toast). */
  trash(path: string): Promise<void>;
  /** Goes to another board in this tab (a nested one, or back up). */
  enter(path: string): void;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export class BoardController {
  readonly store: BoardStore;
  readonly queue: BoardQueue;
  readonly history: BoardHistory;
  private drag: Drag | null = null;

  constructor(
    readonly path: string,
    doc: BoardDoc,
    readonly deps: BoardDeps,
  ) {
    this.store = createBoardStore(doc);
    this.queue = new BoardQueue(deps.client, path, doc, (next) => showDoc(this.store, next));
    this.history = new BoardHistory(this.queue, () => this.store.setState({ canUndo: this.history.canUndo, canRedo: this.history.canRedo }));
  }

  get doc(): BoardDoc {
    return this.store.getState().doc;
  }

  node(id: string) {
    return this.doc.nodes.find((n) => n.id === id);
  }

  /** Sends one gesture's changes. Resolves with what the core made, or
   * null when it refused them (the message is shown, the board reloaded). */
  async commit(changes: BoardChange[], options?: CommitOptions): Promise<Applied | null> {
    if (changes.length === 0) return null;
    try {
      const applied = await this.history.commit(changes, options);
      forgetPreview(this.path);
      return applied;
    } catch (err) {
      this.failed(err);
      return null;
    }
  }

  async undo(): Promise<void> {
    await this.history.undo().catch((err: unknown) => this.failed(err));
  }

  async redo(): Promise<void> {
    await this.history.redo().catch((err: unknown) => this.failed(err));
  }

  private failed(err: unknown): void {
    if (err instanceof Dropped) return;
    // Only the step that failed is gone (an undo already took its entry off the stack); earlier steps stay.
    this.deps.toast(`The board was not changed: ${message(err)}`);
  }

  /** Reads the board again after it changed on disk, when nothing is on
   * its way; the view changes only if the board did. */
  async refresh(): Promise<void> {
    try {
      await this.queue.refresh();
    } catch {
      // Gone or unreadable for a moment (a sync mid-write): keep what shows.
    }
  }

  dragStart(ids: readonly string[]): void {
    this.drag = startDrag(this.store, ids);
  }

  get dragging(): Drag | null {
    return this.drag;
  }

  /** Ends a drag: one batch placing everything that moved. */
  dragStop(): void {
    const drag = this.drag;
    this.drag = null;
    this.store.setState({ moving: false });
    if (!drag) return;
    const shown = new Map(this.store.getState().nodes.map((n) => [n.id, n.position]));
    const changes: BoardChange[] = [];
    for (const id of drag.starts.keys()) {
      const node = this.node(id);
      const at = shown.get(id);
      if (!node || !at) continue;
      const x = Math.round(at.x);
      const y = Math.round(at.y);
      if (x !== node.x || y !== node.y) changes.push({ kind: "place", id, x, y });
    }
    void this.commit(changes);
  }

  /** Ends a resize. Title-only cards and folded sections keep the height
   * the file has for them: only their width changes. */
  resizeEnd(id: string, box: { x: number; y: number; width: number; height: number }): void {
    this.store.setState({ moving: false });
    const node = this.node(id);
    if (!node) return;
    const keepsHeight = shownRect(node).height !== rectOf(node).height;
    const place: BoardChange = {
      kind: "place",
      id,
      x: Math.round(box.x),
      y: Math.round(box.y),
      width: Math.max(1, Math.round(box.width)),
      height: keepsHeight ? node.height : Math.max(1, Math.round(box.height)),
    };
    if (place.x === node.x && place.y === node.y && place.width === node.width && place.height === node.height) return;
    void this.commit([place]);
  }
}
