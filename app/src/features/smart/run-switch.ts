// Whether smart pages run, as the window last heard from the app. They are a
// plugin (Settings → Plugins) that is off until a person turns it on, for each
// vault, and a project can say its own on or off; so the answer is for a page:
// its project's choice, else the vault's. The app enforces it on every frame
// (nothing is served or answered for a page it is off for); this holds what
// the window last heard so each page can draw itself without asking again.

import { useEffect } from "react";
import { create } from "zustand";

import { usePlugins } from "../../plugins/registry";
import { tauriSmartBackend, type SmartBackend } from "./backend";

interface RunState {
  /** The vault's plugin (no page asked about). Off until a person turns it on. */
  on: boolean;
  /** The app has been asked at least once. */
  known: boolean;
  /** Whether smart pages run for a page, by its path, as last heard. */
  pages: Record<string, boolean>;
}

export const useRunSwitch = create<RunState>()(() => ({ on: false, known: false, pages: {} }));

/** The questions in flight, by page path ("" for the vault). */
const asking = new Map<string, Promise<void>>();

/** Reads the answer from the app, once for the vault or for each page; a failure leaves it off (the app refuses what it must anyway). */
export function loadRunSwitch(backend: SmartBackend = tauriSmartBackend, page?: string): Promise<void> {
  const key = page ?? "";
  let pending = asking.get(key);
  if (!pending) {
    pending = backend.runEnabled(page).then(
      (on) => useRunSwitch.setState((s) => (page === undefined ? { on, known: true } : { pages: { ...s.pages, [page]: on } })),
      () => useRunSwitch.setState((s) => (page === undefined ? { known: true } : { pages: { ...s.pages, [page]: false } })),
    );
    asking.set(key, pending);
  }
  return pending;
}

/** Turns the Smart pages plugin on or off for the vault. Resolves false, and leaves the switch as it was, when the app refused. */
export async function setRunSwitch(on: boolean, backend: SmartBackend = tauriSmartBackend): Promise<boolean> {
  try {
    await backend.setRunEnabled(on);
  } catch {
    return false;
  }
  asking.clear();
  useRunSwitch.setState({ on, known: true, pages: {} });
  // Settings → Plugins and the menus read the same switch.
  usePlugins.setState((s) => ({ on: { ...s.on, smart: on } }));
  return true;
}

/** Forgets the answers for pages: a project's choice changed, so each page asks again. */
export function forgetPageAnswers(): void {
  for (const key of [...asking.keys()]) if (key !== "") asking.delete(key);
  useRunSwitch.setState({ pages: {} });
}

/** Forgets what was heard (tests, and a vault switch). */
export function forgetRunSwitch(): void {
  asking.clear();
  useRunSwitch.setState({ on: false, known: false, pages: {} });
}

/** Whether smart pages run for `page` (the vault's plugin when no page is given); asks the app once, the first time anything needs to know (`active` false asks nothing: a page that is not a smart page). */
export function useSmartRunning(backend: SmartBackend = tauriSmartBackend, active = true, page?: string): { on: boolean; known: boolean } {
  const state = useRunSwitch();
  const known = page === undefined ? state.known : page in state.pages;
  const on = page === undefined ? state.on : (state.pages[page] ?? false);
  useEffect(() => {
    if (active && !known) void loadRunSwitch(backend, page);
  }, [active, known, backend, page]);
  return { on, known };
}
