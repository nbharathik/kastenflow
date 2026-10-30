// The screen a slide show fills in the desktop app: the display the person chose ("Present on"), kept for this computer. With two
// displays the app moves the window to the one chosen before it goes full screen, puts the presenter's window on the other, and
// puts everything back afterwards (src-tauri/src/presenter_screen.rs). The window's own full screen is `fullscreen.ts`; either
// may be refused, and the show must look right without it.

import type { PresentScreens } from "@kasten-slides/react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { inTauri } from "./api";
import { fillScreen } from "./fullscreen";

/** Where the choice is kept. A web view's storage belongs to this computer, which is what the choice is for. */
export const PRESENT_ON_KEY = "kasten-present-on";

/** The words of a choice: `auto`, `here`, or `name:<display>`. */
const CHOICE = /^(auto|here|name:.+)$/;

export function readPresentOn(): string {
  try {
    const stored = localStorage.getItem(PRESENT_ON_KEY);
    return stored !== null && CHOICE.test(stored) ? stored : "auto";
  } catch {
    return "auto";
  }
}

export function writePresentOn(choice: string): void {
  if (!CHOICE.test(choice)) return;
  try {
    localStorage.setItem(PRESENT_ON_KEY, choice);
  } catch {
    // Nothing is remembered; the choice still holds until the app closes.
  }
}

/** What the slideshow options offer: the displays attached now, and the choice. */
export const presentScreens: PresentScreens = {
  displays: () => invoke<string[]>("present_displays").catch(() => []),
  chosen: readPresentOn,
  choose: writePresentOn,
};

const none = (): void => {};

/**
 * Fills the screen for a show: on the display chosen. Resolves to what gives it all back (the window to where it was, and the
 * presenter's window with it); `onLeft` is called when the person leaves full screen another way.
 */
export async function fillShowScreen(onLeft: () => void): Promise<() => void> {
  if (!inTauri()) return fillScreen(onLeft);
  // The window goes to the display first: a window that is full screen on one display stays there.
  await invoke("present_enter", { choice: readPresentOn() }).catch(none);
  const back = await fillScreen(onLeft);
  // A display that is plugged in or out, or one with another scale, changes the window's: fill the one it is on now.
  const stop = await getCurrentWindow()
    .onScaleChanged(() => {
      const win = getCurrentWindow();
      void win
        .setFullscreen(false)
        .then(() => win.setFullscreen(true))
        .catch(none);
    })
    .catch(() => none);
  return () => {
    stop();
    back();
    void invoke("present_leave").catch(none);
  };
}
