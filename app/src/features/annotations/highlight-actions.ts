// Makes a page kept from the web answer "Highlight the selected words" (the
// palette's command, highlight-registry.ts) and the selection bar's colours
// (toolbar-items.ts): the words selected in its editor are highlighted in the
// colour asked for, or the one last used in the reader or here. The keys 1 to
// 5, typed out of the text, pick a colour too.

import { useEffect, type RefObject } from "react";

import { freeKey } from "../../lib/keys";
import { HIGHLIGHT_COLORS } from "../sources/colors";
import { keepColor, lastColor } from "../sources/reader/SelectionBar";
import { registerHighlighter } from "./highlight-registry";
import type { SelectionEditor } from "./use-selected-words";
import { MOST_HIGHLIGHT, type HighlightsModel } from "./use-text-highlights";

/** Makes the page highlightable by the palette and the selection bar while `enabled`. */
export function useHighlighter(model: HighlightsModel, editor: RefObject<SelectionEditor | null>, page: RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    const dom = page.current;
    if (!enabled || !dom) return;
    const words = () => editor.current?.selectedWords(MOST_HIGHLIGHT)?.words ?? null;
    // The bar's items show only on a page like this (annotations.css).
    dom.dataset.captured = "";
    const forget = registerHighlighter({
      dom,
      highlight: async () => {
        const found = words();
        return found ? model.add(found, lastColor()) : false;
      },
      words,
      add: (found, color, comment) => model.add(found, color, comment),
    });
    const onKey = (event: KeyboardEvent) => {
      const n = Number(event.key);
      if (!Number.isInteger(n) || n < 1 || n > HIGHLIGHT_COLORS.length || event.ctrlKey || event.metaKey || event.altKey || !freeKey(event)) return;
      const found = words();
      if (!found) return;
      event.preventDefault();
      keepColor(HIGHLIGHT_COLORS[n - 1]!);
      void model.add(found, HIGHLIGHT_COLORS[n - 1]!);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      delete dom.dataset.captured;
      forget();
    };
  }, [model, editor, page, enabled]);
}
