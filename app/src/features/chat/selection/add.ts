// "Add to chat": keeps what is selected with the chat so several snippets can
// be collected for one question (up to five). From the selection toolbar of a
// page, the key (Ctrl+Alt+L) and the palette. Works whatever "Selected text" is
// set to, and opens the chat if it is closed.

import { useShell } from "../../../lib/store";
import { useWorkspace } from "../../workspace/store";
import { useChat } from "../store";
import { MAX_KEPT, selectionChip } from "./chip";
import { registerBuiltinSources } from "./dom-sources";
import { currentSelection, MIN_SELECTION } from "./sources";

/** Keeps the current selection with the chat. Whether it was kept; the person is told when it was not. */
export function addSelectionToChat(): boolean {
  registerBuiltinSources();
  const toast = useWorkspace.getState().toast;
  const found = currentSelection();
  const chat = useChat.getState();
  // Opening the palette moves the selection away: the chip made from it is still on the chat.
  const waiting = chat.active ? chat.threads[chat.active]?.context.find((chip) => chip.kind === "selection" && chip.origin === "auto") : undefined;
  const chip = found && found.text.trim().length >= MIN_SELECTION ? selectionChip(found, true) : waiting;
  if (!chip) {
    toast("Select some text first, then add it to the chat");
    return false;
  }
  useShell.getState().toggleChat(true);
  const id = chat.active && chat.threads[chat.active] ? chat.active : chat.start({ open: true });
  if (useChat.getState().keepSelection(id, chip)) return true;
  toast(`The chat holds ${MAX_KEPT} snippets already. Remove one first`);
  return false;
}
