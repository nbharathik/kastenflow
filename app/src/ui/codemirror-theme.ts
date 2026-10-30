// The CodeMirror theme for Crepe's code blocks and the LaTeX editor. It uses
// the colour tokens, so it follows the light or dark theme by itself.

import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { codeThemeSpec } from "./codemirror-spec";

/** The extension to pass as a CodeMirror editor's `theme`. */
export function codemirrorTheme(): Extension {
  const dark = typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "dark";
  return EditorView.theme(codeThemeSpec(), { dark });
}
