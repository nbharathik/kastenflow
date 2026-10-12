import { useSyncExternalStore } from "react";

import type { EditorUi, UiState } from "../ui-state.ts";

/** One part of the window state; the view re-renders only when that part changes (the way `useEditorValue` follows the session). */
export function useUiValue<T>(ui: EditorUi, select: (state: UiState) => T): T {
  return useSyncExternalStore(
    ui.subscribe,
    () => select(ui.getSnapshot()),
    () => select(ui.getSnapshot()),
  );
}
