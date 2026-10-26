// What the editor's extensions need from the window around them. The editor is
// made once for the app, but a document's folder, its index and the actions
// belong to the document that is on screen; the workspace binds them here while
// it is mounted and the extensions read them when they run.

import type { AssistIndex } from "./data";

export interface AssistBinding {
  index: AssistIndex;
  /** The document's folder and root file (relative), to match build messages to files. */
  folder: string;
  main: string;
  /** The file shown in the editor (full path), or null. */
  currentFile(): string | null;
  /** Ctrl+click on a line: show it in the PDF. */
  syncToPdf(path: string, line: number): void;
}

export const assist: { current: AssistBinding | null } = { current: null };

/** Binds the document on screen; answers how to let go of it. */
export function bindAssist(binding: AssistBinding): () => void {
  assist.current = binding;
  return () => {
    if (assist.current === binding) assist.current = null;
  };
}
