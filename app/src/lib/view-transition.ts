// Switching tabs, or opening a page in the pane it was picked in, cross-fades
// through the View Transitions API (WebView2, and WebKit from Safari 18.2).
// Where the API is missing, or motion is off, the change just happens, at
// once and in the same call. Where the computer asks for less motion the
// fade is kept: it is the short fade that stands in for movement.

import { flushSync } from "react-dom";

type Starter = (update: () => void) => unknown;

/** Whether a view change may fade: motion is on, or only reduced. */
function fades(): boolean {
  const root = document.documentElement.dataset;
  return root.motion === "on" || (root.motion === "off" && root.motionReduced !== undefined);
}

/** Runs `update`, cross-fading from the old view to the new where it can.
 * Without a fade `update` has run when this returns; with one it runs on
 * the next frame, after the old view is captured. */
export function viewTransition(update: () => void): void {
  const start = (document as unknown as { startViewTransition?: Starter }).startViewTransition;
  if (!fades() || typeof start !== "function") {
    update();
    return;
  }
  // While it runs, the view's own fade (shell/view-enter.ts) stays out of the way.
  const root = document.documentElement;
  root.dataset.viewTransition = "";
  const running = start.call(document, () => {
    // The new view must be on the page when the callback returns.
    flushSync(update);
  }) as { finished?: Promise<unknown> } | undefined;
  void Promise.resolve(running?.finished)
    // A skipped transition rejects; the view is already on the page.
    .catch(() => {})
    .finally(() => {
      delete root.dataset.viewTransition;
    });
}
