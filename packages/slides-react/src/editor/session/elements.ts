// Element commands: what the canvas, the toolbar and the Arrange menu do to
// the elements on the slide. Each is one engine operation, so each is one step
// of undo.

import type { AlignMode, Arrange, Axis, Element, JsonValue, Text, Transform } from "@kasten-slides/wasm";

import { boxOf } from "../../theme/index.ts";
import { STEP } from "./clipboard.ts";
import { findElement } from "./scope.ts";
import type { EditorSession } from "./session.ts";
import type { Box } from "./types.ts";

/** A JSON merge patch: keys to set, and null to remove one. */
export type Patch = { [key: string]: JsonValue };

/** Where an element ended up after a drag: what changed of its box, turn and flips. */
export interface Placement {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  flipH?: boolean;
  flipV?: boolean;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** How long after a tap of an arrow key the next one still belongs to the same step of undo, in milliseconds. */
export const BURST_MS = 800;

export class ElementCommands {
  /** The last nudge: which elements, the revision it made and when, for joining the next tap to it. */
  private burst: { key: string; revision: number; at: number } | null = null;

  constructor(private readonly s: EditorSession) {}

  private get slideId(): string {
    return this.s.state.slideId;
  }

  private get chosen(): string[] {
    return [...this.s.state.selection];
  }

  /** The elements with these ids, in stacking order: those among the ones in view (the slide's own, or what a group gone into holds), then any other that is somewhere on the slide. */
  find(ids: readonly string[] = this.chosen): Element[] {
    const wanted = new Set(ids);
    const inView = this.s.scope.filter((e) => wanted.has(e.id));
    if (inView.length === wanted.size) return inView;
    const seen = new Set(inView.map((e) => e.id));
    const elsewhere = [...wanted].flatMap((id) => {
      const found = seen.has(id) ? undefined : findElement(this.s.slide.elements, id);
      return found ? [found] : [];
    });
    return [...inView, ...elsewhere];
  }

  /** Where an element is on the slide, whether it says so or its layout does. */
  boxOf(element: Element): Box | null {
    return boxOf(this.s.deck.theme, this.s.slide.layout, element);
  }

  /** Adds elements on top of the slide, selects them and puts the pointer tool back. Resolves to their ids. */
  insert(elements: Element[], at?: number): string[] {
    const done = this.s.run(() => this.s.core.apply("add_elements", { slide: this.slideId, elements, ...(at === undefined ? {} : { at }) }));
    if (!done) return [];
    this.s.setTool("select");
    this.s.select(done.output.ids);
    return done.output.ids;
  }

  /** Changes properties with a merge patch. The same patch goes to every element. */
  patch(patch: Patch, ids: readonly string[] = this.chosen): void {
    if (ids.length === 0) return;
    this.s.run(() => this.s.core.apply("patch_elements", { slide: this.slideId, patches: ids.map((id) => ({ id, patch })) }));
  }

  /** Changes looks: fill, stroke, radius, shadow, opacity, arrows. */
  style(style: Patch, ids: readonly string[] = this.chosen): void {
    this.patch({ style }, ids);
  }

  /** Changes boxes, turns and flips. `join` makes it part of the step before it, which a burst of arrow keys is. */
  transform(items: Transform[], join = false): void {
    if (items.length === 0) return;
    const input = { slide: this.slideId, items };
    this.s.run(() => (join ? this.s.core.applyIntoLast("transform_elements", input) : this.s.core.apply("transform_elements", input)));
  }

  /** Applies where a drag left the elements, by id. */
  place(placements: ReadonlyMap<string, Placement>): void {
    // A group is turned by a number of degrees, where other elements are set to an angle.
    const before = new Map(this.find([...placements.keys()]).map((e) => [e.id, e.type === "group" ? (e.rotation ?? 0) : null]));
    this.transform(
      [...placements].map(([id, p]) => ({
        id,
        x: round(p.x),
        y: round(p.y),
        w: round(p.w),
        h: round(p.h),
        ...(p.rotation === undefined ? {} : { rotation: round(p.rotation - (before.get(id) ?? 0)) }),
        ...(p.flipH === undefined ? {} : { flipH: p.flipH }),
        ...(p.flipV === undefined ? {} : { flipV: p.flipV }),
      })),
    );
  }

  /**
   * Moves the selection by `dx`, `dy` slide units. Taps of the arrow keys that follow one another on the same elements, with
   * nothing else done between them, are one step of undo, as a drag is: a person who nudged five times undoes it once.
   */
  nudge(dx: number, dy: number, ids: readonly string[] = this.chosen): void {
    const items: Transform[] = [];
    for (const element of this.find(ids)) {
      const box = this.boxOf(element);
      if (box && !element.locked) items.push({ id: element.id, x: round(box.x + dx), y: round(box.y + dy) });
    }
    const key = items.map((item) => item.id).join(",");
    const now = Date.now();
    const burst = this.burst;
    const joined = burst !== null && burst.key === key && burst.revision === this.s.state.revision && now - burst.at < BURST_MS;
    this.transform(items, joined);
    this.burst = items.length > 0 ? { key, revision: this.s.state.revision, at: now } : null;
  }

  remove(ids: readonly string[] = this.chosen): void {
    if (ids.length > 0) this.s.run(() => this.s.core.apply("delete_elements", { slide: this.slideId, ids: [...ids] }));
  }

  arrange(to: Arrange, ids: readonly string[] = this.chosen): void {
    if (ids.length > 0) this.s.run(() => this.s.core.apply("reorder_elements", { slide: this.slideId, ids: [...ids], to }));
  }

  /** Groups the selection and selects the group. */
  group(ids: readonly string[] = this.chosen): void {
    if (ids.length < 2) return;
    const done = this.s.run(() => this.s.core.apply("group_elements", { slide: this.slideId, ids: [...ids] }));
    if (done) this.s.select([done.output.group]);
  }

  /** Ungroups the selected groups and selects what they held. Several groups are one step of undo. */
  ungroup(ids: readonly string[] = this.chosen): void {
    const groups = this.find(ids).filter((e) => e.type === "group");
    if (groups.length === 0) return;
    const done = this.s.run(() =>
      this.s.core.applyBatch(groups.map((group) => ["ungroup_element", { slide: this.slideId, id: group.id }] as ["ungroup_element", { slide: string; id: string }])),
    );
    const freed = (done ?? []).flatMap((applied) => ((applied.output as { ids?: string[] }).ids ?? []));
    if (freed.length > 0) this.s.select(freed);
  }

  /** Aligns the elements to each other; one element aligns to the slide. */
  align(mode: AlignMode, ids: readonly string[] = this.chosen): void {
    if (ids.length > 0) this.s.glide(() => this.s.run(() => this.s.core.apply("align_elements", { slide: this.slideId, ids: [...ids], mode })));
  }

  distribute(axis: Axis, ids: readonly string[] = this.chosen): void {
    if (ids.length > 2) this.s.glide(() => this.s.run(() => this.s.core.apply("distribute_elements", { slide: this.slideId, ids: [...ids], axis })));
  }

  /** Copies the elements 16 units down and right (as a paste is), or `dx` and `dy` away (a drag that copies), and selects the copies. */
  duplicate(ids: readonly string[] = this.chosen, dx?: number, dy?: number): void {
    if (ids.length === 0) return;
    const offset = dx === undefined && dy === undefined ? { dx: STEP, dy: STEP } : { dx: round(dx ?? 0), dy: round(dy ?? 0) };
    const done = this.s.run(() => this.s.core.apply("duplicate_elements", { slide: this.slideId, ids: [...ids], ...offset }));
    if (done) this.s.select(done.output.ids);
  }

  flip(axis: "horizontal" | "vertical", ids: readonly string[] = this.chosen): void {
    this.transform(
      this.find(ids).map((e) => (axis === "horizontal" ? { id: e.id, flipH: !e.flipH } : { id: e.id, flipV: !e.flipV })),
    );
  }

  /** Turns each element by `degrees` clockwise. */
  rotateBy(degrees: number, ids: readonly string[] = this.chosen): void {
    this.s.glide(() => this.transform(this.find(ids).map((e) => ({ id: e.id, rotation: (((e.rotation ?? 0) + degrees) % 360 + 360) % 360 }))));
  }

  lock(locked: boolean, ids: readonly string[] = this.chosen): void {
    this.patch({ locked }, ids);
  }

  /**
   * Writes text an editor finished with, unless it is what the element already holds.
   * `slideId` is the slide the box was on when editing began: the person may have moved on since.
   * `join` makes it part of the step before it (a box just made and the first words typed in it are one step of undo).
   */
  setText(id: string, text: Text, slideId: string = this.slideId, join = false): void {
    const element = this.s.deck.slides.find((slide) => slide.id === slideId)?.elements.find((e) => e.id === id);
    if (!element) return;
    const held = element.type === "text" ? element.text : element.type === "shape" ? element.text : element.type === "connector" ? element.label : null;
    if (held && JSON.stringify(held) === JSON.stringify(text)) return;
    const input = { slide: slideId, id, text };
    this.s.run(() => (join ? this.s.core.applyIntoLast("set_rich_text", input) : this.s.core.apply("set_rich_text", input)));
  }

  /** Makes a text box as tall as its words: part of the step before it (`join`, the one that wrote the words) or a step of its own. */
  setHeight(id: string, height: number, slideId: string = this.slideId, join = false): void {
    const input = { slide: slideId, patches: [{ id, patch: { h: height } }] };
    this.s.run(() => (join ? this.s.core.applyIntoLast("patch_elements", input) : this.s.core.apply("patch_elements", input)));
  }

  /** Finds and replaces across the deck; resolves to how many were replaced. */
  replaceAll(find: string, replace: string, options: { caseSensitive?: boolean; wholeWord?: boolean; includeNotes?: boolean } = {}): number {
    const done = this.s.run(() => this.s.core.apply("replace_all", { find, replace, ...options }));
    return done ? done.output.count : 0;
  }
}
