// The browser's commands for the palette and the keymap. The tab that is on
// show does the work (it holds the page and the capture), so a command only
// tells it; each applies while a browser tab is the one in focus.

import { useWorkspace } from "../workspace/store";
import { currentTab } from "../workspace/tabs";
import { useBrowserPrefs } from "./prefs";

export type BrowserCommand = "capture-page" | "capture-selection" | "save-paper" | "address";

export const BROWSER_EVENT = "kasten:browser";

/** Whether the browser is on, for commands that open it. */
export const browserOn = (): boolean => useBrowserPrefs.getState().enabled;

/** Whether the focused tab is a browser tab, for commands that act on it. */
export const onBrowserTab = (): boolean => useWorkspace.getState().place.view === "web";

/** Tells the focused browser tab to do something. */
export function runBrowserCommand(command: BrowserCommand): void {
  window.dispatchEvent(new CustomEvent<BrowserCommand>(BROWSER_EVENT, { detail: command }));
}

/** How long a new tab may take to show before it is no longer the one that was asked for. */
const ASKED_MS = 2000;
let askedAt: number | null = null;

/** A new browser tab, on its start page, with the cursor in its address box. The
 * "+" beside the address box and Ctrl+T on a browser tab do this. */
export function openWebTab(): void {
  const before = currentTab(useWorkspace.getState().layout).id;
  askedAt = Date.now();
  useWorkspace.getState().openTab({ view: "web" });
  // A start page already in front is shown again, not made twice: nothing new
  // mounts to take the cursor, so the page in front is asked to.
  if (currentTab(useWorkspace.getState().layout).id === before) {
    askedAt = null;
    runBrowserCommand("address");
  }
}

/** Whether the browser tab that has just shown was made by `openWebTab` and should
 * take the cursor. Answers once, and not for a tab that shows later (a layout
 * restored at start with a blank browser tab in it must not take the cursor). */
export function takeAddressFocus(): boolean {
  const fresh = askedAt !== null && Date.now() - askedAt < ASKED_MS;
  askedAt = null;
  return fresh;
}
