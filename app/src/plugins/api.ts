// How the window asks the app about plugins: the list with each one's choice,
// turning one on or off, and a download's status, install, cancel and remove.
// Outside the desktop app there is nobody to ask, so the backend is null.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { inTauri } from "../lib/api";
import type { PluginScope } from "./types";

/** What the app says about one plugin (src-tauri/src/plugins `PluginView`). */
export interface PluginInfo {
  id: string;
  name: string;
  summary: string;
  version: string;
  defaultOn: boolean;
  scope: PluginScope;
  payload: { label: string; version: string; sizeBytes: number } | null;
  enabled: boolean;
}

export type PayloadPhase = "idle" | "downloading" | "verifying" | "installing" | "ready" | "failed" | "cancelled";

/** One step of a download (the `plugin-payload` event). */
export interface PayloadEvent {
  id: string;
  state: PayloadPhase;
  done: number;
  total: number;
  error?: string;
}

export interface PayloadStatus {
  id: string;
  state: PayloadPhase;
  installed: boolean;
  busy: boolean;
  version: string | null;
  sizeBytes: number;
  /** An older version that is installed whole when the pinned one is not: the card offers an update. */
  installedVersion?: string;
}

export interface PluginsBackend {
  list(): Promise<PluginInfo[]>;
  /** Answers whether anything changed. */
  setEnabled(id: string, on: boolean): Promise<boolean>;
  status(id: string): Promise<PayloadStatus>;
  /** Answers "installed" or "cancelled" when it is over; rejects with why it failed. */
  install(id: string): Promise<string>;
  cancel(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** Tells every step of every download; answers a way to stop listening. */
  onPayload(handler: (event: PayloadEvent) => void): Promise<() => void>;
}

const desktop: PluginsBackend = {
  list: () => invoke<PluginInfo[]>("plugins_list"),
  setEnabled: (id, on) => invoke<boolean>("plugin_set_enabled", { id, on }),
  status: (id) => invoke<PayloadStatus>("plugin_payload_status", { id }),
  install: (id) => invoke<string>("plugin_payload_install", { id }),
  cancel: (id) => invoke<void>("plugin_payload_cancel", { id }),
  remove: (id) => invoke<void>("plugin_payload_remove", { id }),
  onPayload: (handler) => listen<PayloadEvent>("plugin-payload", (event) => handler(event.payload)),
};

let override: PluginsBackend | null = null;

/** Replaces how plugins are asked for (tests); null goes back to the app's own. */
export function setPluginsBackend(next: PluginsBackend | null): void {
  override = next;
}

/** The backend to use, or null in the browser preview. */
export const pluginsBackend = (): PluginsBackend | null => override ?? (inTauri() ? desktop : null);

export const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));
