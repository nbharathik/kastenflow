// Makes a page kept from the web answer "Highlight the selected words" (the
// palette's command, highlight-registry.ts): the words selected in its
// editor are highlighted in the colour last used in the reader or here.

import { useEffect, type RefObject } from "react";

import { lastColor } from "../sources/reader/SelectionBar";
import { registerHighlighter } from "./highlight-registry";
import type { SelectionEditor } from "./use-selected-words";
import { MOST_HIGHLIGHT, type HighlightsModel } from "./use-text-highlights";

/** Makes the page highlightable by the palette while `enabled`. */
export function useHighlighter(model: HighlightsModel, editor: RefObject<SelectionEditor | null>, page: RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    const dom = page.current;
    if (!enabled || !dom) return;
    return registerHighlighter({
      dom,
      highlight: async () => {
        const words = editor.current?.selectedWords(MOST_HIGHLIGHT)?.words;
        return words ? model.add(words, lastColor()) : false;
      },
    });
  }, [model, editor, page, enabled]);
}
