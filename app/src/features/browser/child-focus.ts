// Keys while a page in a native view has the keyboard. A browser tab's page, or
// the deck preview, is a view of its own laid over the window: once the person
// has clicked into it the window's page hears no key, so Ctrl+T, Ctrl+W and
// Ctrl+L would do nothing until a click outside it. The app notices the window's
// page lost the focus to a native view (told here when the page is blurred and
// focused), takes those keys from the system while that lasts, and tells the
// window which one was pressed. Nothing is added to the pages themselves.

import { runBrowserCommand } from "./commands";
import { previewBackend } from "./preview-backend";
import { sendPreviewSignal } from "./preview-events";

export interface ChildKeyActions {
  newTab(): void;
  closeTab(): void;
  address(): void;
}

const run = (id: string) => () => void import("../workspace/shortcuts").then((m) => m.runFor(id)?.());

const WINDOW_ACTIONS: ChildKeyActions = {
  newTab: run("new-tab"),
  closeTab: run("close-tab"),
  address: () => runBrowserCommand("address"),
};

/** What a taken key does: the same as the key would have in the window. Escape belongs to the preview. */
export function handleChildKey(key: string, actions: ChildKeyActions = WINDOW_ACTIONS): void {
  switch (key) {
    case "t":
      return actions.newTab();
    case "w":
      return actions.closeTab();
    case "l":
      return actions.address();
    case "Escape":
      return sendPreviewSignal({ type: "key", key: "Escape" });
  }
}

let stopping: (() => void) | null = null;

/** Starts telling the app when the window's page loses the keyboard to a native view, and acting on the keys it takes. Once; returns how to stop. */
export function startChildFocus(): () => void {
  const backend = previewBackend();
  if (stopping || !backend.available) return stopping ?? (() => {});
  // Focus that went into a frame of the window's own page is the page's, not a native view's.
  const lost = () => {
    if (document.activeElement instanceof HTMLIFrameElement) return;
    void backend.childFocus(true).catch(() => {});
  };
  const back = () => void backend.childFocus(false).catch(() => {});
  window.addEventListener("blur", lost);
  window.addEventListener("focus", back);
  let hearing: (() => void) | null = null;
  let stopped = false;
  void backend
    .onChildKey((key) => handleChildKey(key))
    .then((stop) => {
      if (stopped) stop();
      else hearing = stop;
    })
    .catch(() => {});
  stopping = () => {
    stopped = true;
    window.removeEventListener("blur", lost);
    window.removeEventListener("focus", back);
    hearing?.();
    stopping = null;
  };
  return stopping;
}
