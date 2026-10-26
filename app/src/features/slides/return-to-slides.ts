// Coming back to Slides: the sidebar's Slides, "Go to Slides" and the Continue row on the Slides home go to the deck that is already open
// in a tab, instead of putting the Slides home in the tab of the deck you were in (the deck's view and its assistant would be lost).

import { type OpenHow, useWorkspace } from "../workspace/store";
import { type Layout, activeTab, focusedPane } from "../workspace/tabs";
import { useDecks } from "./store";

export interface DeckTab {
  paneId: string;
  tabId: string;
  path: string;
}

const isDeck = (place: { view: string; path?: string | undefined }): place is { view: string; path: string } => place.view === "slides" && Boolean(place.path);

/** The deck tabs that are open, the focused pane's first and each pane's shown tab ahead of its others. */
export function deckTabs(layout: Layout): DeckTab[] {
  const focused = focusedPane(layout);
  const panes = [focused, ...layout.panes.filter((p) => p !== focused)];
  const found: DeckTab[] = [];
  for (const pane of panes) {
    const shown = activeTab(pane);
    for (const tab of [shown, ...pane.tabs.filter((t) => t !== shown)]) {
      if (isDeck(tab.place)) found.push({ paneId: pane.id, tabId: tab.id, path: tab.place.path });
    }
  }
  return found;
}

/** The open tab of this deck, if there is one. */
export const tabOfDeck = (layout: Layout, path: string): DeckTab | undefined => deckTabs(layout).find((t) => t.path === path);

/** Brings the deck's open tab forward. Answers whether there was one. */
export function focusDeck(path: string): boolean {
  const ws = useWorkspace.getState();
  const tab = tabOfDeck(ws.layout, path);
  if (!tab) return false;
  ws.selectTab(tab.paneId, tab.tabId);
  return true;
}

/**
 * Goes to Slides. With a deck open in a tab, that tab comes forward; from inside a deck, the Slides home opens in a tab of its own (the deck's
 * tab is never turned into the home); otherwise it opens as asked. A click with Ctrl, Shift or Alt asks for a place, and gets it.
 */
export function goToSlides(how: OpenHow = "here"): void {
  const ws = useWorkspace.getState();
  if (how !== "here") return ws.go({ view: "slides" }, how);
  if (isDeck(ws.place)) return ws.go({ view: "slides" }, "tab");
  if (ws.place.view === "slides") return;
  const open = deckTabs(ws.layout)[0];
  if (open) return ws.selectTab(open.paneId, open.tabId);
  ws.go({ view: "slides" });
}

/** The deck the Slides home offers to continue: the one open in a tab, else the one opened last that is still in the vault. */
export function deckToContinue(): { path: string; open: boolean } | null {
  const { layout, recent } = useWorkspace.getState();
  const open = deckTabs(layout)[0];
  if (open) return { path: open.path, open: true };
  const list = useDecks.getState().list;
  const last = recent.find((path) => path.endsWith(".deck") && list.some((d) => d.path === path && !d.problem));
  return last ? { path: last, open: false } : null;
}

/** Goes on with a deck: its open tab comes forward, or it opens where the click asked. */
export function continueDeck(path: string, how: OpenHow = "here"): void {
  if (how === "here" && focusDeck(path)) return;
  useWorkspace.getState().openPath(path, how);
}
