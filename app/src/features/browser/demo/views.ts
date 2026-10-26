// The demo's "web views": in the desktop app a page is shown by a native view
// laid over the tab; here it is a frame laid over the same place, showing the
// canned page for whatever address is asked. Each view keeps its own history
// and tells the window what a real one would: loading, title, address.

import type { DemoClock } from "../../../demo/clock";
import type { Bounds, BrowserEvent, Nav } from "../types";
import { pageFor, titleOf } from "./page";

/** How long a page "loads". */
export const LOAD_MS = 250;
/** Above the page and its panes, below menus and dialogs. */
const LAYER = "30";

interface View {
  frame: HTMLIFrameElement | null;
  history: string[];
  at: number;
  shown: boolean;
}

export class DemoViews {
  private views = new Map<string, View>();
  private listeners = new Set<(event: BrowserEvent) => void>();
  private pending = new Map<string, () => void>();

  constructor(
    private readonly clock: DemoClock,
    private readonly host: () => HTMLElement = () => document.body,
  ) {}

  onEvent(listener: (event: BrowserEvent) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  private tell(event: BrowserEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }

  /** How many frames are on screen. */
  get count(): number {
    return this.views.size;
  }

  private place(view: View, bounds: Bounds): void {
    const frame = view.frame;
    if (!frame) return;
    const ratio = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    const style = frame.style;
    style.left = `${bounds.x / ratio}px`;
    style.top = `${bounds.y / ratio}px`;
    style.width = `${bounds.width / ratio}px`;
    style.height = `${bounds.height / ratio}px`;
  }

  private load(id: string, view: View, url: string): void {
    this.pending.get(id)?.();
    view.frame?.setAttribute("srcdoc", pageFor(url));
    this.tell({ id, kind: "loading", loading: true, url });
    this.pending.set(
      id,
      this.clock.after(LOAD_MS, () => {
        this.pending.delete(id);
        this.tell({ id, kind: "title", title: titleOf(url), url });
        this.tell({ id, kind: "loading", loading: false, url });
      }),
    );
  }

  /** Opens the view (or takes the open one to the address) where `bounds` says; answers the address shown. */
  async open(id: string, url: string, bounds: Bounds): Promise<string> {
    let view = this.views.get(id);
    if (!view) {
      const frame = document.createElement("iframe");
      frame.setAttribute("sandbox", "");
      frame.setAttribute("title", "Web page");
      frame.setAttribute("referrerpolicy", "no-referrer");
      frame.dataset.demoView = id;
      frame.style.cssText = `position:fixed;border:0;background:#fff;z-index:${LAYER};`;
      this.host().append(frame);
      view = { frame, history: [], at: -1, shown: true };
      this.views.set(id, view);
    }
    this.place(view, bounds);
    view.frame!.style.display = "";
    view.shown = true;
    // Shown again at the address it already has: no new page.
    if (view.history[view.at] === url) return url;
    view.history = [...view.history.slice(0, view.at + 1), url];
    view.at = view.history.length - 1;
    this.load(id, view, url);
    return url;
  }

  async bounds(id: string, bounds: Bounds): Promise<void> {
    const view = this.views.get(id);
    if (view) this.place(view, bounds);
  }

  async hide(id: string): Promise<void> {
    const view = this.views.get(id);
    if (view?.frame) view.frame.style.display = "none";
    if (view) view.shown = false;
  }

  async show(id: string): Promise<void> {
    const view = this.views.get(id);
    if (view?.frame) view.frame.style.display = "";
    if (view) view.shown = true;
  }

  async close(id: string): Promise<void> {
    const view = this.views.get(id);
    if (!view) return;
    this.pending.get(id)?.();
    this.pending.delete(id);
    view.frame?.remove();
    this.views.delete(id);
    this.tell({ id, kind: "closed" });
  }

  async nav(id: string, nav: Nav): Promise<void> {
    const view = this.views.get(id);
    if (!view) return;
    if (nav.action === "url") {
      view.history = [...view.history.slice(0, view.at + 1), nav.url];
      view.at = view.history.length - 1;
    } else if (nav.action === "back") view.at = Math.max(0, view.at - 1);
    else if (nav.action === "forward") view.at = Math.min(view.history.length - 1, view.at + 1);
    const url = view.history[view.at];
    if (url) this.load(id, view, url);
  }

  /** Takes every frame away (a new recording). */
  clear(): void {
    for (const id of [...this.views.keys()]) void this.close(id);
  }
}
