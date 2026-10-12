// The vault's diagrams, for tabs, the Diagrams view, the picker in pages and
// slides, and the sidebar. Loaded when asked and again whenever a diagram's
// files change. Also a small announcement, so a picture shown in a page, a
// card or a slide is read again when its diagram was saved.

import { create } from "zustand";

import type { DiagramInfo } from "../../lib/vault/types";
import { useWorkspace } from "../workspace/store";
import { drawAgainLater } from "./host-store";
import { sourceOf, titleOfPath } from "./names";

interface DiagramsState {
  list: DiagramInfo[];
  loaded: boolean;
  /** A diagram just made "from a template": its editor shows the editor's template dialog as soon as it is ready. */
  templateFor: string | null;
  /** Reads the list again; the old one stays if that fails. */
  load(): Promise<void>;
}

/** The latest load; an older one answering later is dropped. */
let latest = 0;

export const useDiagrams = create<DiagramsState>((set) => ({
  list: [],
  loaded: false,
  templateFor: null,
  async load() {
    const client = useWorkspace.getState().client;
    if (!client) return;
    const mine = ++latest;
    try {
      const list = await client.diagrams();
      if (mine === latest) set({ list, loaded: true });
    } catch {
      // Keep what we had.
    }
  },
}));

/** A diagram's title from the list, else from its file's name. */
export function diagramTitle(list: readonly DiagramInfo[], path: string): string {
  return list.find((d) => d.path === path)?.title ?? titleOfPath(path);
}

type Listener = (path: string) => void;
const listeners = new Set<Listener>();

/** Hears of each diagram whose files changed (saved in the editor, drawn again, renamed away). Returns how to stop. */
export function onDiagramChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Says that the diagram at `path` changed, so pictures of it are read again and the list is. */
export function diagramChanged(path: string): void {
  for (const listener of [...listeners]) listener(path);
  void useDiagrams.getState().load();
}

/** Called with every batch of changed vault paths (an agent, another app, a sync, the app's own saves): the diagrams among
 * them are read again, and a source that changed may need its picture drawn again. */
export function diagramFilesChanged(paths: string[]): void {
  const diagrams = [...new Set(paths.filter((p) => p.endsWith(".drawio") || p.endsWith(".drawio.svg")).map(sourceOf))];
  if (diagrams.length === 0) return;
  for (const path of diagrams) {
    drawAgainLater(path);
    for (const listener of [...listeners]) listener(path);
  }
  void useDiagrams.getState().load();
}
