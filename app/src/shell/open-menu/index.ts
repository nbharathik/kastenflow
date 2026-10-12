// The Open menu, for every surface that lists something to open.
//
//   <a {...openMenuHandlers(place)}>   right-click shows the menu, middle-click opens a tab
//   showOpenMenu(event, place)         the same from a handler of your own
//
// `place` is what `openPath` takes (a vault path) or what `go` takes (a
// place). `OpenMenuHost`, mounted once in the shell, draws the menu.

import type { MouseEvent } from "react";

import { useOpenMenu, type OpenTarget } from "./store";
import { openAs } from "./target";

export type { OpenTarget } from "./store";
export { copyLink, linkText, openItems } from "./items";
export { OpenMenuHost } from "./OpenMenuHost";

/** Shows the Open menu at the pointer for `target`, in place of the browser's menu. */
export function showOpenMenu(event: { clientX: number; clientY: number; preventDefault(): void }, target: OpenTarget): void {
  event.preventDefault();
  useOpenMenu.getState().show(event.clientX, event.clientY, target);
}

/** Props for any element that stands for something to open: right-click
 * shows the Open menu, middle-click opens it in a new tab. Spread them on
 * the element next to its own click handler. */
export function openMenuHandlers(target: OpenTarget) {
  return {
    onContextMenu: (event: MouseEvent) => showOpenMenu(event, target),
    onAuxClick: (event: MouseEvent) => {
      if (event.button !== 1) return;
      event.preventDefault();
      openAs(target, "tab");
    },
  };
}
