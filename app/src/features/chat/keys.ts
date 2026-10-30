// The chat's keys. Esc and the up arrow belong to the chat that has the focus
// (a hook for Esc, the message box for the arrow); copying the last answer and
// going to the message box are commands with keys of their own (shortcuts/keymap.ts),
// which anything can run.

import { useEffect, type RefObject } from "react";

import { useShell } from "../../lib/store";
import { firstVisible } from "../../shell/visible-dom";
import { copyLastAnswer } from "./copy";
import { useChat } from "./store";

const BOX = 'textarea[aria-label="Message"]';

/** The thread the person is talking to: the one the chat shows. */
const shown = () => {
  const { active, threads } = useChat.getState();
  return active ? threads[active] : undefined;
};

/** Copies the newest answer of the chat in front, as words. */
export function copyShownAnswer(): void {
  void copyLastAnswer(shown());
}

/** Puts the cursor in the message box in front; opens the chat dock when there is none. */
export function focusComposer(): void {
  const box = firstVisible<HTMLTextAreaElement>(BOX);
  if (box) {
    box.focus();
    return;
  }
  const shell = useShell.getState();
  if (!shell.chatOpen) shell.toggleChat(true);
  // The dock's box is drawn after it opens.
  requestAnimationFrame(() => firstVisible<HTMLTextAreaElement>(BOX)?.focus());
}

/** Whether Esc, pressed on `target`, is meant for the answer running in `container`: the focus is in that chat (not on the page
 * beside it, whose Esc is its own), not in a field other than the empty message box, and no menu or dialog is open. */
function stopsAnswer(target: EventTarget | null, container: Element | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !container?.contains(el)) return false;
  if (document.querySelector('[aria-modal="true"], [role="menu"], [role="listbox"], [role="dialog"]')) return false;
  const typing = el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
  // The message box, when it holds nothing: Esc then has nothing else to do.
  return !typing || (el instanceof HTMLTextAreaElement && el.matches(BOX) && el.value === "");
}

/** Esc stops the answer that is running in this thread (when the message box is empty or not focused);
 * otherwise Esc does what it did. */
export function useStopWithEscape(thread: string, container: RefObject<Element | null>): void {
  useEffect(() => {
    const on = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const t = useChat.getState().threads[thread];
      if (!t?.streaming || t.stopping || !stopsAnswer(event.target, container.current)) return;
      // Another view of the same thread may hear it too: once is enough.
      event.preventDefault();
      void useChat.getState().stop(thread);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [thread, container]);
}
