// "Every selected text is always available as context." While the chat shows a
// thread, selecting 3 or more characters in the focused page, PDF, LaTeX editor
// or slide text box puts an automatic chip on it ("Selection · “first words…” ·
// Page title"), 250 ms after the selection settles. The next selection replaces
// it; it stays when the selection collapses (so a click into the message box
// does not lose it) until it is sent or dismissed. The setting "Selected text"
// turns this off, or leaves it to "Add to chat".

import { useEffect } from "react";

import { usePanelPrefs } from "../panel-prefs";
import { useChat } from "../store";
import { selectionChip } from "./chip";
import { registerBuiltinSources } from "./dom-sources";
import { currentSelection, MIN_SELECTION } from "./sources";

/** How long a selection must hold still before it becomes a chip. */
export const SELECTION_DELAY_MS = 250;

export function useSelectionContext(thread: string | null): void {
  const mode = usePanelPrefs((s) => s.selectedText);
  useEffect(() => {
    if (!thread || mode !== "auto") return;
    registerBuiltinSources();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const read = () => {
      timer = null;
      const found = currentSelection();
      // A collapsed or short selection leaves the chip as it is.
      if (!found || found.text.trim().length < MIN_SELECTION) return;
      useChat.getState().setSelection(thread, selectionChip(found, false));
    };
    const on = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(read, SELECTION_DELAY_MS);
    };
    document.addEventListener("selectionchange", on);
    // What is selected as the chat opens counts too.
    on();
    return () => {
      document.removeEventListener("selectionchange", on);
      if (timer) clearTimeout(timer);
    };
  }, [thread, mode]);
}
