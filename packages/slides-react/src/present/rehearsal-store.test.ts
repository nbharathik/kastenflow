import { beforeEach, describe, expect, it } from "vitest";

import { type RehearsalRecord, lastRunFor } from "./rehearsal.ts";
import { LOCAL_KEPT, localRehearsals, readRecords } from "./rehearsal-store.ts";

const record = (n: number, extra: Partial<RehearsalRecord> = {}): RehearsalRecord => ({
  deckId: "d-1",
  revision: "aaaaaaaaaaaaaaaa",
  at: 1_000 + n,
  totalMs: n * 1_000,
  slides: [{ id: "s-1", ms: n * 1_000, visits: 1, steps: [{ step: 0, ms: n * 1_000 }] }],
  ...extra,
});

/** A storage that holds what it is given, and fails when it is told to. */
class FakeStorage implements Storage {
  data = new Map<string, string>();
  failWrites: "never" | "always" | "over" = "never";
  failReads = false;
  limit = 0;
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(key: string) {
    if (this.failReads) throw new DOMException("denied", "SecurityError");
    return this.data.get(key) ?? null;
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  setItem(key: string, value: string) {
    if (this.failWrites === "always" || (this.failWrites === "over" && value.length > this.limit)) throw new DOMException("full", "QuotaExceededError");
    this.data.set(key, value);
  }
}

let storage: FakeStorage;
beforeEach(() => {
  storage = new FakeStorage();
});

describe("the rehearsals kept in the page", () => {
  it("keeps a deck's runs under its own key, oldest first, and no deck's runs are another's", async () => {
    const store = localRehearsals(storage);
    await store.save(record(1));
    await store.save(record(2));
    await store.save(record(3, { deckId: "d-2" }));
    expect((await store.list("d-1")).map((r) => r.totalMs)).toEqual([1_000, 2_000]);
    expect((await store.list("d-2")).map((r) => r.totalMs)).toEqual([3_000]);
    expect([...storage.data.keys()].sort()).toEqual(["ks-rehearsals:d-1", "ks-rehearsals:d-2"]);
    expect(await store.list("d-3")).toEqual([]);
  });

  it("answers the list after a save, and a new store reads what an earlier one kept", async () => {
    const saved = await localRehearsals(storage).save(record(1));
    expect(saved).toHaveLength(1);
    expect(await localRehearsals(storage).list("d-1")).toEqual([record(1)]);
  });

  it("is keyed by revision: the last run of this revision is the one to compare with, else the last of all", async () => {
    const store = localRehearsals(storage);
    await store.save(record(1, { revision: "1111111111111111" }));
    await store.save(record(2, { revision: "2222222222222222" }));
    await store.save(record(3, { revision: "1111111111111111" }));
    const runs = await store.list("d-1");
    expect(lastRunFor(runs, "1111111111111111")?.totalMs).toBe(3_000);
    expect(lastRunFor(runs, "2222222222222222")?.totalMs).toBe(2_000);
    expect(lastRunFor(runs, "3333333333333333")?.totalMs).toBe(3_000);
    expect(lastRunFor([], "1111111111111111")).toBeUndefined();
  });

  it("keeps the last ten and lets the older ones go", async () => {
    const store = localRehearsals(storage);
    for (let n = 1; n <= LOCAL_KEPT + 3; n++) await store.save(record(n));
    const runs = await store.list("d-1");
    expect(runs).toHaveLength(LOCAL_KEPT);
    expect(runs[0]?.totalMs).toBe(4_000);
    expect(runs.at(-1)?.totalMs).toBe((LOCAL_KEPT + 3) * 1_000);
  });

  it("goes on in memory when the storage is full, and does not throw", async () => {
    const store = localRehearsals(storage);
    await store.save(record(1));
    storage.failWrites = "always";
    await expect(store.save(record(2))).resolves.toHaveLength(2);
    expect((await store.list("d-1")).map((r) => r.totalMs)).toEqual([1_000, 2_000]);
    // The page that was open when it filled still has them; a new one has what had been written.
    expect((await localRehearsals(storage).list("d-1")).map((r) => r.totalMs)).toEqual([1_000]);
  });

  it("drops the oldest runs to make one fit when only a short list fits", async () => {
    const store = localRehearsals(storage);
    for (let n = 1; n <= 4; n++) await store.save(record(n));
    const one = JSON.stringify([record(5)]).length;
    storage.failWrites = "over";
    storage.limit = one * 2 + 10;
    const saved = await store.save(record(5));
    expect(saved.map((r) => r.totalMs)).toEqual([1_000, 2_000, 3_000, 4_000, 5_000]);
    const kept = JSON.parse(storage.data.get("ks-rehearsals:d-1") ?? "[]") as RehearsalRecord[];
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThanOrEqual(2);
    expect(kept.at(-1)?.totalMs).toBe(5_000);
  });

  it("lists nothing, and does not throw, when the storage cannot be read", async () => {
    storage.failReads = true;
    const store = localRehearsals(storage);
    expect(await store.list("d-1")).toEqual([]);
    expect(await store.save(record(1))).toHaveLength(1);
  });

  it("ignores what is not a run: text that is not JSON, and entries of the wrong shape", async () => {
    storage.data.set("ks-rehearsals:d-1", "{ nope");
    const store = localRehearsals(storage);
    expect(await store.list("d-1")).toEqual([]);
    storage.data.set("ks-rehearsals:d-1", JSON.stringify([record(1), { deckId: "d-1" }, 5, null, { ...record(2), slides: "x" }, record(3)]));
    expect((await store.list("d-1")).map((r) => r.totalMs)).toEqual([1_000, 3_000]);
    expect(readRecords("[]")).toEqual([]);
    expect(readRecords(null)).toEqual([]);
  });
});
