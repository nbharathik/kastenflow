// Opening a context menu from a place that is not the slide: the empty room of the filmstrip, the tab of a side panel. The slide's own
// right click is in the canvas; any other region gives its `onContextMenu` this and the menu is the one `contextItems` makes for the kind.

import { useCallback, useRef } from "react";

import type { ContextMenuState, EditorUi } from "../ui-state.ts";

/** What of a right click the menu needs. */
interface Pointer {
  clientX: number;
  clientY: number;
  preventDefault(): void;
}

/**
 * A handler for a right click that opens the context menu of `kind` where the pointer is, in place of the browser's own. `accepts` can say
 * that a click is not for this menu (it landed on a slide, which has a menu of its own): then the click is left alone.
 */
export function contextMenuHandler(ui: EditorUi, kind: ContextMenuState["kind"], accepts?: (event: Pointer) => boolean): (event: Pointer) => void {
  return (event) => {
    if (accepts && !accepts(event)) return;
    event.preventDefault();
    ui.openContextMenu({ kind, x: event.clientX, y: event.clientY });
  };
}

/** `contextMenuHandler` for a component: the same handler for as long as `ui` and `kind` are, asking the newest `accepts` at the click. */
export function useContextMenu(ui: EditorUi, kind: ContextMenuState["kind"], accepts?: (event: Pointer) => boolean): (event: Pointer) => void {
  const latest = useRef(accepts);
  latest.current = accepts;
  return useCallback((event: Pointer) => contextMenuHandler(ui, kind, latest.current)(event), [ui, kind]);
}
