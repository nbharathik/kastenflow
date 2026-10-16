// The editor's state, kept beside the engine: which slide is shown, what is
// selected, the tool, and where saving stands. Every change to the deck goes
// through the engine's operations (its undo and its changes are the single
// source of truth); this class only follows them and keeps the selection
// sensible. Views subscribe and read `state`.

import { DeckEngine, type Changes, type Deck, type Element, type Slide, SlidesError } from "@kasten-slides/wasm";

import type { SlidesHost } from "../host.ts";
import { Clipboard } from "./clipboard.ts";
import { ElementCommands } from "./elements.ts";
import { Exports } from "./exporting.ts";
import { Imports } from "./importing.ts";
import { MarkCommands } from "./marks.ts";
import { followReferences } from "./references.ts";
import { SaveQueue } from "./save.ts";
import { scopeOf, validPath } from "./scope.ts";
import { SlideClipboard } from "./slide-clipboard.ts";
import { SlideCommands } from "./slides.ts";
import { StepCommands } from "./steps.ts";
import { type CellSelection, cellsAfter, isTableIn, sameSelection } from "../table/cells.ts";
import { TableCommands } from "../table/commands.ts";
import { TextCommands } from "./text-commands.ts";
import type { EditStart, EditorState, Tool } from "./types.ts";

export interface SessionOptions {
  /** Milliseconds after the last change before the deck is saved. */
  saveDelay?: number;
  /** Told about an operation that could not be done, in words for a person. */
  onError?: (message: string) => void;
}

type How = "replace" | "add" | "toggle";

const same = <T>(a: readonly T[], b: readonly T[]) => a.length === b.length && a.every((v, i) => v === b[i]);

export class EditorSession {
  readonly host: SlidesHost;
  readonly slides = new SlideCommands(this);
  readonly steps = new StepCommands(this);
  readonly elements = new ElementCommands(this);
  readonly text = new TextCommands(this);
  readonly clipboard = new Clipboard(this);
  /** What is done to the cells picked in a table: words, rows and columns, merging, fill. */
  readonly tables = new TableCommands(this);
  /** Copy, cut and paste of slides, for the filmstrip and the grid. */
  readonly slideClipboard = new SlideClipboard(this);
  readonly exports = new Exports(this);
  readonly imports = new Imports(this);
  readonly marks = new MarkCommands(this);
  private readonly saver: SaveQueue;
  private readonly onError: (message: string) => void;
  private readonly listeners = new Set<() => void>();
  private engine: DeckEngine;
  private stopListening: () => void = () => {};
  private readonly stopReferences: () => void;
  private current: EditorState;
  private revision = 0;
  /** Set while undo or redo runs, so the view can follow what they changed. */
  private replaying: "undo" | "redo" | null = null;
  /** Set while a command that puts elements elsewhere runs, so the view can glide them there. */
  private gliding = false;

  constructor(engine: DeckEngine, host: SlidesHost, options: SessionOptions = {}) {
    this.engine = engine;
    this.host = host;
    this.onError = options.onError ?? ((message) => host.notify?.(message));
    const first = engine.deck.slides[0];
    this.current = {
      deck: engine.deck,
      slideId: first?.id ?? "",
      selection: [],
      inside: [],
      slideSelection: first ? [first.id] : [],
      editing: null,
      cells: null,
      editFrom: null,
      tool: "select",
      ...this.history(),
      saving: { status: "saved" },
      revision: 0,
      settle: null,
    };
    this.saver = new SaveQueue({
      host,
      text: () => this.engine.save(),
      report: (saving) => this.patch({ saving }),
      delay: options.saveDelay ?? 700,
    });
    // The deck as opened is what the host holds: opening writes nothing.
    this.saver.markClean(engine.save());
    this.listen();
    this.stopReferences = followReferences(host, this.onError);
  }

  // ---- reading

  get state(): EditorState {
    return this.current;
  }

  get deck(): Deck {
    return this.current.deck;
  }

  /** The slide on the canvas. */
  get slide(): Slide {
    return this.current.deck.slides.find((s) => s.id === this.current.slideId) ?? this.current.deck.slides[0]!;
  }

  /** The elements the person works among: the slide's own, or what the group they went into holds. */
  get scope(): readonly Element[] {
    return scopeOf(this.slide, this.current.inside);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): EditorState => this.current;

  /** The engine, for the commands in this folder. Views use the commands, not this. */
  get core(): DeckEngine {
    return this.engine;
  }

  // ---- state

  /** Merges `changes` into the state and tells the views. */
  patch(changes: Partial<EditorState>): void {
    this.current = { ...this.current, ...changes };
    for (const listener of [...this.listeners]) listener();
  }

  private history() {
    return {
      canUndo: this.engine.canUndo,
      canRedo: this.engine.canRedo,
      undoLabel: this.engine.undoLabel,
      redoLabel: this.engine.redoLabel,
    };
  }

  /** Runs an engine call; a refused operation is reported and answers undefined. */
  run<T>(call: () => T): T | undefined {
    try {
      return call();
    } catch (thrown) {
      const error = SlidesError.from(thrown);
      this.onError(error.message);
      return undefined;
    }
  }

  private listen(): void {
    this.stopListening();
    this.stopListening = this.engine.subscribe((deck, changes) => this.follow(deck, changes));
  }

  /** The engine changed: keep the slide, selection and history in step, and save. */
  private follow(deck: Deck, changes: Changes): void {
    const before = this.current;
    let slideId = before.slideId;
    if (!deck.slides.some((s) => s.id === slideId)) {
      const was = before.deck.slides.findIndex((s) => s.id === slideId);
      slideId = deck.slides[Math.min(Math.max(was, 0), deck.slides.length - 1)]?.id ?? "";
    } else if (this.replaying && !(slideId in changes.slides)) {
      // Undo and redo show what they changed.
      const shown = deck.slides.find((s) => s.id in changes.slides && changes.slides[s.id]);
      if (shown) slideId = shown.id;
    }
    const shown = deck.slides.find((s) => s.id === slideId);
    // Going into a group holds only while the group is there; on another slide it is gone.
    const into = slideId === before.slideId ? validPath(shown, before.inside) : [];
    const inside = same(into, before.inside) ? before.inside : into;
    const onSlide = new Set(scopeOf(shown, inside).map((e) => e.id));
    const selection = slideId === before.slideId ? before.selection.filter((id) => onSlide.has(id)) : [];
    const picked = slideId === before.slideId ? cellsAfter(before.cells, selection, scopeOf(shown, inside)) : null;
    const cells = sameSelection(picked, before.cells) ? before.cells : picked;
    // A table is edited a cell at a time: with no cell picked there is nothing open.
    const editing = slideId === before.slideId && before.editing && onSlide.has(before.editing) && (cells !== null || !isTableIn(shown, before.editing)) ? before.editing : null;
    const alive = new Set(deck.slides.map((s) => s.id));
    const kept = before.slideSelection.filter((id) => alive.has(id));
    const slideSelection = slideId === before.slideId ? (kept.includes(slideId) ? kept : [slideId, ...kept]) : [slideId];
    this.revision += 1;
    this.patch({
      deck,
      slideId,
      inside,
      selection: same(selection, before.selection) ? before.selection : selection,
      slideSelection: same(slideSelection, before.slideSelection) ? before.slideSelection : slideSelection,
      editing,
      cells,
      ...this.history(),
      saving: { status: "unsaved" },
      revision: this.revision,
      settle: this.replaying ?? (this.gliding ? "glide" : null),
    });
    this.saver.schedule();
  }

  /** Runs a change after which the elements it moved glide to their new places: the view reads `state.settle`. */
  glide<T>(change: () => T): T {
    const was = this.gliding;
    this.gliding = true;
    try {
      return change();
    } finally {
      this.gliding = was;
    }
  }

  // ---- navigation and selection

  goTo(slideId: string): void {
    if (slideId === this.current.slideId || !this.current.deck.slides.some((s) => s.id === slideId)) return;
    this.patch({ slideId, selection: [], inside: [], editing: null, cells: null, slideSelection: [slideId] });
  }

  /** Moves by `delta` slides (or to the ends with -Infinity / Infinity). */
  goBy(delta: number): void {
    const slides = this.current.deck.slides;
    const at = slides.findIndex((s) => s.id === this.current.slideId);
    const to = Math.min(Math.max(at + delta, 0), slides.length - 1);
    const next = slides[to];
    if (next) this.goTo(next.id);
  }

  /** Selects elements on the slide: `replace` them, `add` to the selection, or `toggle` each. */
  select(ids: readonly string[], how: How = "replace"): void {
    const onSlide = new Set(this.scope.map((e) => e.id));
    const wanted = ids.filter((id) => onSlide.has(id));
    let selection: string[];
    if (how === "replace") selection = wanted;
    else if (how === "add") selection = [...new Set([...this.current.selection, ...wanted])];
    else {
      const chosen = new Set(this.current.selection);
      for (const id of wanted) {
        if (!chosen.delete(id)) chosen.add(id);
      }
      selection = [...chosen];
    }
    // Nothing to change only when the slides picked in the filmstrip are already just the one shown: a click on empty canvas, which
    // selects nothing, still takes several picked slides back to it.
    const alone = same(this.current.slideSelection, [this.current.slideId]);
    // Choosing the table whose cells are picked again leaves the cells picked; anything else takes them off.
    const cells = selection.length === 1 && selection[0] === this.current.cells?.table ? this.current.cells : null;
    if (same(selection, this.current.selection) && this.current.editing === null && alone && cells === this.current.cells) return;
    const editing = this.current.editing && selection.length === 1 && selection[0] === this.current.editing ? this.current.editing : null;
    this.patch({ selection, editing, cells, slideSelection: [this.current.slideId] });
  }

  /**
   * Picks cells of a table, selecting the table: the one thing selected. Null takes the cells off and leaves the table selected (the frame).
   * Nothing is open for writing afterwards; `startEditingCell` opens a cell.
   */
  selectCells(cells: CellSelection | null): void {
    this.tables.pick(cells);
  }

  /** Opens the cell at the focus of `cells` for writing, with the caret where `from` says (a press) or at the end of its words. */
  startEditingCell(cells: CellSelection, from?: EditStart): void {
    this.tables.open(cells, from);
  }

  selectAll(): void {
    this.select(this.scope.filter((e) => !e.locked).map((e) => e.id));
  }

  /**
   * Goes into a group of the elements now in view, so that what it holds is what is selected, hit and moved (a double
   * click on it). `child` is the element to select in it.
   */
  enterGroup(id: string, child?: string): void {
    const group = this.scope.find((e) => e.id === id);
    if (group?.type !== "group") return;
    const wanted = child && group.children.some((c) => c.id === child) ? [child] : [];
    this.patch({ inside: [...this.current.inside, id], selection: wanted, editing: null, cells: null, slideSelection: [this.current.slideId] });
  }

  /** Goes up one level out of the groups gone into, and selects the group left, so that the next step up is plain. Answers whether there was a level to leave. */
  leaveGroup(): boolean {
    const { inside } = this.current;
    const left = inside[inside.length - 1];
    if (left === undefined) return false;
    this.patch({ inside: inside.slice(0, -1), selection: [left], editing: null, cells: null });
    return true;
  }

  /** Comes out of every group gone into, selecting nothing. */
  leaveGroups(): void {
    if (this.current.inside.length > 0) this.patch({ inside: [], selection: [], editing: null, cells: null });
  }

  /**
   * Selects slides in the filmstrip; the first (or the one asked for) is shown. Choosing slides is leaving the slide's elements: they are
   * no longer selected, a text box is no longer open, and no group is gone into, even when the slide shown is the same one, so that
   * only one thing looks selected and a key goes to the slides.
   */
  selectSlides(ids: readonly string[], show?: string): void {
    const alive = new Set(this.current.deck.slides.map((s) => s.id));
    const chosen = ids.filter((id) => alive.has(id));
    if (chosen.length === 0) return;
    const slideId = show && chosen.includes(show) ? show : chosen[0]!;
    this.patch({ slideSelection: chosen, slideId, selection: [], inside: [], editing: null, cells: null, editFrom: null });
  }

  setTool(tool: Tool): void {
    if (tool !== this.current.tool) this.patch({ tool, editing: tool === "select" ? this.current.editing : null, ...(tool === "select" ? {} : { cells: null }) });
  }

  /** Starts editing an element's text, selecting only it. `from` is the press that began it, where there was one: the caret goes there. */
  startEditing(id: string, from?: EditStart): void {
    if (!this.scope.some((e) => e.id === id)) return;
    this.patch({ selection: [id], editing: id, cells: null, editFrom: from ?? null, tool: "select" });
  }

  stopEditing(): void {
    if (this.current.editing !== null) this.patch({ editing: null, editFrom: null });
  }

  // ---- history

  undo(): void {
    this.replay("undo");
  }

  redo(): void {
    this.replay("redo");
  }

  private replay(direction: "undo" | "redo"): void {
    this.replaying = direction;
    try {
      this.run(() => (direction === "undo" ? this.engine.undo() : this.engine.redo()));
    } finally {
      this.replaying = null;
    }
  }

  // ---- files

  /** Saves now. */
  flush(): Promise<void> {
    return this.saver.flush();
  }

  /** Puts the editor's version in the file even though the file changed. */
  overwrite(): Promise<void> {
    return this.saver.flush({ overwrite: true });
  }

  /**
   * The file changed outside the editor. With nothing unsaved it is taken as
   * it is; with unsaved changes the two are set side by side as a conflict.
   */
  receive(text: string): void {
    if (this.saver.isOwn(text)) return;
    if (this.current.saving.status === "saved") this.load(text);
    else this.patch({ saving: { status: "conflict", theirs: text } });
  }

  /** Replaces the deck with the text of a file (theirs after a conflict, or a change made outside). */
  load(text: string): void {
    const next = this.run(() => DeckEngine.open(text));
    if (!next) return;
    this.stopListening();
    this.engine.dispose();
    this.engine = next;
    this.listen();
    const slideId = next.deck.slides.some((s) => s.id === this.current.slideId) ? this.current.slideId : (next.deck.slides[0]?.id ?? "");
    // What is selected stays selected where it is still on the slide: a change made outside (an assistant's) does not lose the person's place.
    const loaded = next.deck.slides.find((s) => s.id === slideId);
    const inside = slideId === this.current.slideId ? validPath(loaded, this.current.inside) : [];
    const onSlide = new Set(scopeOf(loaded, inside).map((e) => e.id));
    const kept = slideId === this.current.slideId ? this.current.selection.filter((id) => onSlide.has(id)) : [];
    this.saver.markClean(text);
    this.host.synced?.(text);
    this.revision += 1;
    this.patch({
      deck: next.deck,
      slideId,
      inside,
      selection: same(kept, this.current.selection) ? this.current.selection : kept,
      slideSelection: [slideId],
      editing: null,
      cells: slideId === this.current.slideId ? cellsAfter(this.current.cells, kept, scopeOf(loaded, inside)) : null,
      ...this.history(),
      saving: { status: "saved" },
      revision: this.revision,
      settle: null,
    });
  }

  /** Stops following the engine and writes what is unsaved. */
  async dispose(): Promise<void> {
    this.stopListening();
    this.stopReferences();
    await this.saver.flush();
    this.listeners.clear();
  }
}
