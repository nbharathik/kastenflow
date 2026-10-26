// The screen a presentation fills: asked for when the show opens, given back when it closes, and toggled by the F key. The host
// does the filling (the desktop app's window, with the display it picks); this only keeps track of whether it is held, so that the
// screen is given back on every way out (Esc, an error while starting, the host's own full screen being left).

import type { SlidesHost } from "../editor/host.ts";

export interface ShowScreen {
  /** Asks the host to fill the screen, and resolves once it has answered (or failed: the show looks right without it). */
  enter(): Promise<void>;
  /** Gives the screen back; safe to call at any time, and more than once. */
  release(): void;
  /** What the F key does: fills the screen when it is not filled, gives it back when it is. */
  toggle(): void;
}

/**
 * @param fill the host's `fillScreen`; left out where the host has none (the page's own full screen is then the F key's job)
 * @param onLeft called when the person leaves full screen another way than the F key (the browser's Esc): the show ends with it
 */
export function showScreen(fill: SlidesHost["fillScreen"] | undefined, onLeft: () => void): ShowScreen | null {
  if (!fill) return null;
  let leave: (() => void) | null = null;
  /** The screen is held, or asked for and not yet answered. */
  let wanted = false;
  let asking: Promise<void> | null = null;

  const enter = (): Promise<void> => {
    if (wanted) return asking ?? Promise.resolve();
    wanted = true;
    // A host that throws, or answers with nothing, is a host that refused: the show looks right without the screen.
    const asked = new Promise<(() => void) | undefined>((resolve) =>
      resolve(
        fill(() => {
          leave = null;
          if (!wanted) return;
          wanted = false;
          onLeft();
        }),
      ),
    ).then(
      (back) => {
        // Asked to give it back while the host was still answering: back at once.
        if (typeof back !== "function") wanted = false;
        else if (wanted && !leave) leave = back;
        else back();
      },
      () => {
        wanted = false;
      },
    );
    asking = asked.finally(() => {
      asking = null;
    });
    return asking;
  };

  const release = (): void => {
    wanted = false;
    const back = leave;
    leave = null;
    back?.();
  };

  return { enter, release, toggle: () => (wanted ? release() : void enter()) };
}
