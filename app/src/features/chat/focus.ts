// The chat's key: one press opens the dock and puts the cursor in its message
// box; with the dock open and the cursor elsewhere, it goes to the box; from
// the box, it closes the dock again.

import { useShell } from "../../lib/store";

/** The dock's message box, if the dock is on the page. */
const messageBox = () => document.querySelector<HTMLTextAreaElement>('.kasten-chat-dock textarea[aria-label="Message"]');

export function chatShortcut(): void {
  const shell = useShell.getState();
  const box = shell.chatOpen ? messageBox() : null;
  if (box && document.activeElement !== box) {
    box.focus();
    return;
  }
  shell.toggleChat();
}
