// The extension door's backend: the app's commands inside Tauri, and a stand-in
// that says the desktop app is needed everywhere else (the browser preview,
// tests, which swap in their own with `setExtensionBackend`).

import { invoke } from "@tauri-apps/api/core";

import { inTauri } from "../../lib/api";
import { DEFAULT_PORT, type ExtensionBackend, type ExtensionStatus } from "./types";

export const NEEDS_DESKTOP = "The browser extension needs the desktop app";

const tauriBackend: ExtensionBackend = {
  available: true,
  status: () => invoke<ExtensionStatus>("extension_status"),
  setEnabled: (on) => invoke<ExtensionStatus>("set_extension_enabled", { on }),
  setPort: (port) => invoke<ExtensionStatus>("set_extension_port", { port }),
  pairStart: () => invoke<ExtensionStatus>("extension_pair_start"),
  pairCancel: () => invoke<ExtensionStatus>("extension_pair_cancel"),
  revoke: (id) => invoke<ExtensionStatus>("extension_revoke", { id }),
};

const NONE: ExtensionStatus = { enabled: false, port: DEFAULT_PORT, running: false, problem: null, paired: [], pairing: null };
const refused = () => Promise.reject(new Error(NEEDS_DESKTOP));

const previewBackend: ExtensionBackend = {
  available: false,
  status: () => Promise.resolve(NONE),
  setEnabled: refused,
  setPort: refused,
  pairStart: refused,
  pairCancel: () => Promise.resolve(NONE),
  revoke: refused,
};

let current: ExtensionBackend | null = null;

/** The backend for this window: the app's inside Tauri, the stand-in elsewhere. */
export function extensionBackend(): ExtensionBackend {
  return (current ??= inTauri() ? tauriBackend : previewBackend);
}

/** Swaps the backend (tests); with none, the window's own again. */
export function setExtensionBackend(backend: ExtensionBackend | null): void {
  current = backend;
}
