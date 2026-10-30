// What the last build said about each document: errors and warnings with the
// file and line they belong to. The status line counts them; the part that
// marks them in the text (lint) and lists them reads this store. Cleared when
// a document is closed.

import { create } from "zustand";

import type { Diagnostic } from "./types";

interface DiagnosticsStore {
  /** By document folder. */
  byDoc: Record<string, Diagnostic[]>;
  set(folder: string, diagnostics: Diagnostic[]): void;
  clear(folder: string): void;
}

export const useDiagnostics = create<DiagnosticsStore>()((set, get) => ({
  byDoc: {},
  set(folder, diagnostics) {
    set({ byDoc: { ...get().byDoc, [folder]: diagnostics } });
  },
  clear(folder) {
    const byDoc = { ...get().byDoc };
    delete byDoc[folder];
    set({ byDoc });
  },
}));

/** The diagnostics for `file` (relative to the document's folder); the ones that name no file count for the root. */
export function forFile(all: readonly Diagnostic[], file: string, main: string): Diagnostic[] {
  return all.filter((d) => (d.file ?? main) === file);
}
