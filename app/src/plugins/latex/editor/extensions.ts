// The place other parts of the LaTeX editor add to the editor: completion of
// commands and citations, the lint that marks build errors in the text, the
// outline. An extension added here is part of every editor made after it.
// Nothing adds to it yet.

import type { Extension } from "@codemirror/state";

/** Extra CodeMirror extensions, read when an editor is made. */
export const extensions: Extension[] = [];

/** Adds an extension to editors made from now on; answers how to take it away again. */
export function addEditorExtension(extension: Extension): () => void {
  extensions.push(extension);
  return () => {
    const at = extensions.indexOf(extension);
    if (at >= 0) extensions.splice(at, 1);
  };
}
