// The desktop window opens hidden, over the page's own background, and
// shows once the page has drawn its first frame: never as a white flash.
// A timer, not an animation frame, says so, since a hidden window may not
// draw frames at all. The app shows the window after a few seconds anyway.

import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";

import { inTauri } from "../lib/api";

export function useShowWhenDrawn(): void {
  useEffect(() => {
    if (!inTauri()) return;
    // Tells the shell to show the window; if it cannot, the shell's own timeout shows it.
    const timer = setTimeout(() => void invoke("app_ready").catch(() => {}), 0);
    return () => clearTimeout(timer);
  }, []);
}
