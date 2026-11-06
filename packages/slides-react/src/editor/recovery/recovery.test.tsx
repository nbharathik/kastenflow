import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { newDeck } from "../../test/engine.ts";
import { MemoryHost } from "../memory-host.ts";
import { EditorSession } from "../session/session.ts";
import { hashText, indexedDbJournal, memoryJournal } from "./journal.ts";
import { JOURNAL_DELAY, detect, discard, follow, keyOf, recover } from "./recovery.ts";
import { RecoveryHost } from "./RecoveryHost.tsx";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function setup(path = "decks/talk.deck") {
  const host = new MemoryHost();
  host.deckPath = path;
  const journal = memoryJournal();
  host.recovery = journal;
  const session = new EditorSession(await newDeck("Recovery", "Light"), host, { saveDelay: 60_000 });
  return { session, host, journal };
}

/** The text of the deck after `edit` was done to a deck like the one the session opened, as a crash would have left it in the journal. */
async function editedText(edit: (session: EditorSession) => void): Promise<string> {
  const { session } = await setup();
  act(() => edit(session));
  return session.core.save();
}

describe("the journal", () => {
  it("names a text the same way every time, and a different text differently", () => {
    expect(hashText("abc")).toBe(hashText("abc"));
    expect(hashText("abc")).not.toBe(hashText("abd"));
    expect(hashText("")).not.toBe(hashText(" "));
  });

  it("keeps an entry until it is cleared, and puts one aside without losing it", async () => {
    const journal = memoryJournal();
    const entry = { text: "t", time: 5, base: "b" };
    expect(await journal.read("k")).toBeNull();
    await journal.write("k", entry);
    expect(await journal.read("k")).toEqual(entry);
    await journal.keepAside("k");
    expect(await journal.read("k")).toBeNull();
    expect(await journal.readAside("k")).toEqual(entry);
    await journal.write("k", { ...entry, time: 6 });
    await journal.clear("k");
    expect(await journal.read("k")).toBeNull();
    expect(await journal.readAside("k")).toEqual(entry);
  });

  it("is none where the page has no IndexedDB", () => {
    expect(indexedDbJournal(undefined)).toBeNull();
  });
});

describe("writing", () => {
  beforeEach(() => vi.useFakeTimers());

  it("keeps the deck in the journal once edits have rested, with the name of the text they were made on", async () => {
    const { session, journal } = await setup();
    const opened = session.core.save();
    const stop = follow(session, journal);
    act(() => void session.slides.add({ layout: "blank" }));
    expect(await journal.read(keyOf(session))).toBeNull();
    await vi.advanceTimersByTimeAsync(JOURNAL_DELAY);
    const entry = await journal.read("decks/talk.deck");
    expect(entry?.text).toBe(session.core.save());
    expect(entry?.base).toBe(hashText(opened));
    stop();
  });

  it("writes once for a burst of edits, with the last of them", async () => {
    const { session, journal } = await setup();
    const stop = follow(session, journal);
    act(() => void session.slides.add({ layout: "blank" }));
    await vi.advanceTimersByTimeAsync(JOURNAL_DELAY / 2);
    act(() => void session.slides.add({ layout: "blank" }));
    await vi.advanceTimersByTimeAsync(JOURNAL_DELAY / 2);
    expect(await journal.read("decks/talk.deck")).toBeNull();
    await vi.advanceTimersByTimeAsync(JOURNAL_DELAY);
    expect((await journal.read("decks/talk.deck"))?.text).toBe(session.core.save());
    stop();
  });

  it("is emptied when the deck is saved, and writes nothing for a deck that was not changed", async () => {
    const { session, journal, host } = await setup();
    const stop = follow(session, journal);
    await vi.advanceTimersByTimeAsync(JOURNAL_DELAY * 2);
    expect(await journal.read("decks/talk.deck")).toBeNull();
    act(() => void session.slides.add({ layout: "blank" }));
    await vi.advanceTimersByTimeAsync(JOURNAL_DELAY);
    expect(await journal.read("decks/talk.deck")).not.toBeNull();
    await act(async () => {
      await session.flush();
    });
    expect(host.saves).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10);
    expect(await journal.read("decks/talk.deck")).toBeNull();
    stop();
  });

  it("stops writing when told to", async () => {
    const { session, journal } = await setup();
    const stop = follow(session, journal);
    stop();
    act(() => void session.slides.add({ layout: "blank" }));
    await vi.advanceTimersByTimeAsync(JOURNAL_DELAY * 2);
    expect(await journal.read("decks/talk.deck")).toBeNull();
  });

  it("names the deck by its id where the host does not say where it is kept", async () => {
    const { session } = await setup();
    delete (session.host as MemoryHost).deckPath;
    expect(keyOf(session)).toBe(session.deck.id);
  });
});

describe("finding what was never saved", () => {
  it("offers an entry that differs from the deck as opened, and says whether the file changed since", async () => {
    const text = await editedText((s) => void s.slides.add({ layout: "blank" }));
    const { session, journal } = await setup();
    const base = hashText(session.core.save());
    await journal.write("decks/talk.deck", { text, time: 1_700_000_000_000, base });
    const offer = await detect(session, journal);
    expect(offer?.entry.text).toBe(text);
    expect(offer?.fileChanged).toBe(false);
    await journal.write("decks/talk.deck", { text, time: 1, base: "someone-else-changed-it" });
    expect((await detect(session, journal))?.fileChanged).toBe(true);
  });

  it("offers nothing when the journal is empty, when it holds the deck as it is, or when it cannot be read", async () => {
    const { session, journal } = await setup();
    expect(await detect(session, journal)).toBeNull();
    await journal.write("decks/talk.deck", { text: session.core.save(), time: 1, base: "b" });
    expect(await detect(session, journal)).toBeNull();
    expect(await journal.read("decks/talk.deck")).toBeNull();
    await journal.write("decks/talk.deck", { text: "{ not a deck", time: 1, base: "b" });
    expect(await detect(session, journal)).toBeNull();
    expect((await journal.readAside("decks/talk.deck"))?.text).toBe("{ not a deck");
  });
});

describe("recovering and discarding", () => {
  it("brings the edits back through the engine as one step of undo, and saves them like any change", async () => {
    const text = await editedText((s) => void s.slides.add({ layout: "blank" }));
    const { session, journal, host } = await setup();
    const opened = session.core.save();
    await journal.write("decks/talk.deck", { text, time: 1, base: hashText(opened) });
    const offer = (await detect(session, journal))!;
    let done = false;
    await act(async () => {
      done = recover(session, offer);
    });
    expect(done).toBe(true);
    expect(session.deck.slides).toHaveLength(2);
    await waitFor(() => expect(host.saves.length).toBeGreaterThan(0));
    act(() => session.undo());
    expect(session.core.save()).toBe(opened);
  });

  it("refuses text that is not a deck and changes nothing", async () => {
    const { session } = await setup();
    const before = session.core.save();
    expect(recover(session, { entry: { text: "nope", time: 1, base: "b" }, fileChanged: false })).toBe(false);
    expect(session.core.save()).toBe(before);
  });

  it("keeps what was turned down aside, out of the way, and does not offer it again", async () => {
    const text = await editedText((s) => void s.slides.add({ layout: "blank" }));
    const { session, journal } = await setup();
    await journal.write("decks/talk.deck", { text, time: 9, base: "b" });
    await discard(session, journal);
    expect(await detect(session, journal)).toBeNull();
    expect((await journal.readAside("decks/talk.deck"))?.text).toBe(text);
  });
});

describe("the offer on opening", () => {
  it("asks 'Recover unsaved changes?' with a preview, and Recover applies them", async () => {
    const text = await editedText((s) => void s.slides.add({ layout: "blank" }));
    const { session, journal } = await setup();
    await journal.write("decks/talk.deck", { text, time: Date.parse("2026-11-02T09:30:00Z"), base: hashText(session.core.save()) });
    render(<RecoveryHost session={session} />);
    expect(await screen.findByRole("dialog", { name: "Recover unsaved changes?" })).toBeTruthy();
    expect(screen.getByText(/1 slide differs|1 slide differ/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Recover" }));
    await waitFor(() => expect(session.deck.slides).toHaveLength(2));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Discard keeps the edits aside and leaves the deck as it was", async () => {
    const text = await editedText((s) => void s.slides.add({ layout: "blank" }));
    const { session, journal } = await setup();
    await journal.write("decks/talk.deck", { text, time: 1, base: hashText(session.core.save()) });
    render(<RecoveryHost session={session} />);
    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(session.deck.slides).toHaveLength(1);
    expect((await journal.readAside("decks/talk.deck"))?.text).toBe(text);
    expect(await journal.read("decks/talk.deck")).toBeNull();
  });

  it("warns when the saved deck changed since the edits were made", async () => {
    const text = await editedText((s) => void s.slides.add({ layout: "blank" }));
    const { session, journal } = await setup();
    await journal.write("decks/talk.deck", { text, time: 1, base: "an older file" });
    render(<RecoveryHost session={session} />);
    expect(await screen.findByText(/saved deck has changed since then/)).toBeTruthy();
  });

  it("closing it for now leaves the edits where they are, and shows nothing for a deck with no journal", async () => {
    const text = await editedText((s) => void s.slides.add({ layout: "blank" }));
    const { session, journal } = await setup();
    await journal.write("decks/talk.deck", { text, time: 1, base: hashText(session.core.save()) });
    render(<RecoveryHost session={session} />);
    await screen.findByRole("dialog");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect((await journal.read("decks/talk.deck"))?.text).toBe(text);
    cleanup();
    const other = await setup("decks/other.deck");
    const view = render(<RecoveryHost session={other.session} />);
    await Promise.resolve();
    expect(view.container.innerHTML).toBe("");
  });
});
