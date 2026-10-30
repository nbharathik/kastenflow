// The PDF preview, drawn in a scrolling column of pages. A new PDF never
// replaces the one on screen until it is ready: the new pages are laid out and
// the ones in view are painted off-screen, and then the column is swapped in
// one step with the reader put back at the same place (page and how far down
// it, so a change in page count or size still finds the spot). Zoom is kept
// across builds. If the new PDF cannot be opened or drawn, the old one stays and
// the owner is told why. The PDF library is passed in (`PreviewDeps`), so the
// controller is tested with a fake one and the real one loads on first use.

import { sentence } from "../backend";
import type { SyncHit } from "../types";
import { type Anchor, anchorAt, type PageBox, pageBoxes, pagesInView, scrollFor } from "./anchor";

export interface PageLike {
  getViewport(options: { scale: number }): { width: number; height: number };
}

export interface DocLike {
  numPages: number;
  getPage(n: number): Promise<PageLike>;
  destroy(): unknown;
}

export interface PreviewDeps {
  open(bytes: Uint8Array): Promise<DocLike>;
  /** Draws `page` at `scale` (CSS pixels per point) into `canvas`. */
  paint(page: PageLike, scale: number, canvas: HTMLCanvasElement): Promise<void>;
}

export interface PreviewEvents {
  /** The PDF could not be shown (null: it can). The pages already on screen stay. */
  problem(message: string | null): void;
  /** The scale pages are drawn at changed (1 is a point per CSS pixel). */
  scaled(scale: number): void;
}

export type Zoom = "fit" | number;

export const GAP = 12;
export const PAD = 12;
export const MIN_SCALE = 0.25;
export const MAX_SCALE = 4;
const STEP = 1.25;
/** How long the mark on a place found by "Sync to PDF" stays. */
const FLASH_MS = 1600;

const clampScale = (scale: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

export class PreviewController {
  private doc: DocLike | null = null;
  private pages: PageLike[] = [];
  private boxes: PageBox[] = [];
  private scale = 1;
  private zoom: Zoom = "fit";
  private token = 0;
  private column: HTMLElement | null = null;
  private painted = new Set<number>();
  private flash: { el: HTMLElement; timer: ReturnType<typeof setTimeout> } | null = null;
  private frame: number | null = null;
  private loading = 0;
  private relayoutWaits = false;
  private readonly onScroll = () => {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      void this.paintVisible();
    });
  };

  constructor(
    private readonly scroller: HTMLElement,
    private readonly deps: PreviewDeps,
    private readonly events: PreviewEvents,
  ) {
    scroller.addEventListener("scroll", this.onScroll, { passive: true });
  }

  /** There is a PDF on screen. */
  get shown(): boolean {
    return this.doc !== null;
  }

  get currentScale(): number {
    return this.scale;
  }

  get currentZoom(): Zoom {
    return this.zoom;
  }

  /** The reader's place now. */
  anchor(): Anchor {
    return anchorAt(this.scroller.scrollTop, this.boxes);
  }

  /** Shows a newly built PDF. Answers whether it was swapped in; false leaves the old one (and tells the owner why unless a newer PDF took over). */
  async load(bytes: Uint8Array): Promise<boolean> {
    this.loading++;
    try {
      return await this.loadNow(bytes);
    } finally {
      this.loading--;
      // A resize that came while the new PDF was being drawn is laid out now.
      if (this.loading === 0 && this.relayoutWaits) {
        this.relayoutWaits = false;
        void this.relayout();
      }
    }
  }

  private async loadNow(bytes: Uint8Array): Promise<boolean> {
    const mine = ++this.token;
    let doc: DocLike;
    try {
      doc = await this.deps.open(bytes);
    } catch (err) {
      if (mine === this.token) this.events.problem(`The new PDF could not be opened: ${sentence(err)}`);
      return false;
    }
    if (mine !== this.token) {
      void doc.destroy();
      return false;
    }
    try {
      const pages = await Promise.all(Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1)));
      if (mine !== this.token) throw new Superseded();
      await this.swap(doc, pages, mine);
      this.events.problem(null);
      return true;
    } catch (err) {
      void doc.destroy();
      if (!(err instanceof Superseded) && mine === this.token) this.events.problem(`The new PDF could not be drawn: ${sentence(err)}`);
      return false;
    }
  }

  /** Changes the zoom, keeping the reader's place. */
  async setZoom(zoom: Zoom): Promise<void> {
    this.zoom = zoom;
    await this.relayout();
  }

  async zoomBy(direction: 1 | -1): Promise<void> {
    await this.setZoom(clampScale(direction === 1 ? this.scale * STEP : this.scale / STEP));
  }

  /** Lays the pages out again (the zoom is "fit" and the pane's width changed). */
  async relayout(): Promise<void> {
    if (!this.doc) {
      this.events.scaled(this.scale);
      return;
    }
    // A new PDF being drawn must not be thrown away by a resize: it waits.
    if (this.loading > 0) {
      this.relayoutWaits = true;
      return;
    }
    const mine = ++this.token;
    try {
      await this.swap(this.doc, this.pages, mine);
    } catch (err) {
      if (!(err instanceof Superseded)) this.events.problem(`The preview could not be drawn: ${sentence(err)}`);
    }
  }

  /** Paints the pages near the reader that are not painted yet. */
  async paintVisible(): Promise<void> {
    const token = this.token;
    const view = pagesInView(this.scroller.scrollTop, this.scroller.clientHeight || 800, this.boxes, 1);
    await Promise.all(view.filter((at) => !this.painted.has(at)).map((at) => this.paintInto(at, token)));
  }

  /** Scrolls to a place SyncTeX found and marks it for a moment. */
  async showHit(hit: SyncHit): Promise<void> {
    const at = hit.page - 1;
    const box = this.boxes[at];
    const wrapper = this.column?.children[at] as HTMLElement | undefined;
    if (!box || !wrapper) return;
    const top = box.top + (hit.y - hit.height) * this.scale;
    this.scroller.scrollTop = Math.max(0, Math.round(top - this.scroller.clientHeight / 3));
    await this.paintVisible();
    if (this.flash) {
      clearTimeout(this.flash.timer);
      this.flash.el.remove();
    }
    const el = document.createElement("div");
    el.className = "latex-sync-flash";
    el.setAttribute("aria-hidden", "true");
    const style = el.style;
    style.left = `${Math.max(0, hit.x * this.scale)}px`;
    style.top = `${Math.max(0, (hit.y - hit.height) * this.scale)}px`;
    style.width = `${Math.max(8, hit.width * this.scale)}px`;
    style.height = `${Math.max(8, (hit.height + hit.depth) * this.scale)}px`;
    wrapper.append(el);
    this.flash = { el, timer: setTimeout(() => el.remove(), FLASH_MS) };
  }

  /** The page and point (in points from the page's top left) under a pointer, for a click in the preview. */
  pointAt(clientX: number, clientY: number): { page: number; x: number; y: number } | null {
    const rect = this.scroller.getBoundingClientRect();
    const at = anchorAt(clientY - rect.top + this.scroller.scrollTop, this.boxes).page;
    const wrapper = this.column?.children[at] as HTMLElement | undefined;
    const box = this.boxes[at];
    if (!wrapper || !box) return null;
    const page = wrapper.getBoundingClientRect();
    const y = (clientY - page.top) / this.scale;
    const x = (clientX - page.left) / this.scale;
    return x < 0 || y < 0 || y > box.height / this.scale ? null : { page: at + 1, x, y };
  }

  dispose(): void {
    this.token++;
    this.scroller.removeEventListener("scroll", this.onScroll);
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    if (this.flash) clearTimeout(this.flash.timer);
    void this.doc?.destroy();
    this.doc = null;
    this.column = null;
  }

  private scaleFor(sizes: readonly { width: number }[]): number {
    if (this.zoom !== "fit") return clampScale(this.zoom);
    const widest = Math.max(1, ...sizes.map((s) => s.width));
    const room = this.scroller.clientWidth - 2 * PAD;
    return room > 0 ? clampScale(room / widest) : 1;
  }

  /** Lays `pages` out, paints the ones in view off-screen, then swaps them in with the reader's place kept. */
  private async swap(doc: DocLike, pages: PageLike[], mine: number): Promise<void> {
    const sizes = pages.map((page) => page.getViewport({ scale: 1 }));
    const scale = this.scaleFor(sizes);
    const boxes = pageBoxes(sizes, scale, GAP, PAD);
    const place = (): number => {
      // At the very top (or nothing shown yet) stay at the top, not at the first page's edge.
      const now = this.scroller.scrollTop;
      return this.doc && now > 0 ? scrollFor(anchorAt(now, this.boxes), boxes) : 0;
    };
    const target = place();
    const column = document.createElement("div");
    column.className = "latex-pages";
    column.style.cssText = `display:flex;flex-direction:column;align-items:center;gap:${GAP}px;padding:${PAD}px 0;`;
    const wrappers = sizes.map((size) => {
      const page = document.createElement("div");
      page.className = "latex-page";
      page.style.cssText = `position:relative;flex:none;width:${size.width * scale}px;height:${size.height * scale}px;`;
      column.append(page);
      return page;
    });
    const visible = pagesInView(target, this.scroller.clientHeight || 800, boxes, 1);
    await Promise.all(
      visible.map(async (at) => {
        const canvas = await this.draw(pages[at]!, scale);
        wrappers[at]!.append(canvas);
      }),
    );
    if (mine !== this.token) throw new Superseded();
    const old = this.doc;
    // The reader may have moved while the pages were painted: put them back where they are now.
    const landing = place();
    this.scroller.replaceChildren(column);
    this.scroller.scrollTop = landing;
    this.doc = doc;
    this.pages = pages;
    this.boxes = boxes;
    this.scale = scale;
    this.column = column;
    this.painted = new Set(visible);
    if (old && old !== doc) void old.destroy();
    this.events.scaled(scale);
    void this.paintVisible();
  }

  private async draw(page: PageLike, scale: number): Promise<HTMLCanvasElement> {
    const canvas = document.createElement("canvas");
    await this.deps.paint(page, scale, canvas);
    return canvas;
  }

  private async paintInto(at: number, token: number): Promise<void> {
    const page = this.pages[at];
    const wrapper = this.column?.children[at];
    if (!page || !wrapper) return;
    this.painted.add(at);
    try {
      const canvas = await this.draw(page, this.scale);
      if (token === this.token && wrapper.isConnected) wrapper.prepend(canvas);
      else this.painted.delete(at);
    } catch {
      this.painted.delete(at);
    }
  }
}

/** Thrown inside a load that a newer one replaced. */
class Superseded extends Error {}
