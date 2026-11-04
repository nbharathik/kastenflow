import { type JSX, useMemo } from "react";

import { keysOf, runCommand } from "../commands/index.ts";
import type { EditorSession } from "../session/session.ts";
import type { EditorUi } from "../ui-state.ts";
import { Icon } from "../ui/Icon.tsx";
import "./menus.css";

/**
 * "Search": the button in the title bar that opens the command palette (commands, which are every row of every menu, things to insert,
 * and slides). Ctrl+Shift+P does the same from anywhere; Alt+/ opens it on the commands and "/" on the things to insert.
 */
export function MenuSearch({ session, ui }: { session: EditorSession; ui: EditorUi }): JSX.Element {
  const ctx = useMemo(() => ({ session, ui }), [session, ui]);
  const keys = keysOf("view.palette");
  return (
    <button
      type="button"
      className="ks-btn ks-menu-search"
      aria-label="Command palette"
      aria-haspopup="dialog"
      data-tip={keys ? `Command palette (${keys})` : "Command palette"}
      data-ks-keep-focus=""
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => void runCommand("view.palette", ctx)}
    >
      <Icon name="search" size={14} />
      <span>Search</span>
    </button>
  );
}
