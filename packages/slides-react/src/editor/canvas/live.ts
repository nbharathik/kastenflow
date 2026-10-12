// The live look of a drag. While the pointer is down the deck does not change; what is shown is
// written straight to the page, in the same event, and nothing is drawn by React for it: a move
// slides each element with the browser's `translate`, a turn rotates it, a resize of many things
// stretches them, and the frame and handles of the selection follow. Only an element that is
// resized (a few at a time) is drawn again, through `LiveBoxes`, so that its words run on as the
// box changes. When the gesture ends everything written here is taken away, in the same event
// that hands the deck its one operation, so the page never shows the two at once.

import { type Rect, boundsOf } from "@kasten-slides/canvas";
import type { Element } from "@kasten-slides/wasm";

import { type LiveBoxes, type Placed } from "../../render/live.ts";
import { isCompositeType } from "../composite-kinds.ts";
import { EASE, moveMs, play } from "../motion.ts";
import type { Placement } from "../session/elements.ts";
import type { Preview } from "./controller.ts";
import { type Base, type Look, cssOf, lookOf, sizingOf } from "./live-math.ts";

/** What the live layer needs to know of the page and the deck. */
export interface LiveHost {
  /** The slide page: the slide, and the overlay and badges over it. */
  page(): HTMLElement | null;
  /** Pixels on screen per slide unit. */
  zoom(): number;
  /** An element on the slide, and where the slide has it. */
  find(id: string): { base: Base; element: Element } | null;
  /** The connectors that follow the elements a drag has taken: their boxes. */
  followers(moved: ReadonlyMap<string, Placement>): ReadonlyMap<string, Placement>;
}

const asPlaced = (to: Placement): Placed => {
  const out: Placed = { x: to.x, y: to.y, w: to.w, h: to.h };
  if (to.rotation !== undefined) out.rotation = to.rotation;
  if (to.flipH !== undefined) out.flipH = to.flipH;
  if (to.flipV !== undefined) out.flipV = to.flipV;
  return out;
};

/** A box as an outline is drawn: screen pixels from the top left of the page. */
function frameOf(box: Rect, zoom: number): { left: string; top: string; width: string; height: string } {
  return { left: `${box.x * zoom}px`, top: `${box.y * zoom}px`, width: `${box.w * zoom}px`, height: `${box.h * zoom}px` };
}

/** Draws a drag on the page without drawing the page. */
export class LiveLayer {
  /** What each node had before this layer wrote to it, by property: what to put back. */
  private readonly saved = new Map<HTMLElement, Map<string, string>>();
  /** What this layer last wrote, so that a frame that changes nothing writes nothing. */
  private readonly written = new Map<HTMLElement, Map<string, string>>();
  private nodes: Map<string, HTMLElement[]> | null = null;
  private found = new Map<string, { base: Base; element: Element } | null>();
  private marks: HTMLElement[] | null = null;
  private readonly ghosts = new Map<string, HTMLElement>();

  constructor(
    private readonly host: LiveHost,
    private readonly boxes: LiveBoxes,
  ) {}

  /** Whether anything is being shown. */
  get active(): boolean {
    return this.saved.size > 0;
  }

  /** The nodes of every element on the slide, by id; the open text box goes with its element. */
  private index(page: HTMLElement): Map<string, HTMLElement[]> {
    if (this.nodes) return this.nodes;
    const nodes = new Map<string, HTMLElement[]>();
    const root = page.querySelector<HTMLElement>(".ks-page-scale");
    if (root) {
      for (const node of root.querySelectorAll<HTMLElement>("[data-el]")) {
        const id = node.dataset.el ?? "";
        nodes.set(id, [...(nodes.get(id) ?? []), node]);
      }
      // A box being edited is drawn by the text editor over the slide: it goes with its shape.
      const editing = root.querySelector<HTMLElement>("[data-editing]");
      const id = editing?.dataset.editing;
      if (editing && id) nodes.set(id, [...(nodes.get(id) ?? []), editing]);
    }
    this.nodes = nodes;
    return nodes;
  }

  /** A stand-in for an element, put just above it, which a move that copies slides about. It is no part of the slide: nothing reads it, and it is gone when the move is over. */
  private ghost(id: string, node: HTMLElement): HTMLElement {
    let ghost = this.ghosts.get(id);
    if (!ghost) {
      ghost = node.cloneNode(true) as HTMLElement;
      ghost.removeAttribute("data-el");
      ghost.removeAttribute("data-editing");
      ghost.dataset.ghost = "";
      ghost.style.pointerEvents = "none";
      ghost.setAttribute("aria-hidden", "true");
      node.after(ghost);
      this.ghosts.set(id, ghost);
    }
    return ghost;
  }

  private dropGhosts(): void {
    for (const ghost of this.ghosts.values()) ghost.remove();
    this.ghosts.clear();
  }

  private lookup(id: string): { base: Base; element: Element } | null {
    let entry = this.found.get(id);
    if (entry === undefined) {
      entry = this.host.find(id);
      this.found.set(id, entry);
    }
    return entry;
  }

  private write(node: HTMLElement, property: string, value: string): void {
    let saved = this.saved.get(node);
    if (!saved) this.saved.set(node, (saved = new Map()));
    if (!saved.has(property)) saved.set(property, node.style.getPropertyValue(property));
    let written = this.written.get(node);
    if (!written) this.written.set(node, (written = new Map()));
    if (written.get(property) === value) return;
    written.set(property, value);
    node.style.setProperty(property, value);
  }

  /** Shows what the pointer has done so far. Nothing to show puts everything back. */
  apply(preview: Preview): void {
    const { overrides, gesture } = preview;
    if (overrides.size === 0) return this.release(preview.cancelled === true);
    const page = this.host.page();
    if (!page) return;
    const nodes = this.index(page);
    const zoom = this.host.zoom();

    // What the drag has done to each element, and how that is to be shown.
    const looks: { id: string; look: Look; entry: { base: Base; element: Element }; to: Placement }[] = [];
    let sizing = 0;
    for (const [id, to] of overrides) {
      const entry = this.lookup(id);
      if (!entry) continue;
      const look = lookOf(entry.base, to);
      if (look.kind === "size") sizing += 1;
      looks.push({ id, look, entry, to });
    }
    const exact = new Map<string, Placed>();
    const wide = new Map<string, Placed>();
    const here = new Set<HTMLElement>();
    const lively = looks.length <= 16;
    // A move that copies leaves the elements where they are and slides stand-ins of them.
    const copying = preview.copy && (gesture === "move" || gesture === "grab");
    if (!copying) this.dropGhosts();
    for (const { id, look, entry, to } of looks) {
      let css = cssOf(look);
      if (look.kind === "size" && sizingOf(sizing, entry.base, to, entry.element.type === "group") === "exact") {
        (isCompositeType(entry.element.type) ? wide : exact).set(id, asPlaced(to));
        css = cssOf({ kind: "none" });
      }
      for (const own of nodes.get(id) ?? []) {
        const node = copying && own.dataset.el === id ? this.ghost(id, own) : own;
        here.add(node);
        if (entry.element.type === "group") this.write(node, "transform-origin", `${entry.base.x + entry.base.w / 2}px ${entry.base.y + entry.base.h / 2}px`);
        this.write(node, "translate", css.translate);
        this.write(node, "rotate", css.rotate);
        this.write(node, "scale", css.scale);
        if (lively) this.write(node, "will-change", "translate, rotate, scale");
      }
    }
    // Connectors that stay joined to what has been taken.
    for (const [id, to] of this.host.followers(overrides)) exact.set(id, asPlaced(to));
    this.boxes.set(exact);
    this.boxes.setWide(wide);

    this.chrome(page, looks, overrides, gesture, zoom);
    // What an earlier frame moved and this one does not: back where it was.
    for (const node of [...this.written.keys()]) {
      if (here.has(node) || !node.closest(".ks-page-scale")) continue;
      for (const property of ["translate", "rotate", "scale", "will-change", "transform-origin"]) this.write(node, property, "");
    }
  }

  /** The selection's frame, handles and chip, and the badges, go where the drag has taken what they belong to. */
  private chrome(page: HTMLElement, looks: { id: string; look: Look; to: Placement }[], overrides: ReadonlyMap<string, Placement>, gesture: Preview["gesture"], zoom: number): void {
    const overlay = page.querySelector<HTMLElement>(".ks-overlay");
    if (gesture === "move" || gesture === "grab") {
      // Every element goes the same way, so everything that is the selection's goes with them.
      const first = looks.map(({ look }) => look).find((look) => look.kind === "move");
      const shift = first?.kind === "move" ? `${first.dx * zoom}px ${first.dy * zoom}px` : "0px 0px";
      if (overlay) for (const node of overlay.querySelectorAll<HTMLElement>("[data-chrome]")) this.write(node, "translate", shift);
      this.badges(page, looks, zoom);
      return;
    }
    if (!overlay) return;
    // A resize or a turn: the frames take the boxes the drag gives; the handles are inside them.
    const taken: Rect[] = [];
    for (const to of overrides.values()) taken.push(boundsOf(to));
    for (const node of overlay.querySelectorAll<HTMLElement>("[data-frame]")) {
      const id = node.dataset.frame ?? "";
      const to = overrides.get(id);
      const box = id === "*" ? unionOf(taken) : to;
      if (!box) continue;
      for (const [property, value] of Object.entries(frameOf(box, zoom))) this.write(node, property, value);
      if (id !== "*" && to?.rotation !== undefined) this.write(node, "transform", to.rotation ? `rotate(${to.rotation}deg)` : "");
    }
    // The two ends of a line follow the pointer.
    for (const node of overlay.querySelectorAll<HTMLElement>("[data-end]")) {
      const [id, to] = [...overrides][0] ?? [];
      if (!id || !to) continue;
      const start = node.dataset.end === "start";
      const left = (start ? to.flipH : !to.flipH) ? to.x + to.w : to.x;
      const top = (start ? to.flipV : !to.flipV) ? to.y + to.h : to.y;
      this.write(node, "left", `${left * zoom}px`);
      this.write(node, "top", `${top * zoom}px`);
    }
  }

  private badges(page: HTMLElement, looks: { id: string; look: Look }[], zoom: number): void {
    this.marks ??= [...page.querySelectorAll<HTMLElement>("[data-agent-badge]")];
    if (this.marks.length === 0) return;
    const by = new Map(looks.map(({ id, look }) => [id, look]));
    for (const node of this.marks) {
      const look = by.get(node.dataset.agentBadge ?? "");
      if (look?.kind === "move") this.write(node, "translate", `${look.dx * zoom}px ${look.dy * zoom}px`);
    }
  }

  /** Takes everything this layer wrote away. With `cancelled` what was slid glides back to where it was. */
  release(cancelled = false): void {
    if (this.saved.size === 0 && !this.nodes) {
      this.boxes.clear();
      return;
    }
    const back: { node: HTMLElement; from: { translate: string; rotate: string; scale: string } }[] = [];
    if (cancelled) {
      for (const [node, written] of this.written) {
        const from = { translate: written.get("translate") ?? "", rotate: written.get("rotate") ?? "", scale: written.get("scale") ?? "" };
        if (from.translate || from.rotate || from.scale) back.push({ node, from });
      }
    }
    this.dropGhosts();
    for (const [node, saved] of this.saved) for (const [property, value] of saved) node.style.setProperty(property, value);
    this.saved.clear();
    this.written.clear();
    this.nodes = null;
    this.marks = null;
    this.found = new Map();
    this.boxes.clear();
    for (const { node, from } of back) {
      play(
        node,
        [
          { translate: from.translate || "0 0", rotate: from.rotate || "0deg", scale: from.scale || "1 1" },
          { translate: "0 0", rotate: "0deg", scale: "1 1" },
        ],
        { duration: moveMs(node), easing: EASE },
      );
    }
  }
}

const unionOf = (rects: readonly Rect[]): Rect | null => {
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((r) => r.x));
  const top = Math.min(...rects.map((r) => r.y));
  return { x: left, y: top, w: Math.max(...rects.map((r) => r.x + r.w)) - left, h: Math.max(...rects.map((r) => r.y + r.h)) - top };
};
