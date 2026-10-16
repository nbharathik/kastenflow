// Where a deck's rehearsals are kept. A host that has a better place (Kasten keeps them in the app's data folder, not in the vault)
// gives a `RehearsalStore`; without one they are kept in the page's local storage, the last ten for each deck, and a storage that is
// full or refuses is not an error: the runs are kept in memory for as long as the page lives.

import type { RehearsalRecord } from "./rehearsal.ts";

/** What a host keeps rehearsals with. Runs are listed oldest first. */
export interface RehearsalStore {
  /** The runs kept for a deck. */
  list(deckId: string): Promise<RehearsalRecord[]>;
  /** Keeps a run (of the deck named in it); resolves to the deck's runs as they are now. */
  save(record: RehearsalRecord): Promise<RehearsalRecord[]>;
}

/** How many runs of a deck the local storage keeps. */
export const LOCAL_KEPT = 10;

const KEY = "ks-rehearsals:";

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function isRecord(value: unknown): value is RehearsalRecord {
  if (typeof value !== "object" || value === null) return false;
  const run = value as Record<string, unknown>;
  return (
    typeof run.deckId === "string" &&
    typeof run.revision === "string" &&
    isNumber(run.at) &&
    isNumber(run.totalMs) &&
    Array.isArray(run.slides) &&
    run.slides.every((slide) => typeof slide === "object" && slide !== null && typeof (slide as { id?: unknown }).id === "string" && isNumber((slide as { ms?: unknown }).ms))
  );
}

/** The runs in a stored text; what is not a run is left out, and text that is not a list is no runs. */
export function readRecords(text: string | null): RehearsalRecord[] {
  if (text === null) return [];
  try {
    const found: unknown = JSON.parse(text);
    return Array.isArray(found) ? found.filter(isRecord) : [];
  } catch {
    return [];
  }
}

/** A store that keeps the last ten runs of each deck in `storage` (the page's local storage when left out). */
export function localRehearsals(storage?: Storage): RehearsalStore {
  const memory = new Map<string, RehearsalRecord[]>();
  const place = (): Storage | null => {
    try {
      return storage ?? localStorage;
    } catch {
      return null;
    }
  };
  /** What the storage holds; nothing when it cannot be read. */
  const stored = (deckId: string): RehearsalRecord[] => {
    try {
      const where = place();
      return where ? readRecords(where.getItem(KEY + deckId)) : [];
    } catch {
      return [];
    }
  };
  /** What this page knows: the storage's runs, or more when a save could not be written in full. */
  const known = (deckId: string): RehearsalRecord[] => {
    const written = stored(deckId);
    const held = memory.get(deckId) ?? [];
    return held.length > written.length ? held : written;
  };
  return {
    async list(deckId) {
      return known(deckId);
    },
    async save(record) {
      const deckId = record.deckId;
      const runs = [...known(deckId), record].slice(-LOCAL_KEPT);
      memory.set(deckId, runs);
      // Fewer and fewer of the older runs until it fits; if not even the new one does, it lives in memory only.
      const where = place();
      for (let keep = runs.length; where && keep >= 1; keep = keep > 2 ? Math.floor(keep / 2) : keep - 1) {
        try {
          where.setItem(KEY + deckId, JSON.stringify(runs.slice(-keep)));
          break;
        } catch {
          // Full, or refused: try with fewer.
        }
      }
      return [...runs];
    },
  };
}
