import { describe, expect, it, vi } from "vitest";

import type { CommitInfo } from "../../lib/vault/types";
import { deckHistory, whoMade } from "./deck-history";

const commit = (over: Partial<CommitInfo>): CommitInfo => ({
  id: "c1",
  summary: "deck: save Talk",
  message: "deck: save Talk",
  author: "human",
  time: 1_700_000_000_000,
  agent: false,
  session: null,
  op: null,
  approvedBy: null,
  undoes: null,
  ...over,
});

describe("who made a version", () => {
  it("is you for a person's save and the assistant, by its session's name, for an agent's", () => {
    expect(whoMade({ agent: false, author: "human" })).toBe("You");
    expect(whoMade({ agent: true, author: "agent:kasten-chat" })).toBe("Assistant (kasten-chat)");
    expect(whoMade({ agent: true, author: "agent:" })).toBe("Assistant");
  });
});

describe("a deck's saved versions", () => {
  it("are the commits that changed the deck's file, newest first as the vault gives them, without the merges", async () => {
    const history = vi.fn(() => Promise.resolve([commit({ id: "c3", agent: true, author: "agent:chat" }), commit({ id: "c2", merge: true }), commit({ id: "c1", summary: "deck: create Talk" })]));
    const host = deckHistory({ history, version: vi.fn() }, "decks/talk.deck");
    expect(await host.versions()).toEqual([
      { id: "c3", time: 1_700_000_000_000, author: "Assistant (chat)", summary: "deck: save Talk" },
      { id: "c1", time: 1_700_000_000_000, author: "You", summary: "deck: create Talk" },
    ]);
    expect(history).toHaveBeenCalledWith("decks/talk.deck", 200);
  });

  it("read the file as it was at a commit, and say so when the vault no longer has it", async () => {
    const version = vi.fn((rev: string) => Promise.resolve(rev === "c1" ? '{"format":"kasten-deck"}' : null));
    const host = deckHistory({ history: vi.fn(), version }, "decks/talk.deck");
    expect(await host.read("c1")).toBe('{"format":"kasten-deck"}');
    expect(version).toHaveBeenCalledWith("c1", "decks/talk.deck");
    expect(await host.read("gone")).toBeUndefined();
  });
});
