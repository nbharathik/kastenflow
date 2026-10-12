// Full screen for a big view: focus mode (the sidebar and bars go) and the
// window, or the page in a browser, filling the screen, given back together.

import { useCallback, useEffect, useRef, useState } from "react";

import { fillScreen } from "../../lib/fullscreen";
import { useShell } from "../../lib/store";

export function useFullScreen(): { on: boolean; toggle(): void } {
  const focus = useShell((s) => s.focusMode);
  const [on, setOn] = useState(false);
  const release = useRef<(() => void) | null>(null);

  const leave = useCallback(() => {
    release.current?.();
    release.current = null;
    setOn(false);
    if (useShell.getState().focusMode) useShell.getState().toggleFocus();
  }, []);

  const toggle = useCallback(() => {
    if (on) return leave();
    setOn(true);
    if (!useShell.getState().focusMode) useShell.getState().toggleFocus();
    void fillScreen(leave).then((undo) => {
      release.current = undo;
    });
  }, [on, leave]);

  // Esc leaves focus mode (the shell's own key); the screen is given back too.
  useEffect(() => {
    if (on && !focus) {
      release.current?.();
      release.current = null;
      setOn(false);
    }
  }, [on, focus]);

  // Closing the view gives everything back.
  useEffect(
    () => () => {
      const undo = release.current;
      release.current = null;
      if (!undo) return;
      undo();
      if (useShell.getState().focusMode) useShell.getState().toggleFocus();
    },
    [],
  );
  return { on, toggle };
}
