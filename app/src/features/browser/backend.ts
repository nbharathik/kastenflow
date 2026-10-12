// The browser's backend: the app's commands inside Tauri, and a stand-in
// that says the desktop app is needed everywhere else (the browser preview,
// tests, which swap in their own with `setBrowserBackend`).

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { inTauri } from "../../lib/api";
import type { BrowserBackend, BrowserEvent } from "./types";

export const NEEDS_DESKTOP = "The browser needs the desktop app";

const tauriBackend: BrowserBackend = {
  available: true,
  enabled: () => invoke<boolean>("browser_enabled"),
  setEnabled: (on) => invoke<boolean>("set_browser_enabled", { on }),
  open: (id, url, bounds) => invoke<string>("browser_open", { id, url, bounds }),
  bounds: (id, bounds) => invoke<void>("browser_bounds", { id, bounds }),
  hide: (id) => invoke<void>("browser_hide", { id }),
  show: (id) => invoke<void>("browser_show", { id }),
  close: (id) => invoke<void>("browser_close", { id }),
  nav: (id, nav) => invoke<void>("browser_nav", { id, nav }),
  capture: (id, kind) => invoke("browser_capture", { id, kind }),
  confirm: (token, place, title) => invoke("browser_capture_confirm", { token, place, title: title ?? null }),
  discard: (token) => invoke<void>("browser_capture_discard", { token }),
  clearData: () => invoke<void>("browser_clear_data"),
  onEvent: (listener) => listen<BrowserEvent>("browser-event", (e) => listener(e.payload)),
};

const refused = () => Promise.reject(new Error(NEEDS_DESKTOP));

const previewBackend: BrowserBackend = {
  available: false,
  enabled: () => Promise.resolve(false),
  setEnabled: refused,
  open: refused,
  bounds: refused,
  hide: () => Promise.resolve(),
  show: () => Promise.resolve(),
  close: () => Promise.resolve(),
  nav: refused,
  capture: refused,
  confirm: refused,
  discard: () => Promise.resolve(),
  clearData: refused,
  onEvent: () => Promise.resolve(() => {}),
};

let current: BrowserBackend | null = null;

/** The backend for this window: the app's inside Tauri, the stand-in elsewhere. */
export function browserBackend(): BrowserBackend {
  return (current ??= inTauri() ? tauriBackend : previewBackend);
}

/** Swaps the backend (tests); with none, the window's own again. */
export function setBrowserBackend(backend: BrowserBackend | null): void {
  current = backend;
}
