import type { TextEditorHandle } from "../text/index.ts";

/**
 * What the commands need of a text box being edited: the formatting they can
 * apply to the selected words, and how those words look now. The text editor
 * component's handle is all of it.
 */
export type TextHandle = TextEditorHandle;
