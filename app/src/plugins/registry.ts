// Which plugins are on, and what the ones that loaded contribute. The choice
// itself lives in the app (the vault's settings, or this computer's for the
// browser): `sync` reads it, `setEnabled` writes it, and downloads are told as
// they go. The window reads the contributions through plugins/contributions.ts.

import { create } from "zustand";

import { messageOf, pluginsBackend, type PayloadEvent, type PluginInfo, type PluginsBackend } from "./api";
import { CATALOG } from "./catalog";
import type { CatalogEntry, PluginContributions } from "./types";

/** How a plugin's download is, as the Settings card shows it. */
export interface PayloadState {
  phase: "idle" | "downloading" | "verifying" | "installing" | "ready" | "failed" | "cancelled";
  installed: boolean;
  /** Set when an older download is in place and the pinned version is not: "Update available". */
  older?: boolean;
  done: number;
  total: number;
  error?: string;
}

const IDLE: PayloadState = { phase: "idle", installed: false, done: 0, total: 0 };

interface PluginsState {
  /** Ids of the plugins whose contributions are loaded, in the order they were turned on. */
  enabled: string[];
  /** What each loaded plugin gives. */
  loaded: Record<string, PluginContributions>;
  /** What the app says each plugin is (empty in the browser preview). */
  info: PluginInfo[];
  /** Whether each plugin is on, as the app has it. */
  on: Record<string, boolean>;
  /** The state of each plugin's download. */
  payload: Record<string, PayloadState>;
  /** Why the last turning on or off of a plugin did not work. */
  problem: Record<string, string>;
  /** Turns a plugin on: loads it and adds what it contributes. Resolves false when it is unknown or fails to load. */
  enable(id: string, catalog?: readonly CatalogEntry[]): Promise<boolean>;
  /** Turns a plugin off and takes what it contributed away. */
  disable(id: string): void;
  /** Adds contributions directly (a plugin already in hand, such as a test's). */
  register(id: string, contributions: PluginContributions): void;
  /** Turns on every plugin the catalogue starts on. */
  enableDefaults(catalog?: readonly CatalogEntry[]): Promise<void>;
  /** Reads the list from the app: which plugins are on for the open vault, and where their downloads are. */
  sync(catalog?: readonly CatalogEntry[]): Promise<void>;
  /** Writes the choice to the app, then loads or drops the plugin; a plugin that needs a download starts it at once. */
  setEnabled(id: string, on: boolean, catalog?: readonly CatalogEntry[]): Promise<void>;
  install(id: string): Promise<void>;
  cancel(id: string): Promise<void>;
  /** Takes the downloaded program away (the person's files are never touched). */
  remove(id: string): Promise<void>;
  /** One step of a download, as the app told it. */
  heard(event: PayloadEvent): void;
}

const patch = (state: PluginsState, id: string, next: Partial<PayloadState>): Record<string, PayloadState> => ({ ...state.payload, [id]: { ...(state.payload[id] ?? IDLE), ...next } });

/** The one listener for download steps, and the backend it listens to. */
let listening: { to: PluginsBackend; stop: Promise<() => void> } | null = null;

/** How many times a plugin was turned on or off: a `sync` that began before the last click answers with the old state and is dropped. */
let clicks = 0;

export const usePlugins = create<PluginsState>()((set, get) => ({
  enabled: [],
  loaded: {},
  info: [],
  on: {},
  payload: {},
  problem: {},

  async enable(id, catalog = CATALOG) {
    if (get().loaded[id]) return true;
    const entry = catalog.find((e) => e.manifest.id === id);
    if (!entry) return false;
    try {
      get().register(id, await entry.load());
      return true;
    } catch {
      return false;
    }
  },

  disable(id) {
    if (!get().enabled.includes(id) && !get().loaded[id]) return;
    const loaded = { ...get().loaded };
    delete loaded[id];
    set({ enabled: get().enabled.filter((e) => e !== id), loaded });
  },

  register(id, contributions) {
    set({ enabled: get().enabled.includes(id) ? get().enabled : [...get().enabled, id], loaded: { ...get().loaded, [id]: contributions } });
  },

  async enableDefaults(catalog = CATALOG) {
    for (const entry of catalog) if (entry.manifest.defaultOn) await get().enable(entry.manifest.id, catalog);
  },

  async sync(catalog = CATALOG) {
    const backend = pluginsBackend();
    // The browser preview has nobody to ask: the plugins that start on are on, as for a vault that has not chosen.
    if (!backend) return get().enableDefaults(catalog);
    if (listening?.to !== backend) {
      void listening?.stop.then((stop) => stop());
      listening = { to: backend, stop: backend.onPayload((event) => get().heard(event)).catch(() => () => {}) };
    }
    const asked = clicks;
    let info: PluginInfo[];
    try {
      info = await backend.list();
    } catch {
      return;
    }
    if (clicks !== asked) return;
    set({ info, on: Object.fromEntries(info.map((p) => [p.id, p.enabled])) });
    for (const p of info) {
      if (p.enabled) await get().enable(p.id, catalog);
      else get().disable(p.id);
      if (clicks !== asked) return;
    }
    for (const p of info.filter((q) => q.payload)) {
      try {
        const s = await backend.status(p.id);
        if (clicks !== asked) return;
        set({ payload: patch(get(), p.id, { installed: s.installed, older: !s.installed && !!s.installedVersion, phase: s.busy ? "downloading" : s.installed ? "ready" : "idle", total: s.sizeBytes }) });
      } catch {
        // The card says "Needs download" until the app answers.
      }
    }
  },

  async setEnabled(id, on, catalog = CATALOG) {
    const backend = pluginsBackend();
    clicks += 1;
    set({ problem: { ...get().problem, [id]: "" } });
    if (backend) {
      try {
        await backend.setEnabled(id, on);
      } catch (err) {
        set({ problem: { ...get().problem, [id]: messageOf(err) } });
        return;
      }
    }
    set({ on: { ...get().on, [id]: on } });
    if (!on) {
      // A download that is still running is not wanted any more.
      const phase = get().payload[id]?.phase;
      if (phase === "downloading" || phase === "verifying" || phase === "installing") void get().cancel(id);
      return get().disable(id);
    }
    await get().enable(id, catalog);
    const download = get().info.find((p) => p.id === id)?.payload;
    if (backend && download && !get().payload[id]?.installed) await get().install(id);
  },

  async install(id) {
    const backend = pluginsBackend();
    const running = get().payload[id]?.phase;
    if (!backend || running === "downloading" || running === "verifying" || running === "installing") return;
    const total = get().info.find((p) => p.id === id)?.payload?.sizeBytes ?? 0;
    set({ payload: patch(get(), id, { phase: "downloading", done: 0, total, error: undefined }) });
    try {
      const done = await backend.install(id);
      const installed = done === "installed";
      set({ payload: patch(get(), id, { phase: installed ? "ready" : "cancelled", installed: installed || get().payload[id]?.installed === true, older: installed ? false : get().payload[id]?.older, error: undefined }) });
    } catch (err) {
      set({ payload: patch(get(), id, { phase: "failed", error: messageOf(err) }) });
    }
  },

  async cancel(id) {
    await pluginsBackend()?.cancel(id).catch(() => {});
  },

  async remove(id) {
    const backend = pluginsBackend();
    if (!backend) return;
    try {
      await backend.remove(id);
      set({ payload: patch(get(), id, { phase: "idle", installed: false, done: 0, error: undefined }) });
    } catch (err) {
      set({ payload: patch(get(), id, { phase: "failed", error: messageOf(err) }) });
    }
  },

  heard(event) {
    const { id, state, done, total, error } = event;
    set({ payload: patch(get(), id, { phase: state, done, total: total || get().payload[id]?.total || 0, error, ...(state === "ready" ? { installed: true, older: false } : state === "idle" ? { installed: false, older: false } : {}) }) });
  },
}));

/** Reads the registry in a component, so it draws again when a plugin comes or goes. */
export const usePluginsVersion = (): unknown => usePlugins((s) => s.loaded);
