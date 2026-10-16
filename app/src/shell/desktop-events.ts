// What the desktop app's other parts tell the main window: the quick
// capture window saved something, or the tray asked for Get latest.

import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";

import { runGetLatest } from "../features/backup/latest";
import { useWorkspace } from "../features/workspace/store";
import { inTauri } from "../lib/api";

interface Captured {
  path: string;
  title: string;
  place: string;
}

/** Shows what was captured, with a way to open it. */
export function captured(item: Captured): void {
  const { filesChanged, toast, openPath } = useWorkspace.getState();
  void filesChanged([item.path]);
  toast(`Captured to ${item.place}`, { label: "Open", run: () => openPath(item.path) });
}

export function useDesktopEvents(): void {
  useEffect(() => {
    if (!inTauri()) return;
    const stops = [
      listen<Captured>("kasten://captured", (e) => captured(e.payload)),
      listen("kasten://get-latest", () => void runGetLatest()),
      // A paper the browser extension found: the form to check it opens (it loads only now).
      listen("kasten://paper-draft", (e) => void import("../features/references/from-extension").then((m) => m.paperFromExtension(e.payload))),
    ];
    return () => stops.forEach((stop) => void stop.then((fn) => fn(), () => {}));
  }, []);
}
