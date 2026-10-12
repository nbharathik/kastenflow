// Opening an address in a Kasten browser tab, beside the page being read:
// in the browser tab already to the right if there is one, else in a new tab
// there (or a new pane when there is no pane to the right). Used for web links
// in pages when Settings says so, and for a link a page in the browser wants
// in a window of its own.

import { useWorkspace } from "../workspace/store";
import { browserBackend } from "./backend";
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
