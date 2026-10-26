// Opening an address in a Kasten browser tab, beside the page being read:
// in the browser tab already to the right if there is one, else in a new tab
// there (or a new pane when there is no pane to the right). Used for web links
// in pages when Settings says so, and for a link a page in the browser wants
// in a window of its own.

import { openUrl } from "../../lib/api";
import { useWorkspace } from "../workspace/store";
import { browserBackend } from "./backend";
import { useBrowserPrefs } from "./prefs";
import { useWebTabs } from "./web-state";

export function openInBrowserTab(url: string): void {
  const ws = useWorkspace.getState();
  const { panes, focus } = ws.layout;
  const right = panes[panes.findIndex((p) => p.id === focus) + 1];
  const place = { view: "web" as const, url };
  if (!right) return ws.splitRight(place);
  const there = right.tabs.find((t) => t.place.view === "web");
  if (!there) {
    ws.focusPane(right.id);
    return ws.openTab(place);
  }
  ws.selectTab(right.id, there.id);
  // A view that is alive goes there itself; the tab's place follows from its events.
  if (useWebTabs.getState().tabs[there.id]?.live) void browserBackend().nav(there.id, { action: "url", url }).catch(() => ws.setWebUrl(there.id, url));
  else ws.setWebUrl(there.id, url);
}

/** The "Open in a KastenFlow tab" choice of the link menus, wherever they are (a show included, where the tab waits behind it and a
 * toast says so afterwards). With the browser off there is no tab: the address goes to the system's browser, and the toast says that. */
export function openInKastenTab(url: string): void {
  const { toast } = useWorkspace.getState();
  if (!/^https?:\/\//i.test(url) || !useBrowserPrefs.getState().enabled) {
    openUrl(url).catch((err: unknown) => toast(err instanceof Error ? err.message : String(err)));
    if (/^https?:\/\//i.test(url)) toast("Web tabs are off, so the page opened in your browser.");
    return;
  }
  openInBrowserTab(url);
  toast("Opened in a KastenFlow tab.");
}
