// Rehearsals kept by the app: on this computer, in the app's data folder, not in the vault (src-tauri/src/rehearsals.rs). Outside the desktop
// app (the browser preview) the Slides package keeps them in the page's local storage.

import { type RehearsalRecord, type RehearsalStore, localRehearsals } from "@kasten-slides/react/presenter-entry";
import { invoke } from "@tauri-apps/api/core";

import { inTauri } from "../../../lib/api";
import { type StoredRun, fromStored, toStored } from "./encode";

/** The store the desktop app keeps rehearsals in; the page's local storage where there is no desktop app. */
export function rehearsalStore(): RehearsalStore {
  if (!inTauri()) return localRehearsals();
  return {
    async list(deckId): Promise<RehearsalRecord[]> {
      const runs = await invoke<StoredRun[]>("rehearsals", { deckId });
      return runs.map((run) => fromStored(deckId, run));
    },
    async save(record): Promise<RehearsalRecord[]> {
      const runs = await invoke<StoredRun[]>("add_rehearsal", { deckId: record.deckId, record: toStored(record) });
      return runs.map((run) => fromStored(record.deckId, run));
    },
  };
}
