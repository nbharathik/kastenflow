import { useMemo, useRef, useSyncExternalStore } from "react";

import type { EditorUi, UiState } from "./ui-state.ts";

/**
 * The window-level state of the editor (views, panels, zoom), and a re-render when what the caller reads of it changes. A
 * component that reads `zoom` and `panel` is drawn again for those and for nothing else: a wheel that zooms the slide fifty times
 * a second does not draw the title bar, the menus and the dialogs fifty times. A component that reads nothing of it (it only
 * wants to follow every change) is drawn again for every change, as it always was.
 *
 * What is read is what is read during the drawing, through the object returned; reads that come later (in a handler) are of the
 * state as it is then, not as it was drawn.
 */
export function useUiState(ui: EditorUi): UiState {
  const read = useRef(new Set<string>());
  const seen = useRef<UiState>(ui.getSnapshot());
  const getSnapshot = (): UiState => {
    const next = ui.getSnapshot();
    const before = seen.current;
    if (next === before) return before;
    const keys = read.current;
    const differs = (key: string) => !Object.is((next as unknown as Record<string, unknown>)[key], (before as unknown as Record<string, unknown>)[key]);
    // The host's actions are read from the window state's object, not through this one, so a change of them is always for the caller.
    const relevant = keys.size === 0 || differs("actionsRevision") || [...keys].some(differs);
    if (relevant) seen.current = next;
    return seen.current;
  };
  const snapshot = useSyncExternalStore(ui.subscribe, getSnapshot, getSnapshot);
  // The same object for the same state, so that what a caller puts in an effect's list is not new at each drawing.
  return useMemo(
    () =>
      new Proxy(snapshot, {
        get: (_, key) => {
          if (typeof key === "string") read.current.add(key);
          return Reflect.get(ui.getSnapshot(), key);
        },
        has: (_, key) => Reflect.has(ui.getSnapshot(), key),
        ownKeys: () => {
          for (const key of Object.keys(ui.getSnapshot())) read.current.add(key);
          return Reflect.ownKeys(ui.getSnapshot());
        },
        getOwnPropertyDescriptor: (_, key) => {
          if (typeof key === "string") read.current.add(key);
          const found = Reflect.getOwnPropertyDescriptor(ui.getSnapshot(), key);
          return found ? { ...found, configurable: true } : undefined;
        },
      }),
    [snapshot, ui],
  );
}
