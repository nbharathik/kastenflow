// A press that is not on a block, a handle or the words being written: on the grey stage round the slide, or on bare background
// elsewhere in the editor. It clears what was selected, as it does in every slide editor, so that what looks selected is what the keys
// act on. Pressing with Shift or Ctrl held adds to a selection and never clears it, and a press that is not the main button is not a click.

import type { EditorSession } from "../session/session.ts";

/** What of a press matters here. */
export interface Press {
  button: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey?: boolean;
}

/** Whether a press is a plain click: the main button with no key that adds to the selection held. */
export function isPlainClick(press: Press): boolean {
  return press.button === 0 && !press.shiftKey && !press.ctrlKey && !press.metaKey;
}

/**
 * Takes the selection off: the text box being written in is left, the group gone into is left, and nothing is selected. A tool that is
 * drawing keeps its press (the press is the start of a shape), so this is for the pointer tool only. Answers whether it was a press that cleared.
 */
export function clearSelection(session: EditorSession, press: Press): boolean {
  if (!isPlainClick(press) || session.state.tool !== "select") return false;
  session.stopEditing();
  session.leaveGroups();
  session.select([]);
  return true;
}

/** What is a control, a field or words, and so a press on it is the control's and is not on bare background. */
const OWN =
  "button, a, input, select, textarea, label, summary, [contenteditable], [role='button'], [role='menuitem'], [role='menuitemcheckbox'], [role='option'], [role='tab'], [role='slider'], [role='switch'], [role='checkbox'], [role='textbox'], [data-chrome], .ks-menu, .ks-popover";

/** Whether the element is bare background: a container with no words of its own and none of the controls above it. */
export function isBareBackground(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement) || target.closest(OWN)) return false;
  return ![...target.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "");
}
