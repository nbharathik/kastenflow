// "Run smart pages": the switch that stops every smart page at once. It lives
// in the app (a window command keeps it, and ends every frame when it goes
// off); this holds what the window last heard so each page can draw itself
// without asking again.

import { useEffect } from "react";
import { create } from "zustand";

import { tauriSmartBackend, type SmartBackend } from "./backend";

interface RunState {
  on: boolean;
  /** The app has been asked at least once. */
  known: boolean;
}

export const useRunSwitch = create<RunState>()(() => ({ on: true, known: false }));

let asking: Promise<void> | null = null;

/** Reads the switch from the app, once; a failure leaves it on (the app also refuses what it must). */
export function loadRunSwitch(backend: SmartBackend = tauriSmartBackend): Promise<void> {
  asking ??= backend.runEnabled().then(
    (on) => useRunSwitch.setState({ on, known: true }),
    () => useRunSwitch.setState({ known: true }),
  );
  return asking;
}

/** Turns smart pages on or off. Resolves false, and leaves the switch as it was, when the app refused. */
export async function setRunSwitch(on: boolean, backend: SmartBackend = tauriSmartBackend): Promise<boolean> {
  try {
    await backend.setRunEnabled(on);
    useRunSwitch.setState({ on, known: true });
    return true;
  } catch {
    return false;
  }
}

/** Forgets what was heard (tests, and a vault switch). */
export function forgetRunSwitch(): void {
  asking = null;
  useRunSwitch.setState({ on: true, known: false });
}

/** Whether smart pages run; asks the app once, the first time anything needs to know (`active` false asks nothing: a page that is not a smart page). */
export function useSmartRunning(backend: SmartBackend = tauriSmartBackend, active = true): { on: boolean; known: boolean } {
  const state = useRunSwitch();
  useEffect(() => {
    if (active && !state.known) void loadRunSwitch(backend);
  }, [active, state.known, backend]);
  return state;
}
