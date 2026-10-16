// One web preview, from the app's side: the native view that shows the page, kept
// over the box the Slides editor draws (its rectangle comes in CSS pixels and goes
// to the app in physical ones), hidden whenever anything of KastenFlow's own opens
// over it (a menu, the palette, a dialog), and told the page's state and the keys
// it had the keyboard for. The editor owns the toolbar and the order of Escape; this
// owns nothing but the view. One at a time: asking again takes the same view to
// another address.

import type { PreviewPlace, WebPreviewEvent, WebPreviewHandle, WebPreviewState } from "@kasten-slides/react";

import { openUrl } from "../../lib/api";
import { isEmpty, sameBounds, toPhysical, type Box } from "../browser/bounds";
import { covered, useOcclusion } from "../browser/occlusion";
import { previewBackend } from "../browser/preview-backend";
import { onPreviewSignal, type PreviewSignal } from "../browser/preview-events";
import { useBrowserPrefs } from "../browser/prefs";
import type { Bounds, Nav } from "../browser/types";
import { useWorkspace } from "../workspace/store";

/** The key the view's area is kept under for the things that keep clear of it (toasts). */
const AREA = "web-preview";

const boxOf = ({ rect }: PreviewPlace): Box => ({ left: rect.x, top: rect.y, right: rect.x + rect.w, bottom: rect.y + rect.h });

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** The app's words for an address it will not open at all. */
const refused = (why: string): boolean => why.startsWith("The browser opens web pages only") || why.includes("is not a web address");

/** The app's words for a view that is no longer there (closed, or it never started). */
const VIEW_GONE = /is not open|went away|could not start/i;

export class PreviewSession implements WebPreviewHandle {
  private where: PreviewPlace;
  private state: WebPreviewState;
  private readonly listeners = new Set<(event: WebPreviewEvent) => void>();
  private readonly stops: (() => void)[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  /** The native view exists. */
  private live = false;
  private nativeShown = false;
  private sent: Bounds | null = null;
  /** The editor took the view off the screen (`hide`). */
  private away = false;
  private closed = false;

  constructor(
    url: string,
    where: PreviewPlace,
    private readonly gone: (session: PreviewSession) => void,
  ) {
    this.where = where;
    this.state = { url, title: null, status: "loading" };
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** Starts listening, and opens the view. Resolves once the app has answered. */
  start(): Promise<void> {
    this.stops.push(
      onPreviewSignal((signal) => this.hear(signal)),
      // Anything of KastenFlow's that opens or closes over the view.
      useOcclusion.subscribe((now, before) => {
        if (now.holds !== before.holds) this.settle();
      }),
      // Switched off in Settings: the app has closed the view already.
      useBrowserPrefs.subscribe((now, before) => {
        if (before.enabled && !now.enabled) this.switchedOff();
      }),
    );
    return this.run(() => this.launch());
  }

  /** Takes the same view to another address, and to where the editor now has its box. */
  navigate(url: string, where: PreviewPlace): Promise<void> {
    this.where = where;
    this.away = false;
    this.change({ url, title: null, status: "loading", message: undefined });
    return this.run(() => this.launch());
  }

  // --- WebPreviewHandle

  place(where: PreviewPlace): void {
    this.where = where;
    this.settle();
  }

  back(): void {
    void this.run(() => this.go({ action: "back" }));
  }

  forward(): void {
    void this.run(() => this.go({ action: "forward" }));
  }

  reload(): void {
    this.change({ status: "loading", message: undefined });
    void this.run(() => (this.live ? this.go({ action: "reload" }) : this.launch()));
  }

  openExternal(): void {
    openUrl(this.state.url).catch((err: unknown) => useWorkspace.getState().toast(message(err)));
  }

  hide(): void {
    this.away = true;
    this.settle();
  }

  show(): void {
    this.away = false;
    this.settle();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.stops.splice(0).forEach((stop) => stop());
    this.listeners.clear();
    useOcclusion.getState().show(AREA, null);
    this.gone(this);
    // After whatever is being asked of the view now.
    this.queue = this.queue.then(() => previewBackend().close()).catch(() => {});
  }

  subscribe(listener: (event: WebPreviewEvent) => void): () => void {
    this.listeners.add(listener);
    // What is known now, for a listener that came after it happened.
    listener({ type: "state", state: { ...this.state } });
    return () => this.listeners.delete(listener);
  }

  // --- the view

  /** One thing at a time is asked of the app, so a quick hide and show never cross. */
  private run(job: () => Promise<void>): Promise<void> {
    const done = this.queue.then(() => (this.closed ? undefined : job())).catch((err: unknown) => this.fail(message(err)));
    this.queue = done;
    return done;
  }

  private settle(): void {
    void this.run(() => this.apply());
  }

  private go(nav: Nav): Promise<void> {
    return previewBackend().nav(nav);
  }

  private bounds(): Bounds {
    return toPhysical(boxOf(this.where), window.devicePixelRatio);
  }

  /** Makes the view (or takes it to the address) where the box is now. */
  private async launch(): Promise<void> {
    if (!/^https?:\/\//i.test(this.state.url)) {
      this.change({ status: "blocked", message: "Only web pages can be previewed here: an address that starts with http or https." });
      await this.apply();
      return;
    }
    const bounds = this.bounds();
    const shown = await previewBackend().open(this.state.url, bounds);
    this.live = true;
    this.nativeShown = true;
    this.sent = bounds;
    this.change({ url: shown, status: "loading", message: undefined });
    await this.apply();
  }

  /** Puts the view where the box is, shown or hidden as things stand. */
  private async apply(): Promise<void> {
    const box = boxOf(this.where);
    const area = !isEmpty(box);
    const failed = this.state.status === "failed" || this.state.status === "blocked";
    const wanted = area && !this.away && !failed && !covered(useOcclusion.getState().holds, box);
    // Told to what keeps clear of the view's area, such as a toast.
    useOcclusion.getState().show(AREA, wanted ? box : null);
    const backend = previewBackend();
    if (!this.live) {
      // The app closed an idle view: it opens again when it is wanted.
      if (wanted) await this.launch();
      return;
    }
    const bounds = this.bounds();
    if (area && !sameBounds(this.sent, bounds)) {
      await backend.bounds(bounds);
      this.sent = bounds;
    }
    if (wanted && !this.nativeShown) {
      await backend.show();
      this.nativeShown = true;
    } else if (!wanted && this.nativeShown) {
      await backend.hide();
      this.nativeShown = false;
    }
  }

  // --- what happens

  private hear(signal: PreviewSignal): void {
    if (signal.type === "key") {
      this.emit({ type: "key", key: signal.key });
      return;
    }
    const { event } = signal;
    switch (event.kind) {
      case "loading":
        this.change({ status: event.loading ? "loading" : "ready", ...(event.url ? { url: event.url } : {}) });
        break;
      case "title":
        this.change({ title: event.title ?? null, ...(event.url ? { url: event.url } : {}) });
        break;
      case "url":
        if (event.url) this.change({ url: event.url });
        break;
      case "new-tab": {
        // A link that wants a window of its own: the preview has only the one.
        const url = event.url;
        if (url) {
          this.change({ url, title: null, status: "loading" });
          void this.run(() => this.go({ action: "url", url }));
        }
        break;
      }
      case "closed":
        // The app closed an idle view; it comes back when it is shown.
        this.live = false;
        this.nativeShown = false;
        this.sent = null;
        this.settle();
        break;
    }
  }

  private switchedOff(): void {
    this.live = false;
    this.nativeShown = false;
    this.fail("Web previews were switched off in Settings.");
  }

  /** Something asked of the app failed: the page says why and its view is taken off the screen. */
  private fail(why: string): void {
    if (VIEW_GONE.test(why)) {
      // The app has no view for it any more: Try again makes one anew.
      this.live = false;
      this.nativeShown = false;
      this.sent = null;
    }
    // A failure that repeats (the same words) is not told, nor tried again, so it can never loop.
    if (this.change({ status: refused(why) ? "blocked" : "failed", message: why }) && !this.closed) void this.run(() => this.apply());
  }

  /** Changes what is known of the page, and tells the listeners if that is new. */
  private change(patch: Partial<WebPreviewState>): boolean {
    const next = { ...this.state, ...patch };
    if (next.message === undefined) delete next.message;
    const same = next.url === this.state.url && next.title === this.state.title && next.status === this.state.status && next.message === this.state.message;
    this.state = next;
    if (!same) this.emit({ type: "state", state: { ...next } });
    return !same;
  }

  private emit(event: WebPreviewEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }
}
