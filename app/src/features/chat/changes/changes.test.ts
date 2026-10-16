import { beforeEach, describe, expect, it } from "vitest";

import { MemoryVault } from "../../workspace/preview/memory-vault";
import { useWorkspace } from "../../workspace/store";
import { flushStream, useChat } from "../store";
import { CLAUDE, resetChat, scriptedChat, type Scripted } from "../test-kit";
import type { ChangesView, FileChange } from "../types";
import { applyChanges, changesWords, discardChanges, loadChanges, ordered, recalcChanges, staleOf } from "./changes";

let chat: Scripted;
const store = () => useChat.getState();

const file = (path: string, kind: FileChange["kind"], rest: Partial<FileChange> = {}): FileChange => ({
  path,
  kind,
  title: path.replace(/^.*\//, "").replace(/\.\w+$/, ""),
  new: false,
  before: "a\n",
  after: "b\n",
  diff: "",
  stale: false,
  ...rest,
});

const VIEW: ChangesView = {
  id: "set-1",
  files: [file("library/welcome.md", "note"), file("library/trip.md", "note", { new: true, before: null })],
  pictures: [{ path: "assets/figure.png", name: "figure.png", bytes: 2048 }],
  steps: [{ summary: "Add to “Welcome”", paths: ["library/welcome.md"] }],
};

/** A thread in the middle of a turn that has staged `count` changes. */
async function staged(count = 3) {
  const id = store().start();
  await store().send(id, "Plan my trip");
  chat.emit({ chat: id, turn: "turn-1", kind: "tool", tool: { id: "k1", name: "append", input: {} } });
  chat.emit({ chat: id, turn: "turn-1", kind: "toolResult", result: { id: "k1", ok: true, summary: "Added to “Welcome”", paths: ["library/welcome.md"], staged: true } });
  chat.emit({ chat: id, turn: "turn-1", kind: "changes", changes: { id: "set-1", count, paths: ["library/welcome.md"] } });
  chat.emit({ chat: id, turn: "turn-1", kind: "done" });
  return id;
}

beforeEach(async () => {
  localStorage.clear();
  chat = scriptedChat([CLAUDE]);
  chat.view = VIEW;
  resetChat(chat);
  await useWorkspace.getState().connect({ client: new MemoryVault({}) });
  await store().loadProviders();
});

describe("staged changes in a thread", () => {
  it("takes the count from the changes events, and a staged result wrote nothing", async () => {
    const id = await staged(3);
    flushStream();
    const thread = store().threads[id]!;
    expect(thread.changes).toEqual({ id: "set-1", count: 3, paths: ["library/welcome.md"] });
    // The tool row says it was staged; the thread did not change the vault.
    expect(thread.changed).toBe(false);
    expect(thread.messages.at(-1)).toMatchObject({ parts: [{ kind: "tool", result: { staged: true } }] });
    // Nothing waiting any more.
    store().setChanges(id, undefined);
    expect(store().threads[id]!.changes).toBeUndefined();
  });

  it("sends writes: direct only for a thread that was switched to write directly", async () => {
    const id = store().start();
    await store().send(id, "First");
    chat.emit({ chat: id, turn: "turn-1", kind: "done" });
    store().setDirect(id, true);
    await store().send(id, "Second");
    expect(chat.requests.map((r) => r.writes)).toEqual([undefined, "direct"]);
    chat.emit({ chat: id, turn: "turn-2", kind: "done" });
    store().setDirect(id, false);
    await store().send(id, "Third");
    expect(chat.requests.at(-1)!.writes).toBeUndefined();
  });

  it("keeps a thread that has changes waiting, and says why", async () => {
    const id = await staged();
    await expect(store().discard(id)).resolves.toBe(false);
    expect(store().threads[id]).toBeDefined();
    expect(chat.resets).toEqual([]);
    store().setChanges(id, undefined);
    await expect(store().discard(id)).resolves.toBe(true);
    expect(chat.resets).toEqual([id]);
  });
});

describe("looking at, applying and discarding", () => {
  it("reads what is staged and keeps the bar's count in step", async () => {
    const id = await staged(9);
    const view = await loadChanges(id);
    expect(view).toBe(VIEW);
    // Two files and a picture, whatever the last event said.
    expect(store().threads[id]!.changes).toEqual({ id: "set-1", count: 3, paths: ["library/welcome.md", "library/trip.md", "assets/figure.png"] });
    chat.view = { id: "set-2", files: [], pictures: [], steps: [] };
    await loadChanges(id);
    expect(store().threads[id]!.changes).toBeUndefined();
  });

  it("applies the staged changes: the thread has changed the vault and nothing waits", async () => {
    const id = await staged();
    chat.applyResult = { status: "applied", commit: "c0ffee", paths: ["library/welcome.md", "library/trip.md"] };
    const done = await applyChanges(id);
    expect(done).toEqual({ ok: true, value: chat.applyResult });
    expect(chat.applied).toEqual([id]);
    const thread = store().threads[id]!;
    expect(thread.changes).toBeUndefined();
    expect(thread.changed).toBe(true);
    expect(thread.undone).toBe(false);
  });

  it("keeps everything staged when the vault moved on, and plans it again on request", async () => {
    const id = await staged();
    chat.applyResult = { status: "stale", files: ["library/welcome.md"] };
    const stale = await applyChanges(id);
    expect(stale).toEqual({ ok: true, value: { status: "stale", files: ["library/welcome.md"] } });
    expect(store().threads[id]!.changes?.count).toBe(3);
    expect(store().threads[id]!.changed).toBe(false);
    chat.recalculated = { dropped: [{ summary: "Replace “Method”", why: "No heading “Method” in this note" }] };
    const again = await recalcChanges(id);
    expect(again).toEqual({ ok: true, value: chat.recalculated });
    expect(chat.recalcs).toEqual([id]);
  });

  it("does not apply while the chat is still answering", async () => {
    const id = store().start();
    await store().send(id, "Go on");
    const done = await applyChanges(id);
    expect(done).toEqual({ ok: false, error: "Wait for the answer to finish" });
    expect(chat.applied).toEqual([]);
  });

  it("says why an apply failed and leaves the bar as it was", async () => {
    const id = await staged();
    chat.applyChanges = async () => {
      throw new Error("“Welcome” is locked: read-only for agents");
    };
    expect(await applyChanges(id)).toEqual({ ok: false, error: "“Welcome” is locked: read-only for agents" });
    expect(store().threads[id]!.changes?.count).toBe(3);
  });

  it("throws the staged changes away", async () => {
    const id = await staged();
    expect(await discardChanges(id)).toEqual({ ok: true, value: null });
    expect(chat.discarded).toEqual([id]);
    expect(store().threads[id]!.changes).toBeUndefined();
    expect(store().threads[id]!.changed).toBe(false);
  });
});

describe("the words and the order", () => {
  it("counts changes", () => {
    expect(changesWords(1)).toBe("1 change");
    expect(changesWords(4)).toBe("4 changes");
  });

  it("lists notes, then decks, boards and diagrams, new files first", () => {
    const files = [file("a.diagram", "diagram"), file("b.canvas", "board"), file("c.deck", "deck"), file("d.md", "note", { title: "D" }), file("e.md", "note", { title: "A", new: true })];
    expect(ordered(files).map((f) => f.path)).toEqual(["e.md", "d.md", "c.deck", "b.canvas", "a.diagram"]);
  });

  it("picks out the files the vault changed since", () => {
    const view: ChangesView = { ...VIEW, files: [file("a.md", "note", { stale: true }), file("b.md", "note")] };
    expect(staleOf(view).map((f) => f.path)).toEqual(["a.md"]);
  });
});
