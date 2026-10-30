// The quick capture window's page (capture.html). It shares the main
// window's theme and accent, which are kept in this app's storage.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { usePrefs } from "../features/workspace/prefs";
import { applyMotion, watchSystemMotion } from "../lib/motion";
import { applyAccent, applyTheme, loadTheme, watchSystemTheme } from "../features/workspace/theme";
import { tauriVault } from "../lib/vault/tauri";
import "../styles.css";
import { CaptureBox, type CaptureHost } from "./CaptureBox";
import "./capture.css";

applyTheme(loadTheme());
applyAccent(usePrefs.getState().accent);
watchSystemTheme(loadTheme);
applyMotion(usePrefs.getState().motion);
watchSystemMotion(() => usePrefs.getState().motion);

const host: CaptureHost = {
  client: tauriVault("Quick capture"),
  // The capture window's notices to the app: if the app is gone there is no one to tell.
  hide: () => void invoke("capture_hide").catch(() => {}),
  done: (captured) => void invoke("capture_done", { captured }).catch(() => {}),
  resize: (height) => void invoke("capture_resize", { height }).catch(() => {}),
  onOpen: (then) => {
    // The main window may have changed the theme meanwhile.
    const stop = listen("kasten://capture-open", () => {
      applyTheme(loadTheme());
      then();
    });
    return () => void stop.then((fn) => fn(), () => {});
  },
};

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <CaptureBox host={host} />
    </StrictMode>,
  );
}
