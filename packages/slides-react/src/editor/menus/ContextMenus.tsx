import { type JSX, useLayoutEffect, useMemo, useRef } from "react";

import { editorOf, focusedNow, giveFocusBack, lastEditorRoot } from "../focus/home.ts";
import type { EditorSession } from "../session/session.ts";
import type { EditorUi, UiState } from "../ui-state.ts";
import { Menu } from "../ui/Menu.tsx";
import { pointAnchor } from "../ui/Popover.tsx";
import { useEditor } from "../useEditor.ts";
import { useUiState } from "../useUi.ts";
import { contextItems } from "./context-items.ts";
import { MENU_LIST, useFocusWhenShown } from "./focus.ts";
import "./menus.css";

/**
 * Puts the focus back where it was when the menu goes, unless something else has taken it since (a dialog, a text box). When the place
 * it was is gone (the row of a filmstrip that was deleted, a block that was cut) it goes to the editor's home and not to the page.
 */
function useRestoreFocus(active: boolean): void {
  useLayoutEffect(() => {
    if (!active) return;
    const before = focusedNow();
    return () => giveFocusBack(before, editorOf(before) ?? lastEditorRoot());
  }, [active]);
}

/** The menu a right click opens, on an element, on the empty slide, or on a slide in the filmstrip. */
export function ContextMenus({ session, ui }: { session: EditorSession; ui: EditorUi }): JSX.Element | null {
  // Only the menu's own place in the window state is followed; the editor is followed by the rows, while a menu is open.
  const menu = useUiState(ui).contextMenu;
  const root = useRef<HTMLDivElement>(null);
  // With a text box open the menu leaves the focus in it (as the menu bar does), so Select all and the rest act on its words.
  const keep = ui.state.text !== null;
  useRestoreFocus(menu !== null && !keep);
  useFocusWhenShown(root, menu && !keep ? MENU_LIST : null, menu);
  if (!menu) return null;
  return (
    <div ref={root} className="ks-context ks-contents">
      <ContextRows session={session} ui={ui} menu={menu} keep={keep} />
    </div>
  );
}

/** The rows of the open menu; they follow the editor and the window while the menu is shown. */
function ContextRows({ session, ui, menu, keep }: { session: EditorSession; ui: EditorUi; menu: NonNullable<UiState["contextMenu"]>; keep: boolean }): JSX.Element {
  useEditor(session);
  useUiState(ui);
  const ctx = useMemo(() => ({ session, ui }), [session, ui]);
  // The popover opens a few pixels below its anchor, so the menu starts at the pointer.
  return <Menu items={contextItems(menu.kind, ctx)} anchor={pointAnchor(menu.x, menu.y - 4)} onClose={() => ui.openContextMenu(null)} keepFocus={keep} label="Context menu" />;
}
