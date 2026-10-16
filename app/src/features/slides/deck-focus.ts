// When a deck has the keyboard. The editor listens for keys where the focus is,
// so a deck that was just opened (or brought back after a dialog, a menu, another
// pane or another window) must be given it, and keys that fall on the bare page
// must go to the deck that is in use. The editor does both when the host tells it
// which deck that is: this is where KastenFlow says so.

import { useCallback, useState } from "react";

import { windowCovered } from "../browser/cover";
import { usePaneId } from "../workspace/pane-context";
import { useWorkspace } from "../workspace/store";
import { activeTab } from "../workspace/tabs";

export interface DeckFocus {
  /** The deck takes the keys as it is shown, when its pane is the one in use. */
  autoFocus: boolean;
  /** A new number each time its pane becomes the one in use, so it takes the keys again; false while it is not. */
  focusKey: number | false;
  /** Whether this deck is the one in use: asked when a key falls on the bare page. */
  routeOrphanKeys(): boolean;
}

/** Whether a dialog, the palette or another modal of KastenFlow's is open over the window. */
export const modalOpen = (): boolean => document.querySelector('[aria-modal="true"]') !== null;

/** The focus props for the deck at `path`, shown in the pane this view is in. */
export function useDeckFocus(path: string): DeckFocus {
  const paneId = usePaneId();
  const focused = useWorkspace((s) => s.layout.focus === paneId);
  // A count of the times the pane came into use, worked out as it renders.
  const [turns, setTurns] = useState({ focused, count: focused ? 1 : 0 });
  if (turns.focused !== focused) setTurns({ focused, count: focused ? turns.count + 1 : turns.count });

  const routeOrphanKeys = useCallback((): boolean => {
    const { layout } = useWorkspace.getState();
    if (layout.focus !== paneId) return false;
    const pane = layout.panes.find((p) => p.id === paneId);
    const tab = pane ? activeTab(pane) : undefined;
    if (!tab || tab.place.view !== "slides" || tab.place.path !== path) return false;
    // A dialog or the palette keeps its keys; so does a presentation.
    return !modalOpen() && !windowCovered();
  }, [paneId, path]);

  return { autoFocus: focused, focusKey: focused ? turns.count : false, routeOrphanKeys };
}
