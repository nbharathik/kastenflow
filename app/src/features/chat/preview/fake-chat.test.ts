import { describe, expect, it } from "vitest";

import { MemoryVault } from "../../workspace/preview/memory-vault";
import type { ChatEvent } from "../types";
import { cardTitle, pieces } from "./canned";
import { BRAINSTORM_CLIENT, PREVIEW_PROVIDER, previewChat } from "./fake-chat";
import { cannedIdeas, sectionLabel } from "./ideas";

/** Sends `text` and collects the turn's events until it ends. */
async function ask(chat: ReturnType<typeof previewChat>, text: string, stopAfter?: number): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  let ended!: () => void;
  const done = new Promise<void>((resolve) => (ended = resolve));
  const unlisten = chat.onEvent((event) => {
    events.push(event);
    if (stopAfter !== undefined && events.length === stopAfter) void chat.stop("c1");
    if (event.kind === "done" || event.kind === "error") ended();
  });
  const turn = await chat.send({ chat: "c1", provider: PREVIEW_PROVIDER.name, model: "canned-replies", text, context: [{ kind: "note", label: "Seaside trip", ref: ["library/seaside-trip.md"] }] });
  await done;
  unlisten();
  expect(events.every((e) => e.chat === "c1" && e.turn === turn.turn)).toBe(true);
  return events;
}

const textOf = (events: ChatEvent[]) => events.map((e) => e.text ?? "").join("");

describe("the preview's chat", () => {
  it("streams a canned answer in small pieces that names its context", async () => {
    const chat = previewChat(() => null, { pace: 0 });
    const events = await ask(chat, "What is this?");
    const texts = events.filter((e) => e.kind === "text");
    expect(texts.length).toBeGreaterThan(50);
    expect(Math.max(...texts.map((e) => e.text!.length))).toBeLessThanOrEqual(8);
    expect(textOf(events)).toContain("browser preview");
    expect(textOf(events)).toContain("[[Seaside trip]]");
    expect(textOf(events)).toContain("OpenAI-compatible");
    expect(events.at(-1)).toEqual({ chat: "c1", turn: events[0]!.turn, kind: "done" });
  });

  it("makes a real card in the thread's session when asked about a card", async () => {
    const vault = new MemoryVault({});
    const chat = previewChat(() => vault, { pace: 0 });
    const events = await ask(chat, "Make a card about hotel ideas, please");
    const tool = events.find((e) => e.kind === "tool")!;
    expect(tool.tool).toMatchObject({ name: "create_note", input: { type: "card", title: "Hotel ideas" } });
    const result = events.find((e) => e.kind === "toolResult")!.result!;
    expect(result).toEqual({ id: tool.tool!.id, ok: true, summary: "Created card “Hotel ideas”", paths: ["inbox/hotel-ideas.md"] });
    expect((await vault.read("inbox/hotel-ideas.md")).text).toContain("Make a card about hotel ideas");
    const [session] = await vault.sessions();
    expect(session).toMatchObject({ client: "chat", commits: 2 });
    expect(await vault.undoSession(session!.id)).toMatchObject({ conflict: null });
    expect((await vault.list()).map((n) => n.path)).not.toContain("inbox/hotel-ideas.md");
  });

  it("queues a message sent while it answers, and takes it up at the next piece", async () => {
    const chat = previewChat(() => null, { pace: 1 });
    const events: ChatEvent[] = [];
    let ended!: () => void;
    const done = new Promise<void>((resolve) => (ended = resolve));
    chat.onEvent((event) => {
      events.push(event);
      if (event.kind === "done") ended();
    });
    const first = await chat.send({ chat: "c1", provider: PREVIEW_PROVIDER.name, model: "canned-replies", text: "Hello", context: [] });
    const second = await chat.send({ chat: "c1", provider: PREVIEW_PROVIDER.name, model: "canned-replies", text: "Also this", context: [] });
    // The turn that runs, not a new one.
    expect(second).toMatchObject({ queued: true, turn: first.turn });
    await done;
    const queued = events.filter((e) => e.kind === "queued").map((e) => [e.text, e.delivered]);
    expect(queued).toEqual([
      ["Also this", false],
      ["Also this", true],
    ]);
    // Taken up while the answer was still coming.
    expect(events.findIndex((e) => e.kind === "queued" && e.delivered)).toBeLessThan(events.findLastIndex((e) => e.kind === "text"));
  });

  it("stops when asked, and keeps no keys", async () => {
    const chat = previewChat(() => null, { pace: 0 });
    const events = await ask(chat, "Hello", 5);
    expect(events.at(-1)).toMatchObject({ kind: "done", stopped: true });
    expect(events.length).toBeLessThan(10);

    const saved = await chat.saveProvider({ name: "Claude", kind: "anthropic", baseUrl: "https://api.anthropic.com", model: "model-small" }, "sk-secret");
    expect(saved.find((p) => p.name === "Claude")).toEqual({ name: "Claude", kind: "anthropic", baseUrl: "https://api.anthropic.com", model: "model-small", hasKey: true, confirmed: true });
    expect(JSON.stringify(saved)).not.toContain("sk-secret");
    expect((await chat.saveProvider({ ...saved[1]!, model: "model-large" }, null))[1]!.hasKey).toBe(true);
    expect((await chat.saveProvider(saved[1]!, ""))[1]!.hasKey).toBe(false);
    expect((await chat.removeProvider("Claude")).map((p) => p.name)).toEqual(["Preview"]);
    await expect(chat.send({ chat: "c2", provider: "Claude", model: "x", text: "Hi", context: [] })).rejects.toThrow("No AI provider called “Claude”");
  });

  it("finds a card's title in the message", () => {
    expect(cardTitle("make a card about hotel ideas.")).toBe("Hotel ideas");
    expect(cardTitle("Pin a card called “Seaside packing list” for me")).toBe("Seaside packing list");
    expect(cardTitle("cards?")).toBe("Idea from the preview chat");
    expect(pieces("abcdefghijklmnop")).toEqual(["abcd", "efghijk", "lmn", "op"]);
  });

  it("brainstorms canned ideas onto a board as a session one undo takes back", async () => {
    const board = "projects/trip/boards/hilltown.canvas";
    const vault = new MemoryVault({ [board]: JSON.stringify({ nodes: [{ id: "a", type: "text", text: "Group sights by area", x: 0, y: 0, width: 260, height: 120 }], edges: [], "x-kasten": { title: "Hilltown" } }) });
    const chat = previewChat(() => vault, { pace: 0 });
    const request = { board, topic: "Day trips", count: 3, provider: PREVIEW_PROVIDER.name, model: "canned-replies" };
    const done = await chat.brainstorm(request);
    // Travel ideas for a trip board, leaving out the one already there.
    expect((await vault.notesAt(done.cards)).map((n) => n.title)).toEqual(["Book the must-dos first", "Leave one slow day", "A budget per day"]);
    const section = (await vault.board(board)).nodes.find((n) => n.id === done.section)!;
    expect(section.label).toBe("Day trips");
    const [session] = await vault.sessions();
    expect(session).toMatchObject({ id: done.session, client: BRAINSTORM_CLIENT, commits: 8 });
    expect(await vault.undoSession(done.session)).toMatchObject({ conflict: null });
    expect((await vault.board(board)).nodes.map((n) => n.id)).toEqual(["a"]);

    await expect(chat.brainstorm({ ...request, provider: "Nobody" })).rejects.toThrow("No AI provider called “Nobody”");
    await expect(previewChat(() => null, { pace: 0 }).brainstorm(request)).rejects.toThrow("No vault is open");
  });

  it("picks canned ideas that suit the topic, and labels the section by it", () => {
    const empty = { title: "Ideas", nodes: [] };
    expect(cannedIdeas("my thesis chapter", empty, 2).map((i) => i.title)).toEqual(["The question in one sentence", "Find the three key papers"]);
    expect(cannedIdeas("", { title: "Seaside trip", nodes: [] }, 1)[0]!.title).toBe("Book the must-dos first");
    expect(cannedIdeas("launch", empty, 1)[0]!.title).toBe("Start with the smallest version");
    expect(cannedIdeas("launch", empty, 50)).toHaveLength(36);
    expect(sectionLabel("  ")).toBe("Brainstorm");
    expect(sectionLabel("Day trips")).toBe("Day trips");
    expect(sectionLabel("x".repeat(80))).toBe(`${"x".repeat(60)}…`);
  });
});
