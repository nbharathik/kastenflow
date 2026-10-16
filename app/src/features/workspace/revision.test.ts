// The window's copy of the vault's change counters: newer replaces older, a
// stale event is ignored, and a stamp moves only when one of its areas does.

import { afterEach, describe, expect, it } from "vitest";

import { MemoryVault } from "./preview/memory-vault";
import { NO_REVISION, applyRevision, loadRevision, resetRevision, stampOf, useRevision } from "./revision";

const at = (over: Partial<typeof NO_REVISION>) => ({ ...NO_REVISION, epoch: 7, ...over });

afterEach(resetRevision);

describe("the revision store", () => {
  it("keeps the newest counters of an opening and drops a late, older event", () => {
    applyRevision(at({ all: 3, notes: 3 }));
    applyRevision(at({ all: 2, notes: 2 }));
    expect(useRevision.getState().revision.all).toBe(3);
    applyRevision(at({ all: 4, notes: 3, boards: 1 }));
    expect(useRevision.getState().revision.boards).toBe(1);
  });

  it("takes a different opening of the vault whatever its counts", () => {
    applyRevision(at({ all: 9 }));
    applyRevision({ ...at({ all: 1 }), epoch: 8 });
    expect(useRevision.getState().revision).toMatchObject({ epoch: 8, all: 1 });
  });

  it("makes a stamp that moves only with the areas it names", () => {
    const before = at({ all: 1, notes: 1 });
    const board = at({ all: 2, notes: 1, boards: 1 });
    expect(stampOf(board, ["notes"])).toBe(stampOf(before, ["notes"]));
    expect(stampOf(board, ["notes", "boards"])).not.toBe(stampOf(before, ["notes", "boards"]));
    expect(stampOf({ ...board, epoch: 9 }, ["notes"])).not.toBe(stampOf(board, ["notes"]));
  });

  it("reads the counters from the client", async () => {
    const vault = new MemoryVault({ "a.md": "---\ntitle: A\n---\n" });
    loadRevision(vault);
    await vault.revision();
    await Promise.resolve();
    expect(useRevision.getState().revision.epoch).toBeGreaterThan(0);
  });
});
