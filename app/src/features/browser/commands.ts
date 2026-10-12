// The browser's commands for the palette and the keymap. The tab that is on
// show does the work (it holds the page and the capture), so a command only
// tells it; each applies while a browser tab is the one in focus.

import { useWorkspace } from "../workspace/store";
import { useBrowserPrefs } from "./prefs";

export type BrowserCommand = "capture-page" | "capture-selection" | "address";

export const BROWSER_EVENT = "kasten:browser";

/** Whether the browser is on, for commands that open it. */
export const browserOn = (): boolean => useBrowserPrefs.getState().enabled;

/** Whether the focused tab is a browser tab, for commands that act on it. */
export const onBrowserTab = (): boolean => useWorkspace.getState().place.view === "web";

/** Tells the focused browser tab to do something. */
export function runBrowserCommand(command: BrowserCommand): void {
  window.dispatchEvent(new CustomEvent<BrowserCommand>(BROWSER_EVENT, { detail: command }));
}
