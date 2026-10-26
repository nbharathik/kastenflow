import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryVault } from "./preview/memory-vault";
import { SETTLE_MS, useNoteStats } from "./note-stats";
import { useWorkspace } from "./store";
import { noteAt } from "./tree";

const PATH = "library/plan.md";

beforeEach(async () => {
  vi.useFakeTimers();
  await useWorkspace.getState().connect({ client: new MemoryVault({ [PATH]: "---\ntitle: Plan\n---\nMine.\n" }) });
});
afterEach(() => {
  vi.useRealTimers();
  useWorkspace.setState({ client: null });
});

describe("a save's counts", () => {
  it("leave the list as it is, show in the stats at once and reach the list when typing pauses", () => {
    const list = useWorkspace.getState().notes;
    const meta = noteAt(list, PATH)!;
    useWorkspace.getState().noteChanged({ ...meta, words: 9, excerpt: "Mine, and more", modified: meta.modified + 5 });
    expect(useWorkspace.getState().notes).toBe(list);
    expect(useNoteStats.getState().of[PATH]?.words).toBe(9);

    vi.advanceTimersByTime(SETTLE_MS - 1);
    expect(useWorkspace.getState().notes).toBe(list);
    useWorkspace.getState().noteChanged({ ...meta, words: 12, excerpt: "Mine, and more again", modified: meta.modified + 8 });
    vi.advanceTimersByTime(SETTLE_MS - 1);
    expect(useWorkspace.getState().notes).toBe(list);

    vi.advanceTimersByTime(1);
    const settled = noteAt(useWorkspace.getState().notes, PATH)!;
    expect(useWorkspace.getState().notes).not.toBe(list);
    expect([settled.words, settled.excerpt, settled.modified]).toEqual([12, "Mine, and more again", meta.modified + 8]);
    expect(useNoteStats.getState().of).toEqual({});
  });

  it("do not wait when the title changes with them", () => {
    const meta = noteAt(useWorkspace.getState().notes, PATH)!;
    useWorkspace.getState().noteChanged({ ...meta, words: 3 });
    useWorkspace.getState().noteChanged({ ...meta, words: 4, title: "Plan B" });
    expect(noteAt(useWorkspace.getState().notes, PATH)).toMatchObject({ title: "Plan B", words: 4 });
    expect(useNoteStats.getState().of).toEqual({});
  });
});
