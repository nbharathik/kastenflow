import { type JSX, useMemo } from "react";

import type { EditorSession } from "../session/session.ts";
import type { EditorUi } from "../ui-state.ts";
import { Icon } from "../ui/Icon.tsx";
import { useEditor } from "../useEditor.ts";
import { useUiState } from "../useUi.ts";
import { barMenus } from "./bar-menus.ts";
import { submenu } from "./build.ts";
import { DropMenu } from "./DropMenu.tsx";
import { useDropdown } from "./useDropdown.ts";
import "./menus.css";

/**
 * The menu bar in a window too narrow for it: one button, Menu, whose list has File to Help as sub-menus. It is the same menus, built
 * the same way, so a command is where it is in the bar.
 */
export function CollapsedMenu({ session, ui }: { session: EditorSession; ui: EditorUi }): JSX.Element {
  useEditor(session);
  useUiState(ui);
  const dd = useDropdown();
  const ctx = useMemo(() => ({ session, ui }), [session, ui]);
  return (
    <div className="ks-menubar is-collapsed" role="menubar" aria-label="Menus">
      <button type="button" className="ks-btn ks-menubar-item" role="menuitem" data-ks-keep-focus="" aria-label="Menu" data-tip="Menu" onMouseDown={(event) => event.preventDefault()} {...dd.trigger}>
        <Icon name="list" size={16} />
        <span>Menu</span>
      </button>
      <DropMenu dd={dd} ui={ui} label="Menu" items={() => barMenus(ctx).map((menu) => submenu(menu.id, menu.label, menu.items()))} />
    </div>
  );
}
