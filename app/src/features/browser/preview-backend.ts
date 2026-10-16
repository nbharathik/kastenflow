// How the window reaches the deck preview (a page shown beside a slide by a
// native view) and the keys a native view takes: the app's commands inside
// Tauri, and a stand-in that does nothing everywhere else (the browser preview,
// tests, which swap in their own with `setPreviewBackend`).

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { inTauri } from "../../lib/api";
import type { Bounds, Nav } from "./types";

export interface PreviewBackend {
  /** Whether web pages can be shown at all (the desktop app only). */
  readonly available: boolean;
  /** Opens the preview, or moves the one that is open and takes it to `url`. Resolves to the address it shows. */
  open(url: string, bounds: Bounds): Promise<string>;
  bounds(bounds: Bounds): Promise<void>;
  nav(nav: Nav): Promise<void>;
  hide(): Promise<void>;
  show(): Promise<void>;
  close(): Promise<void>;
  /** The window's own page lost the keyboard to a native view (`on`), or has it back. */
  childFocus(on: boolean): Promise<void>;
  /** Hears the keys taken while a native view has the keyboard, as a keyboard event names them: "t", "w", "l", "Escape". */
  onChildKey(listener: (key: string) => void): Promise<() => void>;
}

const tauriBackend: PreviewBackend = {
  available: true,
  open: (url, bounds) => invoke<string>("preview_open", { url, bounds }),
  bounds: (bounds) => invoke<void>("preview_bounds", { bounds }),
  nav: (nav) => invoke<void>("preview_nav", { nav }),
  hide: () => invoke<void>("preview_hide"),
  show: () => invoke<void>("preview_show"),
  close: () => invoke<void>("preview_close"),
  childFocus: (on) => invoke<void>("browser_child_focus", { on }),
  onChildKey: (listener) => listen<{ key: string }>("kasten://child-key", (e) => listener(e.payload.key)),
};

const NEEDS_DESKTOP = "Web previews need the desktop app";

const standIn: PreviewBackend = {
  available: false,
  open: () => Promise.reject(new Error(NEEDS_DESKTOP)),
  bounds: () => Promise.resolve(),
  nav: () => Promise.resolve(),
  hide: () => Promise.resolve(),
  show: () => Promise.resolve(),
  close: () => Promise.resolve(),
  childFocus: () => Promise.resolve(),
  onChildKey: () => Promise.resolve(() => {}),
};

let current: PreviewBackend | null = null;

/** The backend for this window: the app's inside Tauri, the stand-in elsewhere. */
export function previewBackend(): PreviewBackend {
  return (current ??= inTauri() ? tauriBackend : standIn);
}

/** Swaps the backend (tests); with none, the window's own again. */
export function setPreviewBackend(backend: PreviewBackend | null): void {
  current = backend;
}
