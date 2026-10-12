// What each browser tab is doing, and the one place that listens to them all:
// pages went somewhere (the tab's place keeps the address), got a title, asked
// for a new tab or a download. A tab that is closed closes its native view.

import { create } from "zustand";

import { openUrl } from "../../lib/api";
import { useWorkspace } from "../workspace/store";
import { browserBackend } from "./backend";
import { useWebTitles } from "./titles";
import type { BrowserEvent } from "./types";

export interface WebTab {
  loading: boolean;
  /** The tab's native view exists. */
  live: boolean;
}

interface WebTabs {
  tabs: Readonly<Record<string, WebTab>>;
  patch(id: string, change: Partial<WebTab>): void;
  forget(id: string): void;
}

const IDLE: WebTab = { loading: false, live: false };

export const useWebTabs = create<WebTabs>()((set) => ({
  tabs: {},
  patch: (id, change) =>
    set((s) => {
      const now = s.tabs[id] ?? IDLE;
      const next = { ...now, ...change };
      return next.loading === now.loading && next.live === now.live && id in s.tabs ? s : { tabs: { ...s.tabs, [id]: next } };
    }),
  forget: (id) =>
    set((s) => {
      if (!(id in s.tabs)) return s;
      const { [id]: _gone, ...rest } = s.tabs;
      return { tabs: rest };
    }),
}));

/** The address browser tab `id` is at, if it is one. */
export function urlOf(id: string): string | undefined {
  for (const pane of useWorkspace.getState().layout.panes) {
    const tab = pane.tabs.find((t) => t.id === id);
    if (tab) return tab.place.view === "web" ? tab.place.url : undefined;
  }
  return undefined;
}

/** The ids of every browser tab in the layout. */
export function webTabIds(): Set<string> {
  const ids = new Set<string>();
  for (const pane of useWorkspace.getState().layout.panes) for (const tab of pane.tabs) if (tab.place.view === "web") ids.add(tab.id);
  return ids;
}

/** How a page's events change the window. */
export function handleEvent(event: BrowserEvent): void {
  const ws = useWorkspace.getState();
  const tabs = useWebTabs.getState();
  switch (event.kind) {
    case "url":
      if (event.url) ws.setWebUrl(event.id, event.url);
      break;
    case "title": {
      if (event.url) ws.setWebUrl(event.id, event.url);
      const at = event.url ?? urlOf(event.id);
      if (at && event.title) useWebTitles.getState().keep(at, event.title);
      break;
    }
    case "loading":
      tabs.patch(event.id, { loading: Boolean(event.loading) });
      if (event.url) ws.setWebUrl(event.id, event.url);
      break;
    case "new-tab":
      if (event.url) void import("./open").then((m) => m.openInBrowserTab(event.url!));
      break;
    case "download": {
      const url = event.url;
      ws.toast("KastenFlow's browser does not download files.", url ? { label: "Open in your browser", run: () => void openUrl(url).catch(() => {}) } : undefined);
      break;
    }
    case "closed":
      tabs.patch(event.id, { live: false, loading: false });
      break;
  }
}

let started = false;

/** Starts listening to every browser tab, once, and closes the view of a tab that is closed. */
export function startBrowserEvents(): void {
  if (started || !browserBackend().available) return;
  started = true;
  void browserBackend().onEvent(handleEvent).catch(() => {});
  let before = webTabIds();
  useWorkspace.subscribe((state, previous) => {
    if (state.layout === previous.layout) return;
    const now = webTabIds();
    for (const id of before) {
      if (now.has(id)) continue;
      useWebTabs.getState().forget(id);
      void browserBackend().close(id).catch(() => {});
    }
    before = now;
  });
}
