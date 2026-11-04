// Typing is never written over a change made elsewhere, and typing whose
// file went away is kept as a page of its own instead of tried forever.

import { afterEach, describe, expect, it, vi } from "vitest";

import { MemoryVault } from "../preview/memory-vault";
import { PageSession, RETRY_MS, type SessionEvents } from "./page-session";

const PAGE = "---\nid: 01K5Y2WE1C0MEPAGE000000001\ntitle: Notes\n---\nFirst line\n";
const NOW = Date.UTC(2026, 8, 24, 8, 0, 0);

function setup() {
  const vault = new MemoryVault({ "library/notes.md": PAGE }, undefined, () => NOW);
  const events = { onState: vi.fn(), onNote: vi.fn(), onRenamed: vi.fn(), onConflict: vi.fn(), onMerged: vi.fn(), onError: vi.fn(), onRecovered: vi.fn(), onRecheck: vi.fn() } satisfies SessionEvents;
  return { vault, events, open: async () => new PageSession(vault, "library/notes.md", await vault.read("library/notes.md"), events, 10_000) };
}

afterEach(() => vi.useRealTimers());

describe("PageSession keeps every version", () => {
  it("never writes typing done during a conflicting save over the change made elsewhere", async () => {
    const { vault, events, open } = setup();
    const session = await open();
    await vault.saveBody("library/notes.md", "Changed elsewhere\n", (await vault.read("library/notes.md")).hash);
    const save = vault.saveBody.bind(vault);
    vi.spyOn(vault, "saveBody").mockImplementationOnce(async (...args) => {
      // Typed while the first save was on its way.
      session.editBody("Mine, and more\n");
      return save(...args);
    });
    session.editBody("Mine\n");
    await session.flush();
    expect(events.onConflict).toHaveBeenCalledTimes(1);
    // The page reloads next, which closes this session and writes what waits.
    await session.close();
    expect((await vault.read("library/notes.md")).text).toContain("Changed elsewhere\n");
    const copies = (await vault.list()).filter((n) => n.path.includes("(conflict"));
    const texts = await Promise.all(copies.map(async (n) => (await vault.read(n.path)).text));
    expect(texts.some((t) => t.includes("Mine, and more\n"))).toBe(true);
  });

  it("does not write over a change made elsewhere that a header write brought in", async () => {
    const { vault, events, open } = setup();
    const session = await open();
    await vault.saveBody("library/notes.md", "Theirs\n", (await vault.read("library/notes.md")).hash);
    session.editHeader("icon", "🚀");
    await session.flush();
    session.editBody("First line\nmine\n");
    await session.flush();
    await session.close();
    // Their text survives in the page, or both edits were kept, or a copy was made.
    expect((await vault.read("library/notes.md")).text).toContain("Theirs");
    expect(events.onMerged.mock.calls.length + events.onConflict.mock.calls.length).toBeGreaterThan(0);
  });

  it("does not write over a change made elsewhere that a rename brought in", async () => {
    const { vault, events, open } = setup();
    const session = await open();
    await vault.saveBody("library/notes.md", "Theirs\n", (await vault.read("library/notes.md")).hash);
    session.rename("Other name");
    await session.flush();
    session.editBody("First line\nmine\n");
    await session.flush();
    await session.close();
    expect((await vault.read(session.path)).text).toContain("Theirs");
    expect(events.onMerged.mock.calls.length + events.onConflict.mock.calls.length).toBeGreaterThan(0);
  });

  it("asks the page to look at the disk again when a header write shows a change made elsewhere", async () => {
    const { vault, events, open } = setup();
    const session = await open();
    await vault.saveBody("library/notes.md", "Theirs\n", (await vault.read("library/notes.md")).hash);
    session.editHeader("icon", "🚀");
    await session.flush();
    expect(events.onRecheck).toHaveBeenCalledTimes(1);
  });

  it("does not ask the page to look again after a header write that found nothing new", async () => {
    const { events, open } = setup();
    const session = await open();
    session.editHeader("icon", "🚀");
    await session.flush();
    expect(events.onRecheck).not.toHaveBeenCalled();
  });

  it("looks at the disk again once saving ends, when a change on disk was seen while it was busy", async () => {
    const { events, open } = setup();
    const session = await open();
    session.editBody("First line\nmine\n");
    session.recheckWhenIdle();
    expect(events.onRecheck).not.toHaveBeenCalled();
    await session.flush();
    expect(events.onRecheck).toHaveBeenCalledTimes(1);
  });

  it("writes typing undone to the saved text while a save is in flight", async () => {
    const { vault, events, open } = setup();
    const session = await open();
    const save = vault.saveBody.bind(vault);
    vi.spyOn(vault, "saveBody").mockImplementationOnce(async (...args) => {
      // Undone back to the text on disk while the first save is on its way.
      session.editBody("First line\n");
      return save(...args);
    });
    session.editBody("First line\nB\n");
    await session.flush();
    expect(events.onState).toHaveBeenLastCalledWith("edited");
    await session.flush();
    expect((await vault.read("library/notes.md")).text).toContain("First line\n");
    expect((await vault.read("library/notes.md")).text).not.toContain("B\n");
    expect(events.onState).toHaveBeenLastCalledWith("saved");
  });

  it("keeps typing whose file went away as a page of its own, and stops trying", async () => {
    vi.useFakeTimers();
    const { vault, events, open } = setup();
    const session = await open();
    await vault.trash("library/notes.md");
    session.editBody("Typed after it went\n");
    await session.flush();
    expect(events.onRecovered).toHaveBeenCalledWith(expect.objectContaining({ meta: expect.objectContaining({ title: "Notes (recovered)" }) }), "Notes");
    const kept = (await vault.list()).find((n) => n.title === "Notes (recovered)")!;
    expect((await vault.read(kept.path)).text).toContain("Typed after it went\n");
    expect(session.busy).toBe(false);
    await vi.advanceTimersByTimeAsync(RETRY_MS.at(-1)! * 2);
    expect(events.onError).not.toHaveBeenCalled();
    expect((await vault.list()).filter((n) => n.title.startsWith("Notes (recovered)"))).toHaveLength(1);
  });

  it("says when typing waits and when it is written, and keeps saying it while saves fail", async () => {
    vi.useFakeTimers();
    const { vault, events, open } = setup();
    const onUnsaved = vi.fn();
    const session = new PageSession(vault, "library/notes.md", await vault.read("library/notes.md"), { ...events, onUnsaved }, 10_000);
    const base = (await vault.read("library/notes.md")).hash;
    session.editBody("Typed\n");
    expect(onUnsaved).toHaveBeenLastCalledWith("Typed\n", base);
    vi.spyOn(vault, "saveBody").mockRejectedValueOnce(new Error("The disk is full"));
    await session.flush();
    expect(onUnsaved).toHaveBeenLastCalledWith("Typed\n", base);
    expect(events.onError).toHaveBeenCalledWith("The disk is full");
    await vi.advanceTimersByTimeAsync(RETRY_MS[0]!);
    expect(onUnsaved).toHaveBeenLastCalledWith(null, (await vault.read("library/notes.md")).hash);
    expect((await vault.read("library/notes.md")).text).toContain("Typed\n");
    void open;
  });

  it("keeps trying, and keeps the typing, when the note can't be read for another reason", async () => {
    vi.useFakeTimers();
    const { vault, events, open } = setup();
    const session = await open();
    vi.spyOn(vault, "saveBody").mockRejectedValueOnce(new Error("The vault is locked by another program"));
    vi.spyOn(vault, "read").mockRejectedValueOnce(new Error("The vault is locked by another program"));
    session.editBody("Typed while locked\n");
    await session.flush();
    expect(events.onRecovered).not.toHaveBeenCalled();
    expect(session.busy).toBe(true);
    await vi.advanceTimersByTimeAsync(RETRY_MS[0]!);
    expect((await vault.read("library/notes.md")).text).toContain("Typed while locked\n");
    expect((await vault.list()).some((n) => n.title.includes("(recovered)"))).toBe(false);
  });
});
