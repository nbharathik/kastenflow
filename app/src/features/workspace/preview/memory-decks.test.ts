import { describe, expect, it } from "vitest";

import { saveDecksWasStale } from "../../../lib/vault/types";
import { deckHead } from "./memory-decks";
import { MemoryVault } from "./memory-vault";

const deck = (title: string, slides = 1, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ format: "kasten-deck", formatVersion: 1, title, slides: Array.from({ length: slides }, (_, i) => ({ id: `s-${i}` })), ...extra }, null, 2) + "\n";

const PROJECT = "projects/trip/_project.md";
const ready = () => new MemoryVault({ [PROJECT]: "---\ntitle: Trip\n---\n" });

describe("deck envelopes", () => {
  it("reads the head and refuses what is not a deck", () => {
    expect(deckHead(deck("Tool use", 3))).toEqual({ title: "Tool use", slides: 3 });
    expect(deckHead('{"format":"kasten-deck","formatVersion":7,"slides":[]}')).toEqual({ title: null, slides: 0 });
    for (const [text, why] of [
      ["", "not JSON"],
      ["[1]", "not a deck"],
      ['{"format":"canvas","formatVersion":1,"slides":[]}', "format"],
      ['{"format":"kasten-deck","slides":[]}', "version"],
      ['{"format":"kasten-deck","formatVersion":0,"slides":[]}', "version"],
      ['{"format":"kasten-deck","formatVersion":1.5,"slides":[]}', "version"],
      ['{"format":"kasten-deck","formatVersion":1}', "slides"],
      ['{"format":"kasten-deck","formatVersion":1,"slides":[],"title":4}', "title"],
    ] as const) {
      expect(() => deckHead(text)).toThrow(new RegExp(`^Not a KastenFlow deck: .*${why}`));
    }
  });
});

describe("decks in the preview", () => {
  it("creates decks where boards go and never replaces one", async () => {
    const vault = ready();
    expect(await vault.createDeck("Tool use", null, deck("Tool use"))).toBe("library/tool-use.deck");
    expect(await vault.createDeck("Tool use", null, deck("Tool use"))).toBe("library/tool-use-2.deck");
    expect(await vault.createDeck("Q3 review", "trip", deck("Q3 review"))).toBe("projects/trip/decks/q3-review.deck");
    await expect(vault.createDeck("X", "nope", deck("X"))).rejects.toThrow("No project called nope");
    await expect(vault.createDeck("  ", null, deck("X"))).rejects.toThrow("title");
    await expect(vault.createDeck("A|B", null, deck("X"))).rejects.toThrow("title");
    await expect(vault.createDeck("X", null, "{}")).rejects.toThrow("Not a KastenFlow deck");
  });

  it("lists decks by title, a broken one by its file name", async () => {
    const vault = new MemoryVault({ "library/broken.deck": "{ nope", "library/b.deck": deck("annual review", 2), "library/a.deck": deck("Tool use", 4) });
    const decks = await vault.decks();
    expect(decks.map((d) => [d.path, d.title, d.slides])).toEqual([
      ["library/b.deck", "annual review", 2],
      ["library/broken.deck", "broken", 0],
      ["library/a.deck", "Tool use", 4],
    ]);
    expect(decks[1]!.problem).toMatch(/^Not a KastenFlow deck/);
    expect(decks[0]!.problem).toBeNull();
    const report = await vault.verify();
    expect(report.decks).toBe(3);
    expect(report.problems.filter((p) => p.kind === "deck").map((p) => p.path)).toEqual(["library/broken.deck"]);
  });

  it("saves with the hash it read, and sends a stale save to a copy", async () => {
    const vault = ready();
    const path = await vault.createDeck("Tool use", null, deck("Tool use", 1));
    const first = await vault.deck(path);
    expect((await vault.saveDeck(path, first.text, first.hash)).status).toBe("unchanged");

    const second = deck("Tool use", 2);
    const written = await vault.saveDeck(path, second, first.hash);
    expect(written.status).toBe("written");
    expect((await vault.deck(path)).text).toBe(second);

    const mine = deck("Tool use", 5);
    const clash = await vault.saveDeck(path, mine, first.hash);
    if (clash.status !== "conflict") throw new Error("expected a conflict");
    expect(clash.deck.text).toBe(second);
    expect((await vault.deck(path)).text).toBe(second);
    expect((await vault.deck(clash.copy)).text).toBe(mine);
    expect(clash.copy).toMatch(/^library\/tool-use \(conflict \d{4}-\d\d-\d\d \d\d-\d\d\)\.deck$/);
    await expect(vault.saveDeck(path, "{}", first.hash)).rejects.toThrow("Not a KastenFlow deck");
    expect((await vault.deck(path)).text).toBe(second);
    await expect(vault.saveDeck("library/none.deck", mine, "x")).rejects.toThrow();
  });

  it("saves several decks all or none, with the hashes they were read with", async () => {
    const vault = ready();
    const a = await vault.createDeck("Alpha", null, deck("Alpha", 1));
    const b = await vault.createDeck("Beta", null, deck("Beta", 2));
    const [ha, hb] = [(await vault.deck(a)).hash, (await vault.deck(b)).hash];
    const request = { message: "slides: change two decks", edits: [{ path: a, baseHash: ha, text: deck("Alpha", 3) }, { path: b, baseHash: hb, text: deck("Beta", 2) }] };

    // One of them is not a deck, one has moved on, a path is listed twice, the message is not one line: nothing is written.
    await expect(vault.saveDecks({ ...request, edits: [request.edits[0]!, { ...request.edits[1]!, text: "{}" }] })).rejects.toThrow("Not a KastenFlow deck");
    await expect(vault.saveDecks({ ...request, edits: [request.edits[0]!, { ...request.edits[1]!, baseHash: "x" }] })).rejects.toThrow("changed since you looked");
    await expect(vault.saveDecks({ ...request, edits: [request.edits[0]!, request.edits[0]!] })).rejects.toThrow("listed twice");
    await expect(vault.saveDecks({ ...request, message: "a\nb" })).rejects.toThrow("message");
    await expect(vault.saveDecks({ ...request, edits: [] })).rejects.toThrow("Nothing to save");
    expect((await vault.deck(a)).text).toBe(deck("Alpha", 1));

    // The deck that already holds the text it is given is not among the written; there is no history in the preview to undo with.
    const saved = await vault.saveDecks(request);
    expect(saved).toEqual({ commit: null, paths: [a] });
    expect((await vault.deck(a)).text).toBe(deck("Alpha", 3));
    expect(saveDecksWasStale(new Error("Some decks changed since you looked, so nothing was saved. Look again."))).toBe(true);
    expect(saveDecksWasStale(new Error("nope"))).toBe(false);
  });

  it("trashes a deck, lists it by title and puts it back beside one that took its place", async () => {
    const vault = ready();
    const path = await vault.createDeck("Tool use", "trip", deck("Tool use", 2));
    const trashed = await vault.trash(path);
    expect(await vault.decks()).toEqual([]);
    expect(await vault.listTrash()).toEqual([{ trashed, original: path, title: "Tool use", when: expect.any(String), inside: 0 }]);
    await expect(vault.restore(trashed)).rejects.toThrow();
    await vault.createDeck("Tool use", "trip", deck("Other"));
    expect(await vault.restoreDeck(trashed)).toBe("projects/trip/decks/tool-use-2.deck");
    expect((await vault.decks()).map((d) => d.title).sort()).toEqual(["Other", "Tool use"]);
    expect(await vault.listTrash()).toEqual([]);
    await expect(vault.restoreDeck(trashed)).rejects.toThrow();
  });
});
