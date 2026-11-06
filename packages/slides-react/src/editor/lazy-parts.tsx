// The parts of the window that are not on screen when a deck opens: the outline and grid views, the gallery drawer and the dialogs.
// Each is its own file of the bundle, so opening a deck does not wait on code for what may never be shown.

import { useEffect } from "react";

import { preloadDialogs } from "./dialogs/Dialogs.tsx";
import { lazyPart } from "./lazy.tsx";
import type { EditorSession } from "./session/session.ts";
import type { EditorUi } from "./ui-state.ts";

interface PartProps {
  session: EditorSession;
  ui: EditorUi;
}

export const Outline = lazyPart<PartProps>(() => import("./outline/OutlineView.tsx").then((module) => module.OutlineView));
export const Grid = lazyPart<PartProps>(() => import("./grid/GridView.tsx").then((module) => module.GridView));
export const Gallery = lazyPart<PartProps>(() => import("./gallery/GalleryDrawer.tsx").then((module) => module.GalleryDrawer));

/** Loads every part now. */
export function preloadParts(): Promise<unknown> {
  return Promise.all([preloadDialogs(), Outline.preload(), Grid.preload(), Gallery.preload()]);
}

interface Idle {
  requestIdleCallback?(run: () => void, options: { timeout: number }): number;
  cancelIdleCallback?(id: number): void;
}

/** Once the editor has painted and the page is idle, loads the parts, so the first Find or Outline is as quick as the second. */
export function usePreloadParts(ready: boolean): void {
  useEffect(() => {
    if (!ready) return;
    const idle = globalThis as unknown as Idle;
    const run = () => void preloadParts().catch(() => {});
    if (idle.requestIdleCallback) {
      const id = idle.requestIdleCallback(run, { timeout: 4000 });
      return () => idle.cancelIdleCallback?.(id);
    }
    const timer = setTimeout(run, 800);
    return () => clearTimeout(timer);
  }, [ready]);
}
