// What the pointer does on the slide. The React component only turns DOM events
// into calls here and draws `preview`; every decision is made in this class, so
// it is tested with plain numbers. A drag never touches the deck until it ends:
// the preview is drawn from `overrides`, and the result is one engine operation.

import {
  type Guide,
  type Handle,
  MarqueeSession,
  MoveSession,
  type Point,
  type Rect,
  ResizeSession,
  RotateSession,
  type Item,
  boundsOf,
  selectionBounds,
} from "@kasten-slides/canvas";

import type { EditorSession } from "../session/session.ts";
import type { Placement } from "../session/elements.ts";
import type { Place } from "../table/cells.ts";
import { dragCells, pickCell, pressCells } from "../table/pointer.ts";
import type { EditorUi } from "../ui-state.ts";
import { doubleClickAt } from "./double-click.ts";
import { drawEnd, finishDraw } from "./drawing.ts";
import { isEmptyPlaceholder } from "./empty.ts";
import { hitAt, itemsOf } from "./geometry.ts";
import { endPoint, endPreview, finishEnd } from "./line-end.ts";

export { boxOfPoints, lineBox, snapAngle } from "./drawing.ts";

/** A pointer event, already in slide units. */
export interface PointerInfo {
  x: number;
  y: number;
  shift: boolean;
  alt: boolean;
  /** Ctrl, or Cmd on a Mac: adds to the selection like Shift. */
  mod: boolean;
  /** 0 is the main button. */
  button: number;
  /** How many presses in a row: 2 is a double click. */
  detail: number;
  /** Where the pointer is in the window, when it is known: a press that starts typing puts the caret there. */
  client?: { x: number; y: number };
}

/**
 * What the press landed on. `move` is the move handle: of the block `id`, or of the selection when `id` is null.
 */
export type Target = { kind: "surface" } | { kind: "handle"; handle: Handle } | { kind: "rotate" } | { kind: "end"; end: "start" | "end" } | { kind: "move"; id: string | null };

/** What the pointer is doing to the slide. `grab` is a move that was begun on the move handle. */
export type GestureKind = "move" | "grab" | "resize" | "rotate" | "marquee" | "end" | "draw";

/** What is drawn over the slide while a gesture goes on. */
export interface Preview {
  /** Where the dragged elements are now, for the slide to draw them there. */
  overrides: ReadonlyMap<string, Placement>;
  guides: readonly Guide[];
  /** The selection rectangle being dragged. */
  marquee: Rect | null;
  /** What the rectangle would select, outlined while it is dragged: the selection itself changes when the pointer is let go, so nothing else draws again for each step of the drag. */
  hits: readonly string[];
  /** The box or line of a new element being drawn. */
  drawing: { tool: string; from: Point; to: Point } | null;
  /** The angle while turning, in degrees. */
  angle: number | null;
  /** What is going on, once a press has become one; null between gestures. */
  gesture: GestureKind | null;
  /** A move that will leave the elements where they are and put copies where it ends (Alt or Ctrl held): the copies are what moves. */
  copy: boolean;
  /** The gesture was called off (Escape), not finished: what was shown goes back where it was. */
  cancelled?: boolean;
}

const NONE: Preview = { overrides: new Map(), guides: [], marquee: null, hits: [], drawing: null, angle: null, gesture: null, copy: false };

type Gesture =
  | { kind: "move"; session: MoveSession; ids: string[]; clicked: string; wasSelected: boolean; extend: boolean; items: Item[]; grab: boolean; ctrl: boolean }
  | { kind: "resize"; session: ResizeSession }
  | { kind: "rotate"; session: RotateSession }
  | { kind: "marquee"; session: MarqueeSession; extend: boolean; from: Point; moved: boolean; click: string | null }
  | { kind: "end"; id: string; end: "start" | "end"; fixed: Point; from: Point }
  | { kind: "cells"; table: string; anchor: Place }
  | { kind: "draw"; tool: string; from: Point };

const placementOf = (item: Item, point: Point): Placement => ({ x: point.x, y: point.y, w: item.w, h: item.h });

export class CanvasController {
  private gesture: Gesture | null = null;
  private current: Preview = NONE;
  private readonly listeners = new Set<() => void>();
  private readonly gestureListeners = new Set<() => void>();

  constructor(
    private readonly session: EditorSession,
    private readonly ui: EditorUi,
    /** The scale the slide is drawn at: pixels on screen per slide unit. */
    private readonly zoom: () => number,
  ) {}

  get preview(): Preview {
    return this.current;
  }

  get busy(): boolean {
    return this.gesture !== null;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): Preview => this.current;

  /**
   * Which kind of gesture is going on, for the parts of the screen that change only when a gesture begins or ends (the cursor,
   * the handles that step aside): they do not follow each step of the pointer, so they are not drawn again for it.
   */
  subscribeGesture = (listener: () => void): (() => void) => {
    this.gestureListeners.add(listener);
    return () => this.gestureListeners.delete(listener);
  };

  getGesture = (): GestureKind | null => this.current.gesture;

  private show(preview: Preview): void {
    const before = this.current.gesture;
    this.current = preview;
    for (const listener of [...this.listeners]) listener();
    if (before !== preview.gesture) for (const listener of [...this.gestureListeners]) listener();
  }

  private end(cancelled = false): void {
    this.gesture = null;
    this.show(cancelled ? { ...NONE, cancelled: true } : NONE);
  }

  private get frame() {
    const { w, h } = this.session.deck.size;
    return { width: w, height: h, margin: 0 };
  }

  private snapOn(mods: { alt: boolean }): boolean {
    return this.ui.state.snap && !mods.alt;
  }

  // ---- press

  down(p: PointerInfo, target: Target): void {
    if (this.gesture || p.button !== 0) return;
    const at = { x: p.x, y: p.y };
    const tool = this.session.state.tool;
    if (target.kind === "handle") return this.startResize(at, target.handle);
    if (target.kind === "rotate") return this.startRotate(at);
    if (target.kind === "end") return this.startEnd(at, target.end);
    if (target.kind === "move") return this.startGrab(at, target.id);
    if (tool !== "select") {
      this.session.stopEditing();
      this.gesture = { kind: "draw", tool, from: at };
      return this.show({ ...NONE, drawing: { tool, from: at, to: at }, gesture: "draw" });
    }
    const items = itemsOf(this.session);
    const id = hitAt(items, at, this.zoom());
    const extend = p.shift || p.mod;
    // A press outside what the group they went into holds comes out of the group, and goes on as a press at the level above.
    if (id === null && this.session.state.inside.length > 0) {
      this.session.leaveGroups();
      return this.down(p, target);
    }
    // A slot nothing is in covers much of the slide, so a press on it is no press on something: a drag from it is a selection
    // rectangle, and a click that goes nowhere selects the slot.
    const slot = id !== null && !this.session.state.selection.includes(id) && isEmptyPlaceholder(this.session.scope.find((e) => e.id === id)) ? id : null;
    if (id === null || slot !== null) {
      this.session.stopEditing();
      return this.startMarquee(items, at, p, slot);
    }
    // A press on a table whose cells are picked picks cells (Shift extends); the table itself is moved from its handle or its frame.
    const picked = pressCells(this.session, id, at, extend);
    if (picked) {
      this.gesture = { kind: "cells", table: picked.table, anchor: picked.anchor };
      return this.show(NONE);
    }
    const wasSelected = this.session.state.selection.includes(id);
    if (this.session.state.editing !== null && this.session.state.editing !== id) this.session.stopEditing();
    // Shift toggles at once. Ctrl (Cmd) adds what is not yet selected but leaves the toggle to the release, because a press
    // that goes on to a drag is a copy, which needs the thing under the pointer to be part of what is dragged.
    const ctrl = p.mod && !p.shift;
    if (p.shift) this.session.select([id], "toggle");
    else if (ctrl) {
      if (!wasSelected) this.session.select([id], "add");
    } else if (!wasSelected) this.session.select([id]);
    const ids = this.session.state.selection.filter((chosen) => items.some((i) => i.id === chosen && !i.locked));
    if (ids.length === 0 || !this.session.state.selection.includes(id)) return;
    if (this.session.state.editing === id) return;
    this.beginMove(items, ids, at, { clicked: id, wasSelected, extend, grab: false, ctrl });
  }

  /** The selection rectangle from a press at `at`; `click` is the empty slot the press was on, which a click that goes nowhere selects. */
  private startMarquee(items: Item[], at: Point, p: PointerInfo, click: string | null): void {
    // Alt takes whatever the rectangle touches, not only what it holds whole; an empty slot is never taken that way.
    const touch = p.alt;
    const extend = p.shift || p.mod;
    const all = items.filter((i) => !i.locked && !(touch && isEmptyPlaceholder(this.session.scope.find((e) => e.id === i.id))));
    const session = MarqueeSession.start({ all, origin: at, base: this.session.state.selection, additive: extend, mode: touch ? "touch" : "contain" });
    this.gesture = { kind: "marquee", session, extend, from: at, moved: false, click };
    this.show(NONE);
  }

  /**
   * A press on the grey stage round the slide: a selection rectangle can begin there too (its corner may be off the slide, so the slide
   * units may be negative), and a click that goes nowhere takes the selection off. Answers whether a gesture began.
   */
  stageDown(p: PointerInfo): boolean {
    if (this.gesture || p.button !== 0 || this.session.state.tool !== "select") return false;
    this.session.stopEditing();
    this.startMarquee(itemsOf(this.session), { x: p.x, y: p.y }, p, null);
    return true;
  }

  /** The move of `ids` from a press at `at`: the one gesture a press on a block and a press on its move handle both start. */
  private beginMove(items: Item[], ids: string[], at: Point, how: { clicked: string; wasSelected: boolean; extend: boolean; grab: boolean; ctrl: boolean }): void {
    this.gesture = {
      kind: "move",
      session: MoveSession.start({ items: items.filter((i) => ids.includes(i.id)), all: items, frame: this.frame, grabbed: at, threshold: 3 / this.zoom(), snapThreshold: 6 / this.zoom() }),
      ids,
      items,
      ...how,
    };
  }

  /**
   * A press on a move handle: the move of a press on the block, though the pointer is not over it. The handle of the
   * selection moves the selection, and a text box being edited stays open (the handle is not text, so the caret and what
   * is selected in it are left alone); the handle of a block that is not selected selects it first, and closes any other
   * text box being edited. Modifier keys do not change the selection here: Shift is the axis lock of the move.
   */
  private startGrab(at: Point, id: string | null): void {
    if (this.session.state.tool !== "select") return;
    const items = itemsOf(this.session);
    if (id !== null) {
      if (!items.some((i) => i.id === id && !i.locked)) return;
      if (this.session.state.editing !== null && this.session.state.editing !== id) this.session.stopEditing();
      if (!this.session.state.selection.includes(id)) this.session.select([id]);
    }
    const ids = this.session.state.selection.filter((chosen) => items.some((i) => i.id === chosen && !i.locked));
    const first = ids[0];
    if (first === undefined) return;
    this.beginMove(items, ids, at, { clicked: id ?? first, wasSelected: true, extend: false, grab: true, ctrl: false });
    this.show({ ...NONE, gesture: "grab" });
  }

  private startResize(at: Point, handle: Handle): void {
    const items = itemsOf(this.session);
    const chosen = items.filter((i) => this.session.state.selection.includes(i.id) && !i.locked);
    if (chosen.length === 0) return;
    this.gesture = { kind: "resize", session: ResizeSession.start({ items: chosen, handle, all: items, frame: this.frame, grabbed: at, snapThreshold: 6 / this.zoom() }) };
  }

  private startRotate(at: Point): void {
    const chosen = itemsOf(this.session).filter((i) => this.session.state.selection.includes(i.id) && !i.locked);
    if (chosen.length === 0) return;
    this.gesture = { kind: "rotate", session: RotateSession.start({ items: chosen, grabbed: at }) };
  }

  private startEnd(at: Point, end: "start" | "end"): void {
    const items = itemsOf(this.session);
    const id = this.session.state.selection[0];
    const item = items.find((i) => i.id === id);
    const element = this.session.scope.find((e) => e.id === id);
    if (!item || !element || item.locked) return;
    // A line runs from the box's top left to its bottom right, turned by the flips.
    const a = { x: element.flipH ? item.x + item.w : item.x, y: element.flipV ? item.y + item.h : item.y };
    const b = { x: element.flipH ? item.x : item.x + item.w, y: element.flipV ? item.y : item.y + item.h };
    this.gesture = { kind: "end", id: item.id, end, fixed: end === "start" ? b : a, from: at };
  }

  // ---- move

  move(p: PointerInfo): void {
    const g = this.gesture;
    if (!g) return;
    const at = { x: p.x, y: p.y };
    if (g.kind === "move") {
      const { moves, guides } = g.session.update(at, { shift: p.shift, noSnap: !this.ui.state.snap });
      if (!g.session.moved) return;
      const overrides = new Map<string, Placement>();
      for (const item of g.items) {
        const to = moves.get(item.id);
        if (to) overrides.set(item.id, { ...placementOf(item, to), ...(item.rotation ? { rotation: item.rotation } : {}) });
      }
      this.show({ ...NONE, overrides, guides, gesture: g.grab ? "grab" : "move", copy: this.copies(g, p) });
    } else if (g.kind === "resize") {
      const { boxes, guides } = g.session.update(at, { shift: p.shift, alt: p.alt, noSnap: !this.ui.state.snap });
      this.show({ ...NONE, overrides: this.absolute(boxes), guides, gesture: "resize" });
    } else if (g.kind === "rotate") {
      const { boxes, angle } = g.session.update(at, { shift: p.shift });
      this.show({ ...NONE, overrides: boxes, angle, gesture: "rotate" });
    } else if (g.kind === "marquee") {
      const state = g.session.update(at);
      g.moved ||= Math.hypot(at.x - g.from.x, at.y - g.from.y) * this.zoom() >= 3;
      // The rectangle outlines what it would take; the selection is made when the pointer is let go.
      this.show({ ...NONE, marquee: state.rect, hits: state.ids, gesture: "marquee" });
    } else if (g.kind === "end") {
      this.show({ ...NONE, overrides: endPreview(g, endPoint(this.session, this.zoom(), g, at, p.shift)), gesture: "end" });
    } else if (g.kind === "cells") {
      dragCells(this.session, g.table, g.anchor, at);
    } else {
      this.show({ ...NONE, drawing: { tool: g.tool, from: g.from, to: drawEnd(this.session, this.zoom(), g.tool, g.from, at, p.shift) }, gesture: "draw" });
    }
  }

  /**
   * A click on a text box that went nowhere, with nothing held, is a click to write in it, as in every editor of slides: the box
   * opens with the caret where the pointer was. A shape opens on a double click, and a box that is locked does not open.
   */
  private writeIn(id: string, p: PointerInfo): void {
    const element = this.session.scope.find((e) => e.id === id);
    if (element?.type !== "text" || element.locked || p.alt || p.shift || p.mod) return;
    this.session.startEditing(id, p.client ? { at: p.client } : undefined);
  }

  /** Whether the move being made leaves what it moves where it is and puts copies where it ends: Alt, or Ctrl (Cmd), held, with nothing being typed. */
  private copies(g: Extract<Gesture, { kind: "move" }>, p: PointerInfo): boolean {
    return (p.alt || (p.mod && !p.shift)) && this.session.state.editing === null && g.ids.length > 0;
  }

  // ---- release

  up(p: PointerInfo): void {
    const g = this.gesture;
    if (!g) return;
    const at = { x: p.x, y: p.y };
    this.gesture = null;
    if (g.kind === "move") {
      const result = g.session.end(at, { shift: p.shift, noSnap: !this.ui.state.snap });
      if (result.moved) {
        const placements = new Map<string, Placement>();
        for (const item of g.items) {
          const to = result.moves.get(item.id);
          if (to) placements.set(item.id, placementOf(item, to));
        }
        this.show(NONE);
        const first = g.items.find((item) => result.moves.has(item.id));
        const to = first ? result.moves.get(first.id) : undefined;
        // Alt or Ctrl held as it ends: the elements stay and copies land where the pointer took them.
        if (first && to && this.copies(g, p)) this.session.elements.duplicate(g.ids, to.x - first.x, to.y - first.y);
        else this.session.elements.place(placements);
        return;
      }
      // A press that did not move: on one of several selected, it picks that one. A Ctrl press on one that was selected takes it out.
      if (g.wasSelected && !g.extend && !g.grab && g.ids.length > 1) this.session.select([g.clicked]);
      else if (g.ctrl && g.wasSelected) this.session.select([g.clicked], "toggle");
      // A click on a table picks the cell under it; a click on a text box is a click to write in it.
      else if (!g.extend && !g.grab && g.ids.length === 1 && !pickCell(this.session, g.clicked, at)) this.writeIn(g.clicked, p);
    } else if (g.kind === "resize") {
      const result = g.session.end(at, { shift: p.shift, alt: p.alt, noSnap: !this.ui.state.snap });
      this.show(NONE);
      if (result.changed) this.session.elements.place(this.absolute(result.boxes));
      return;
    } else if (g.kind === "rotate") {
      const result = g.session.end(at, { shift: p.shift });
      this.show(NONE);
      if (result.changed) this.session.elements.place(result.boxes);
      return;
    } else if (g.kind === "marquee") {
      const state = g.session.end(at);
      g.moved ||= Math.hypot(at.x - g.from.x, at.y - g.from.y) * this.zoom() >= 3;
      // A click on an empty slot that went nowhere selects the slot (with Shift or Ctrl it is added or taken away, as for any element).
      if (!g.moved && g.click !== null) {
        this.session.select([g.click], g.extend ? "toggle" : "replace");
        // A click on a slot with nothing in it is a click to write in it.
        if (!g.extend) this.writeIn(g.click, p);
      } else this.session.select(state.ids);
    } else if (g.kind === "end") {
      finishEnd(this.session, this.zoom(), g, endPoint(this.session, this.zoom(), g, at, p.shift));
    } else if (g.kind === "cells") {
      dragCells(this.session, g.table, g.anchor, at);
    } else {
      finishDraw(this.session, this.zoom(), g.tool, g.from, drawEnd(this.session, this.zoom(), g.tool, g.from, at, p.shift), this.snapOn({ alt: p.alt }));
    }
    this.show(NONE);
  }

  /** A resize reports a flip when the drag crossed the far edge, meaning "toggle": the element's own flip after it. */
  private absolute(boxes: ReadonlyMap<string, Placement>): Map<string, Placement> {
    const out = new Map<string, Placement>();
    for (const [id, box] of boxes) {
      const element = this.session.scope.find((e) => e.id === id);
      const { flipH, flipV, ...rest } = box;
      out.set(id, { ...rest, ...(flipH ? { flipH: !element?.flipH } : {}), ...(flipV ? { flipV: !element?.flipV } : {}) });
    }
    return out;
  }

  /** Escape during a gesture: put everything back as it was. */
  cancel(): boolean {
    if (!this.gesture) return false;
    this.end(true);
    return true;
  }

  /** A double click: opens the words, the cell, the group or the format options of what is under the pointer (see `doubleClickAt`). */
  doubleClick(p: PointerInfo): void {
    doubleClickAt(this.session, this.ui, this.zoom(), p);
  }

  /** The box round the selection, for drawing its frame and handles. */
  selectionBox(): Rect | null {
    const items = itemsOf(this.session);
    return selectionBounds(items, this.session.state.selection);
  }

  /** Every selected element's own turned box. */
  selectedItems(): Item[] {
    const chosen = new Set(this.session.state.selection);
    return itemsOf(this.session).filter((i) => chosen.has(i.id));
  }

  outline(item: Item): Rect {
    return boundsOf(item);
  }
}
