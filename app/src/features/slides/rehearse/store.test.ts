import type { RehearsalRecord } from "@kasten-slides/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const tauri = vi.hoisted(() => ({ on: true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock("../../../lib/api", () => ({ inTauri: () => tauri.on }));

import { fromStored, toStored } from "./encode";
import { rehearsalStore } from "./store";

const record: RehearsalRecord = {
  deckId: "d-4b1e0x9a",
  revision: "00ff00ff00ff00ff",
  at: 1_790_000_000_000,
  totalMs: 31_000,
  targetMs: 600_000,
  slides: [
    { id: "s-aaaaaaaa", ms: 12_000, visits: 2, steps: [{ step: 0, ms: 5_000 }, { step: 1, ms: 7_000 }] },
    { id: "s-bbbbbbbb", ms: 19_000, visits: 1, steps: [{ step: 0, ms: 19_000 }] },
  ],
};

beforeEach(() => {
  invoke.mockReset();
  tauri.on = true;
  localStorage.clear();
});

describe("a run as the app's store keeps it", () => {
  it("writes the revision and the steps as entries no slide has an id of, and the slides' own times beside them", () => {
    const stored = toStored(record);
    expect(stored).toMatchObject({ at: 1_790_000_000_000, totalMs: 31_000, targetMs: 600_000 });
    expect(stored.slides).toEqual([
      { id: "revision:00ff00ff00ff00ff", ms: 0 },
      { id: "s-aaaaaaaa", ms: 12_000 },
      { id: "s-aaaaaaaa#0", ms: 5_000 },
      { id: "s-aaaaaaaa#1", ms: 7_000 },
      { id: "s-bbbbbbbb", ms: 19_000 },
      { id: "s-bbbbbbbb#0", ms: 19_000 },
    ]);
  });

  it("reads them back: the revision, the slides in their order and the steps of each", () => {
    const back = fromStored(record.deckId, toStored(record));
    expect(back.revision).toBe(record.revision);
    expect(back.slides.map((s) => [s.id, s.ms, s.steps.map((step) => [step.step, step.ms])])).toEqual([
      ["s-aaaaaaaa", 12_000, [[0, 5_000], [1, 7_000]]],
      ["s-bbbbbbbb", 19_000, [[0, 19_000]]],
    ]);
    expect(back).toMatchObject({ deckId: "d-4b1e0x9a", at: 1_790_000_000_000, totalMs: 31_000, targetMs: 600_000 });
  });

  it("reads a run kept without a revision as one of no known version, and a time written as text", () => {
    const old = fromStored("d-1", { at: "2026-10-10T09:00:00Z", totalMs: 5_000, slides: [{ id: "s-1", ms: 5_000 }] });
    expect(old.revision).toBe("");
    expect(old.at).toBe(Date.parse("2026-10-10T09:00:00Z"));
    expect(old.slides).toEqual([{ id: "s-1", ms: 5_000, visits: 1, steps: [] }]);
  });
});

describe("the desktop app's store", () => {
  it("lists a deck's runs from the app's data folder, oldest first, with the deck's id", async () => {
    invoke.mockResolvedValueOnce([toStored(record)]);
    const runs = await rehearsalStore().list("d-4b1e0x9a");
    expect(invoke).toHaveBeenCalledWith("rehearsals", { deckId: "d-4b1e0x9a" });
    expect(runs).toEqual([{ ...record, slides: record.slides.map((s) => ({ ...s, visits: 1 })) }]);
  });

  it("keeps a run and answers the deck's runs as they are now", async () => {
    invoke.mockResolvedValueOnce([toStored(record)]);
    const runs = await rehearsalStore().save(record);
    expect(invoke).toHaveBeenCalledWith("add_rehearsal", { deckId: "d-4b1e0x9a", record: toStored(record) });
    expect(runs).toHaveLength(1);
  });

  it("says why a run could not be kept", async () => {
    invoke.mockRejectedValueOnce("The rehearsals could not be kept: disk full");
    await expect(rehearsalStore().save(record)).rejects.toBe("The rehearsals could not be kept: disk full");
  });
});

describe("outside the desktop app", () => {
  it("keeps them in the page's own storage and calls nothing", async () => {
    tauri.on = false;
    const store = rehearsalStore();
    await store.save(record);
    expect((await store.list(record.deckId)).map((r) => r.totalMs)).toEqual([31_000]);
    expect(invoke).not.toHaveBeenCalled();
  });
});
