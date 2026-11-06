import { useLayoutEffect, useMemo, useReducer, useRef, useSyncExternalStore } from "react";

import type { EditorUi, UiState } from "./ui-state.ts";

const field = (state: UiState, key: string): unknown => (state as unknown as Record<string, unknown>)[key];

/**
 * The window-level state of the editor (views, panels, zoom), and a re-render when what the caller reads of it changes. A
 * component that reads `zoom` and `panel` is drawn again for those and for nothing else: a wheel that zooms the slide fifty times
 * a second does not draw the title bar, the menus and the dialogs fifty times. A component that reads nothing of it (it only
 * wants to follow every change) is drawn again for every change, as it always was.
 *
 * What is read is what is read while the component is drawn, through the object returned, and it starts afresh with every
 * drawing: a branch that is no longer taken stops being followed. While drawing, a key already followed is read from the state the
 * drawing was made from; reads that come later (in a handler) are of the state as it is then.
 */
export function useUiState(ui: EditorUi): UiState {
  /** The keys the last drawing that was kept read; what a change is measured against. */
  const followed = useRef(new Set<string>());
  /** The keys this drawing reads. */
  const reading = useRef(new Set<string>());
  /** True from the start of a drawing until it is kept. */
  const drawing = useRef(false);
  const seen = useRef<UiState>(ui.getSnapshot());
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  reading.current = new Set();
  drawing.current = true;

  const getSnapshot = (): UiState => {
    const next = ui.getSnapshot();
    const before = seen.current;
    if (next === before) return before;
    const keys = followed.current;
    const differs = (key: string) => !Object.is(field(next, key), field(before, key));
    // The host's actions are read from the window state's object, not through this one, so a change of them is always for the caller.
    const relevant = keys.size === 0 || differs("actionsRevision") || [...keys].some(differs);
    if (relevant) seen.current = next;
    return seen.current;
  };
  const snapshot = useSyncExternalStore(ui.subscribe, getSnapshot, getSnapshot);

  useLayoutEffect(() => {
    drawing.current = false;
    followed.current = reading.current;
    // A key read for the first time came from the live state, which may be newer than the state changes are measured against.
    const live = ui.getSnapshot();
    if (live !== seen.current && [...reading.current].some((key) => !Object.is(field(live, key), field(seen.current, key)))) {
      seen.current = live;
      redraw();
    }
  });

  // The same object for the same state, so that what a caller puts in an effect's list is not new at each drawing.
  return useMemo(() => {
    const note = (key: string | symbol): void => {
      if (typeof key === "string" && drawing.current) reading.current.add(key);
    };
    const read = (key: string | symbol): unknown => {
      const live = ui.getSnapshot();
      if (typeof key !== "string") return Reflect.get(live, key);
      // Drawing, a key that was followed comes from the state the drawing was made from; any other read is of the state now.
      return drawing.current && followed.current.has(key) ? field(snapshot, key) : field(live, key);
    };
    return new Proxy(snapshot, {
      get: (_, key) => {
        note(key);
        return read(key);
      },
      has: (_, key) => Reflect.has(ui.getSnapshot(), key),
      ownKeys: () => {
        if (drawing.current) for (const key of Object.keys(ui.getSnapshot())) reading.current.add(key);
        return Reflect.ownKeys(ui.getSnapshot());
      },
      getOwnPropertyDescriptor: (_, key) => {
        note(key);
        const found = Reflect.getOwnPropertyDescriptor(ui.getSnapshot(), key);
        return found ? { ...found, configurable: true } : undefined;
      },
    });
  }, [snapshot, ui]);
}
