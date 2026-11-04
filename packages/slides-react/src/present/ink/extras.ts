// The ink's keys and toolbar buttons in the show: P the pen, H the highlighter, E clears the slide's ink, and Esc puts the pen down before
// it leaves the show. They are given to the show's tools (chrome.js) so that the toolbar and the keys do the same.

import type { ChromeExtras } from "../runtime/chrome.js";
import type { InkStore } from "./store.ts";

export function inkExtras(ink: InkStore): ChromeExtras {
  const pen = (): void => ink.toggleTool("pen");
  const highlighter = (): void => ink.toggleTool("highlighter");
  const clear = (): void => ink.clear();
  return {
    keys: [
      [[80], pen],
      [[72], highlighter],
      [[69], clear],
    ],
    tools: [
      ["pen", "✎", "Pen", "P", pen],
      ["highlighter", "▰", "Highlighter", "H", highlighter],
      ["clear", "⌫", "Clear the ink on this slide", "E", clear],
    ],
    escape: () => {
      if (ink.getSnapshot().tool === null) return false;
      ink.setTool(null);
      return true;
    },
  };
}
