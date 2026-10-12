// The graph canvas's behaviour, apart from React: sizing, the camera, what is
// under the pointer, pan and zoom, clicks, a link dragged out of a node, and
// the keys. It draws on request (once per frame at most) and keeps no copy of
// the places: it reads them from the layout as it draws.

import { MAX_ZOOM, MIN_ZOOM, between, boundsOf, centreOn, fitBounds, panBy, toScreen, toWorld, zoomAt, type Camera } from "./camera";
import { readPalette, type Palette } from "./colours";
import { drawGraph, screenRadius } from "./draw";
import { DOUBLE_CLICK_MS, type Handlers, type Keys, type Settings } from "./controller-types";
import { neighbourToward, neighbourhood, type Model } from "./graph-model";
import { QuadTree } from "./quadtree";

export { DOUBLE_CLICK_MS, type Handlers, type Keys, type Settings } from "./controller-types";

/** How far the pointer moves before a press is a drag, not a click. */
const DRAG_PX = 5;
/** The closest a small graph is framed: a dozen nodes should fill the window, not sit in a corner of it. */
const FIT_ZOOM = 4;

type Drag = { mode: "pan"; x: number; y: number; cam: Camera; moved: boolean } | { mode: "node"; index: number; x: number; y: number; moved: boolean; keys: Keys };

const keysOf = (e: MouseEvent): Keys => ({ ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey, button: e.button });
const motionOff = () => document.documentElement.dataset.motion === "off" || (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);

export class GraphController {
  private readonly ctx: CanvasRenderingContext2D | null;
  private cam: Camera = { x: 0, y: 0, k: 1 };
  private width = 0;
  private height = 0;
  private ratio = 1;
  private model: Model = { nodes: [], edges: [], origin: [], neighbours: [] };
  private settings: Settings = { colourBy: "kind", selected: -1, nameAll: false, editable: true };
  private hover = -1;
  private lit: Set<number> | null = null;
  private drag: Drag | null = null;
  private link: { from: number; x: number; y: number; over: number } | null = null;
  private tree = new QuadTree(0);
  private treeFor: Float32Array | null = null;
  private palette: Palette = readPalette();
  private font = { size: 12, family: "sans-serif" };
  private userMoved = false;
  private pending = 0;
  private flight = 0;
  private click = 0;
  private readonly watch: ResizeObserver | null;
  private readonly look: MutationObserver | null;
  private dead = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly handlers: Handlers,
    private readonly places: () => Float32Array | null,
  ) {
    this.ctx = canvas.getContext("2d");
    this.watch = typeof ResizeObserver === "function" ? new ResizeObserver(() => this.resize()) : null;
    this.watch?.observe(canvas);
    // A theme change repaints with the new colours.
    this.look = typeof MutationObserver === "function" ? new MutationObserver(() => this.restyle()) : null;
    this.look?.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
    canvas.addEventListener("mousedown", this.onDown);
    canvas.addEventListener("mousemove", this.onHover);
    canvas.addEventListener("mouseleave", this.onLeave);
    canvas.addEventListener("dblclick", this.onDouble);
    canvas.addEventListener("contextmenu", this.onContext);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("keydown", this.onKey);
    this.restyle();
    this.resize();
  }

  destroy(): void {
    this.dead = true;
    this.watch?.disconnect();
    this.look?.disconnect();
    cancelAnimationFrame(this.pending);
    cancelAnimationFrame(this.flight);
    clearTimeout(this.click);
    window.removeEventListener("mousemove", this.onMove);
    window.removeEventListener("mouseup", this.onUp);
    const c = this.canvas;
    c.removeEventListener("mousedown", this.onDown);
    c.removeEventListener("mousemove", this.onHover);
    c.removeEventListener("mouseleave", this.onLeave);
    c.removeEventListener("dblclick", this.onDouble);
    c.removeEventListener("contextmenu", this.onContext);
    c.removeEventListener("wheel", this.onWheel);
    c.removeEventListener("keydown", this.onKey);
  }

  /** The model or the settings changed. */
  update(model: Model, settings: Settings): void {
    if (model !== this.model) {
      this.model = model;
      this.hover = -1;
      this.lit = null;
      this.treeFor = null;
      this.userMoved = this.userMoved && model.nodes.length > 0;
    }
    this.settings = settings;
    this.invalidate();
  }

  /** The layout moved the nodes. Until the person moves the view, it follows the picture. */
  frame(): void {
    if (!this.userMoved) this.cam = this.fitted();
    this.invalidate();
  }

  invalidate(): void {
    if (this.pending || this.dead) return;
    this.pending = requestAnimationFrame(() => {
      this.pending = 0;
      this.paint();
    });
  }

  /** Frames the whole graph. */
  fit(): void {
    this.userMoved = false;
    this.flyTo(this.fitted());
  }

  zoomBy(factor: number): void {
    this.userMoved = true;
    this.flyTo(zoomAt(this.cam, factor, this.width / 2, this.height / 2));
  }

  /** Brings a node to the middle, closer than before when the view is far out. */
  focusNode(index: number): void {
    const at = this.places();
    if (!at || index < 0 || 2 * index + 1 >= at.length) return;
    this.userMoved = true;
    this.flyTo(centreOn(this.cam, at[2 * index]!, at[2 * index + 1]!, this.width, this.height, Math.max(this.cam.k, 1.2)));
  }

  /** The place on the canvas (not the page) of node `index`, or null. */
  screenOf(index: number): { x: number; y: number } | null {
    const at = this.places();
    if (!at || index < 0 || 2 * index + 1 >= at.length) return null;
    const [x, y] = toScreen(this.cam, at[2 * index]!, at[2 * index + 1]!);
    return { x, y };
  }

  /** The node at a point of the canvas, or -1. */
  nodeAt(sx: number, sy: number): number {
    const at = this.places();
    const count = this.model.nodes.length;
    if (!at || count === 0 || at.length < 2 * count) return -1;
    if (this.treeFor !== at) {
      const [xs, ys] = [new Float64Array(count), new Float64Array(count)];
      for (let i = 0; i < count; i++) [xs[i], ys[i]] = [at[2 * i]!, at[2 * i + 1]!];
      this.tree = new QuadTree(count);
      this.tree.build(xs, ys, count);
      this.treeFor = at;
    }
    const [wx, wy] = toWorld(this.cam, sx, sy);
    const found = this.tree.nearest(wx, wy, 26 / this.cam.k);
    if (found < 0) return -1;
    const [fx, fy] = toScreen(this.cam, at[2 * found]!, at[2 * found + 1]!);
    return Math.hypot(fx - sx, fy - sy) <= screenRadius(this.model.nodes[found]!.links, this.cam.k) + 3 ? found : -1;
  }

  /** The place in the graph under a point of the canvas. */
  worldAt(sx: number, sy: number): [number, number] {
    return toWorld(this.cam, sx, sy);
  }

  // Drawing ---------------------------------------------------------------

  private restyle(): void {
    this.palette = readPalette();
    const style = getComputedStyle(document.documentElement);
    this.font = { size: (parseFloat(style.fontSize) || 16) * 0.75, family: style.fontFamily || "sans-serif" };
    this.invalidate();
  }

  private resize(): void {
    const box = this.canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    if (box.width === this.width && box.height === this.height && ratio === this.ratio) return;
    const first = this.width === 0;
    [this.width, this.height, this.ratio] = [box.width, box.height, ratio];
    this.canvas.width = Math.max(1, Math.round(box.width * ratio));
    this.canvas.height = Math.max(1, Math.round(box.height * ratio));
    if (first || !this.userMoved) this.cam = this.fitted();
    this.invalidate();
  }

  private fitted(): Camera {
    const at = this.places();
    const box = at ? boundsOf(at, Math.min(this.model.nodes.length, at.length / 2)) : null;
    return fitBounds(box, this.width, this.height, 56, FIT_ZOOM);
  }

  private paint(): void {
    if (!this.ctx || this.dead) return;
    drawGraph(this.ctx, {
      width: this.width,
      height: this.height,
      ratio: this.ratio,
      cam: this.cam,
      model: this.model,
      places: this.usable(),
      palette: this.palette,
      font: this.font,
      colourBy: this.settings.colourBy,
      hover: this.hover,
      lit: this.lit,
      selected: this.settings.selected,
      link: this.link,
      nameAll: this.settings.nameAll,
    });
  }

  /** The places, when they are for the model being drawn. */
  private usable(): Float32Array | null {
    const at = this.places();
    return at && at.length === 2 * this.model.nodes.length ? at : null;
  }

  private flyTo(target: Camera): void {
    cancelAnimationFrame(this.flight);
    if (motionOff()) {
      this.cam = target;
      this.invalidate();
      return;
    }
    const from = this.cam;
    const began = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - began) / 240);
      this.cam = between(from, target, 1 - Math.pow(1 - t, 3));
      this.paint();
      if (t < 1 && !this.dead) this.flight = requestAnimationFrame(step);
    };
    this.flight = requestAnimationFrame(step);
  }

  // Pointer ---------------------------------------------------------------

  private point(e: MouseEvent): [number, number] {
    const box = this.canvas.getBoundingClientRect();
    return [e.clientX - box.left, e.clientY - box.top];
  }

  private setHover(index: number): void {
    if (index === this.hover) return;
    this.hover = index;
    this.lit = index >= 0 ? neighbourhood(this.model, index) : null;
    this.canvas.style.cursor = index >= 0 ? "pointer" : "";
    this.invalidate();
  }

  private readonly onHover = (e: MouseEvent): void => {
    if (this.drag) return;
    this.setHover(this.nodeAt(...this.point(e)));
  };

  private readonly onLeave = (): void => {
    if (!this.drag) this.setHover(-1);
  };

  private readonly onDown = (e: MouseEvent): void => {
    if (e.button !== 0) return;
    this.canvas.focus({ preventScroll: true });
    const [x, y] = this.point(e);
    const index = this.nodeAt(x, y);
    this.drag = index >= 0 ? { mode: "node", index, x, y, moved: false, keys: keysOf(e) } : { mode: "pan", x, y, cam: this.cam, moved: false };
    window.addEventListener("mousemove", this.onMove);
    window.addEventListener("mouseup", this.onUp);
  };

  private readonly onMove = (e: MouseEvent): void => {
    const drag = this.drag;
    if (!drag) return;
    const [x, y] = this.point(e);
    if (!drag.moved && Math.hypot(x - drag.x, y - drag.y) < DRAG_PX) return;
    drag.moved = true;
    if (drag.mode === "pan") {
      this.userMoved = true;
      this.cam = panBy(drag.cam, x - drag.x, y - drag.y);
      this.canvas.style.cursor = "grabbing";
    } else if (this.settings.editable) {
      const over = this.nodeAt(x, y);
      this.link = { from: drag.index, x, y, over: over === drag.index ? -1 : over };
      this.setHover(drag.index);
    }
    this.invalidate();
  };

  private readonly onUp = (e: MouseEvent): void => {
    window.removeEventListener("mousemove", this.onMove);
    window.removeEventListener("mouseup", this.onUp);
    const drag = this.drag;
    const link = this.link;
    this.drag = null;
    this.link = null;
    this.canvas.style.cursor = this.hover >= 0 ? "pointer" : "";
    if (!drag) return;
    const [x, y] = this.point(e);
    if (drag.mode === "node") {
      if (!drag.moved) return this.clicked(drag.index, drag.keys);
      // Dropped on empty space: a new page, linked from the node. Dropped on a node: nothing.
      if (link && link.over < 0 && this.settings.editable) this.handlers.linkTo(drag.index, ...this.worldAt(x, y));
    } else if (!drag.moved) {
      this.handlers.select(-1);
    }
    this.invalidate();
  };

  /** A press and release on a node: a click, unless a second one follows. */
  private clicked(index: number, keys: Keys): void {
    this.handlers.select(index);
    // Clicks with a key say where to open and need not wait.
    if (keys.ctrlKey || keys.metaKey || keys.shiftKey || keys.altKey) return this.handlers.open(index, keys);
    clearTimeout(this.click);
    this.click = window.setTimeout(() => this.handlers.open(index, keys), DOUBLE_CLICK_MS);
  }

  private readonly onDouble = (e: MouseEvent): void => {
    const [x, y] = this.point(e);
    const index = this.nodeAt(x, y);
    clearTimeout(this.click);
    if (index >= 0) return this.handlers.openHere(index);
    if (this.settings.editable) this.handlers.createAt(...this.worldAt(x, y));
  };

  private readonly onContext = (e: MouseEvent): void => {
    e.preventDefault();
    const [x, y] = this.point(e);
    const index = this.nodeAt(x, y);
    if (index >= 0) this.handlers.select(index);
    this.handlers.context(index, { x: e.clientX, y: e.clientY });
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.userMoved = true;
    cancelAnimationFrame(this.flight);
    const [x, y] = this.point(e);
    // A pinch on a trackpad arrives as a wheel with the control key.
    const rate = e.ctrlKey ? 0.01 : 0.0016;
    const lines = e.deltaMode === 1 ? 16 : 1;
    this.cam = zoomAt(this.cam, Math.exp(-e.deltaY * lines * rate), x, y);
    this.invalidate();
  };

  // Keys ------------------------------------------------------------------

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey) return;
    const keys: Keys = { ctrlKey: false, metaKey: false, shiftKey: e.shiftKey, altKey: e.altKey, button: 0 };
    const selected = this.settings.selected;
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const arrow = arrows[e.key];
    if (arrow) {
      e.preventDefault();
      const at = this.usable();
      const next = at && selected >= 0 && !e.altKey ? neighbourToward(this.model, at, selected, arrow[0], arrow[1]) : -1;
      if (next >= 0) {
        this.handlers.select(next);
        this.focusNode(next);
      } else {
        this.userMoved = true;
        this.cam = panBy(this.cam, -arrow[0] * 80, -arrow[1] * 80);
        this.invalidate();
      }
    } else if (e.key === "Enter" && selected >= 0) {
      e.preventDefault();
      this.handlers.open(selected, keys);
    } else if (e.key === "Escape" && selected >= 0) {
      e.preventDefault();
      e.stopPropagation();
      this.handlers.select(-1);
    } else if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      this.zoomBy(1.4);
    } else if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      this.zoomBy(1 / 1.4);
    } else if (e.key === "0") {
      e.preventDefault();
      this.fit();
    } else if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
      e.preventDefault();
      const at = this.screenOf(selected);
      const box = this.canvas.getBoundingClientRect();
      this.handlers.context(selected, at ? { x: box.left + at.x, y: box.top + at.y } : { x: box.left + this.width / 2, y: box.top + this.height / 2 });
    }
  };

  /** For tests and the toolbar: the zoom now. */
  get zoom(): number {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.cam.k));
  }
}
