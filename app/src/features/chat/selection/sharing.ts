// Whether a connected client may be reading the person's selection. The app
// says so (a client has asked; two minutes after its last ask, it stops), and
// the chat panel shows "Shared with a connected client" for as long as it holds.
// This is all that is loaded at start-up; what is told to the app, and the chat
// code it reads, load only once a client has asked (share.ts).

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { create } from "zustand";

import { inTauri } from "../../../lib/api";
import type { Telling } from "./share";

/** The event the app tells the window by, when a client asks and when it stops. */
export const WATCH_EVENT = "kasten://selection-watch";

/** Whether a client may be reading the selection now. */
export const useSharing = create<{ shared: boolean }>(() => ({ shared: false }));

/** Listens for the app's word that a client asked, and tells what is selected for as long as it stays so. */
export function useSelectionShare(): void {
  useEffect(() => {
    if (!inTauri()) return;
    let gone = false;
    let telling: Telling | null = null;
    let unlisten: (() => void) | undefined;
    let starting = false;
    const on = async () => {
      useSharing.setState({ shared: true });
      // Asked again while it goes on: what is selected is told again, so the ask is not kept waiting.
      if (telling) return telling.again();
      if (starting) return;
      starting = true;
      const { begin } = await import("./share");
      starting = false;
      // Told to stop, or the window went, while the code was loading.
      if (gone || !useSharing.getState().shared) return;
      telling = begin();
    };
    const off = () => {
      telling?.stop();
      telling = null;
      useSharing.setState({ shared: false });
    };
    void listen<{ on: boolean }>(WATCH_EVENT, (event) => (event.payload.on ? void on() : off())).then((stop) => (gone ? stop() : (unlisten = stop)));
    // A window that opened while a client was reading learns of it.
    void invoke<boolean>("selection_watching")
      .then((watching) => {
        if (watching && !gone) void on();
      })
      .catch(() => {});
    return () => {
      gone = true;
      unlisten?.();
      off();
    };
  }, []);
}
