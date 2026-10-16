// The right-click menu on selected text: Explain and Ask AI beside Copy and
// Cut. It takes the place of the system's menu only for a click inside a
// selection; a click anywhere else keeps the system's (spelling, paste).

import type { EditorView } from "@milkdown/kit/prose/view";

import type { WriteAction } from "../../../chat/types";
import { closesWith } from "../ui/close-with-editor";
import { Popover } from "../ui/popover";

/** Whether a right-click at `event` is inside the editor's selection. */
function insideSelection(view: EditorView, event: MouseEvent): boolean {
  const { from, to, empty } = view.state.selection;
  if (empty) return false;
  const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
  return Boolean(at && at.pos >= from && at.pos <= to);
}

/** Shows the menu for a right-click on selected text; false when the click is
 * elsewhere and the system's menu should show. `open` starts an AI action on
 * the selection. */
export function selectionMenu(view: EditorView, event: MouseEvent, open: (action: WriteAction) => void): boolean {
  if (!insideSelection(view, event)) return false;
  event.preventDefault();
  const at = { left: event.clientX, top: event.clientY, right: event.clientX, bottom: event.clientY };
  const command = (name: "copy" | "cut") => () => {
    view.focus();
    document.execCommand(name);
  };
  closesWith(
    view,
    new Popover(
      [
        {
          items: [
            { key: "explain", label: "Explain", icon: "icon:bulb", description: "Say what the selected text means; the page stays as it is.", onPick: () => open("explain") },
            { key: "ask-ai", label: "Ask AI…", icon: "icon:sparkle", description: "Ask AI to change the selected text or write about it.", onPick: () => open("ask") },
          ],
        },
        {
          items: [
            { key: "copy", label: "Copy", icon: "icon:copy", hint: "Ctrl+C", onPick: command("copy") },
            { key: "cut", label: "Cut", icon: "icon:remove", hint: "Ctrl+X", onPick: command("cut") },
          ],
        },
      ],
      { anchor: () => at, ownKeys: true, label: "Selected text" },
    ),
  );
  return true;
}
