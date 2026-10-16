// Comments and highlights in the browser preview answer as the core's ops do:
// kept in files beside the page that never change its text, with unknown keys
// kept, and going wherever the page goes.

import { describe, expect, it } from "vitest";

import { MemoryVault } from "./memory-vault";

const SEED: Record<string, string> = {
  "library/trip-plan.md": "---\nid: 01TRIP\ntitle: Trip plan\ntype: page\n---\n# Method\n\nUse a perceptual hash to score photos.\n",
  "library/card.md": "---\nid: 01CARD\ntitle: Card\ntype: card\nurl: https://example.com/a\n---\nPress Ctrl+N anywhere to jot something down.\n",
  "projects/photo/_project.md": "---\nid: 01PHOTO\ntitle: Photo\ntype: project\n---\n",
  "templates/page.md": "---\ntitle: Page\ntype: template\n---\n",
};

const vault = () => new MemoryVault({ ...SEED });
const sidecars = (v: MemoryVault) => (v as unknown as { data: { sidecars?: Record<string, string> } }).data.sidecars ?? {};
const anchor = { section: "Method", nth: 1 };

describe("comments in the preview", () => {
  it("add, resolve, reopen and move, leaving the page alone", async () => {
    const v = vault();
    expect(await v.comments("library/trip-plan.md")).toEqual([]);
    const added = await v.addComment("library/trip-plan.md", { anchor: { ...anchor, quote: "perceptual hash" }, text: "  Enough for crops?  " });
    expect(added).toMatchObject({ author: "you", text: "Enough for crops?", resolved: null, anchor: { section: "Method", nth: 1, quote: "perceptual hash" } });
    expect(added.id).toMatch(/^c-/);
    expect((await v.read("library/trip-plan.md")).text).toBe(SEED["library/trip-plan.md"]);

    const done = await v.resolveComment("library/trip-plan.md", added.id, true);
    expect(done.resolved).toMatchObject({ by: "you" });
    const at = done.resolved!.at;
    // Resolving again keeps who and when; reopening takes it off.
    expect((await v.resolveComment("library/trip-plan.md", added.id, true)).resolved!.at).toBe(at);
    expect((await v.resolveComment("library/trip-plan.md", added.id, false)).resolved).toBeNull();

    const moved = await v.reanchorComment("library/trip-plan.md", added.id, { section: "Results", nth: 2 });
    expect(moved.anchor).toEqual({ section: "Results", nth: 2 });
    expect((await v.comments("library/trip-plan.md"))[0]!.anchor).toEqual({ section: "Results", nth: 2 });
    // One comment to a line.
    const text = sidecars(v)["library/trip-plan.comments.json"]!;
    expect(text.split("\n").filter((line) => line.includes('"id"'))).toHaveLength(1);
  });

  it("keeps keys it does not know and refuses what the core refuses", async () => {
    const v = vault();
    sidecars(v)["library/trip-plan.comments.json"] = '{"format": "kasten-comments", "zzz": 1, "comments": [{"id": "c-x", "anchor": {"section": "A", "nth": 1, "future": true}, "text": "hand", "extra": "kept"}]}';
    await v.resolveComment("library/trip-plan.md", "c-x", true);
    const text = sidecars(v)["library/trip-plan.comments.json"]!;
    for (const kept of ['"zzz": 1', '"extra":"kept"', '"future":true']) expect(text).toContain(kept);

    await expect(v.addComment("library/trip-plan.md", { anchor, text: "   " })).rejects.toThrow(/needs some words/);
    await expect(v.addComment("library/trip-plan.md", { anchor: { section: "", nth: 0 }, text: "x" })).rejects.toThrow(/count from 1/);
    await expect(v.addComment("library/trip-plan.md", { anchor: { section: "a\nb", nth: 1 }, text: "x" })).rejects.toThrow(/one line/);
    await expect(v.addComment("library/missing.md", { anchor, text: "x" })).rejects.toThrow(/No note/);
    await expect(v.addComment("templates/page.md", { anchor, text: "x" })).rejects.toThrow(/template/);
    await expect(v.resolveComment("library/trip-plan.md", "c-nope", true)).rejects.toThrow(/No comment/);
    sidecars(v)["library/card.comments.json"] = "not json";
    await expect(v.comments("library/card.md")).rejects.toThrow(/Not a comments file/);
    await expect(v.addComment("library/card.md", { anchor, text: "x" })).rejects.toThrow(/Not a comments file/);
    expect(sidecars(v)["library/card.comments.json"]).toBe("not json");
  });

  it("move the revision's annotations counter", async () => {
    const v = vault();
    const before = (await v.revision()).annotations;
    await v.addComment("library/trip-plan.md", { anchor, text: "hm" });
    expect((await v.revision()).annotations).toBeGreaterThan(before);
  });
});

describe("the files go wherever the page goes", () => {
  it("rename, move to a project and the inbox, nest, duplicate", async () => {
    const v = vault();
    const c = await v.addComment("library/trip-plan.md", { anchor, text: "hm" });
    const renamed = await v.rename("library/trip-plan.md", "Summer trip");
    expect(renamed.note.meta.path).toBe("library/summer-trip.md");
    expect(Object.keys(sidecars(v))).toEqual(["library/summer-trip.comments.json"]);
    expect((await v.comments("library/summer-trip.md"))[0]!.id).toBe(c.id);

    const moved = await v.move("library/summer-trip.md", "photo");
    expect(moved.meta.path).toBe("projects/photo/pages/summer-trip.md");
    expect(Object.keys(sidecars(v))).toEqual(["projects/photo/pages/summer-trip.comments.json"]);
    const inbox = await v.moveToInbox(moved.meta.path);
    expect(inbox.meta.path).toBe("inbox/summer-trip.md");
    expect(Object.keys(sidecars(v))).toEqual(["inbox/summer-trip.comments.json"]);

    const copy = await v.duplicate("inbox/summer-trip.md");
    expect((await v.comments(copy.meta.path)).map((x) => x.id)).toEqual([c.id]);
    await v.addComment(copy.meta.path, { anchor, text: "only here" });
    expect(await v.comments("inbox/summer-trip.md")).toHaveLength(1);
  });

  it("trash with the sub-pages and restore, under a free name too, and are not listed in the trash", async () => {
    const v = vault();
    const top = await v.create({ kind: "page", title: "Top", date: "2026-10-10" });
    const sub = await v.create({ kind: "page", title: "Sub", date: "2026-10-10", parent: top.meta.path });
    await v.addComment(top.meta.path, { anchor, text: "on top" });
    await v.addComment(sub.meta.path, { anchor, text: "on sub" });
    const trashed = await v.trash(top.meta.path);
    expect(Object.keys(sidecars(v))).toEqual([]);
    const listed = await v.listTrash();
    expect(listed.map((t) => [t.title, t.inside])).toEqual([["Top", 1]]);

    // Another page takes the old name meanwhile.
    const again = await v.create({ kind: "page", title: "Top", date: "2026-10-10" });
    expect(again.meta.path).toBe(top.meta.path);
    await v.addComment(again.meta.path, { anchor, text: "the new page's" });
    const back = await v.restore(trashed);
    expect(back.meta.path).not.toBe(top.meta.path);
    expect((await v.comments(back.meta.path)).map((c) => c.text)).toEqual(["on top"]);
    expect((await v.comments(sub.meta.path)).map((c) => c.text)).toEqual(["on sub"]);
    expect((await v.comments(again.meta.path)).map((c) => c.text)).toEqual(["the new page's"]);
    expect(await v.listTrash()).toEqual([]);
  });

  it("a stray file keeps its name off a new page", async () => {
    const v = vault();
    sidecars(v)["library/untitled.comments.json"] = '{"comments": []}';
    const made = await v.create({ kind: "page", title: "Untitled", date: "2026-10-10" });
    expect(made.meta.path).toBe("library/untitled-2.md");
    expect(await v.comments(made.meta.path)).toEqual([]);
  });
});

describe("highlights on a captured page in the preview", () => {
  it("add, change, move and remove, leaving the card alone", async () => {
    const v = vault();
    const card = "library/card.md";
    const added = await v.addTextHighlight(card, { anchor: { quote: "jot something down", prefix: "anywhere to ", suffix: "." }, color: "yellow", comment: " worth a card " });
    expect(added).toMatchObject({ color: "yellow", comment: "worth a card", anchor: { quote: "jot something down" } });
    expect(added.id).toMatch(/^h-/);
    expect((await v.read(card)).text).toBe(SEED[card]);
    const edited = await v.editTextHighlight(card, added.id, { color: "blue", comment: "" });
    expect(edited).toMatchObject({ color: "blue", comment: null });
    const moved = await v.moveTextHighlight(card, added.id, { quote: "jot" });
    expect(moved.anchor).toEqual({ quote: "jot" });
    expect(await v.textHighlights(card)).toHaveLength(1);
    await v.removeTextHighlight(card, added.id);
    expect(await v.textHighlights(card)).toEqual([]);
    await expect(v.removeTextHighlight(card, added.id)).rejects.toThrow(/No highlight/);
  });

  it("refuse a bad colour and an empty quote", async () => {
    const v = vault();
    await expect(v.addTextHighlight("library/card.md", { anchor: { quote: "words" }, color: "orange" })).rejects.toThrow(/yellow, green, blue, pink, purple/);
    await expect(v.addTextHighlight("library/card.md", { anchor: { quote: "  " }, color: "pink" })).rejects.toThrow(/words it marks/);
    expect(await v.textHighlights("library/card.md")).toEqual([]);
  });

  it("go with the card", async () => {
    const v = vault();
    await v.addTextHighlight("library/card.md", { anchor: { quote: "jot" }, color: "pink" });
    await v.addComment("library/card.md", { anchor, text: "hm" });
    const moved = await v.move("library/card.md", "photo");
    expect(Object.keys(sidecars(v)).sort()).toEqual(["projects/photo/cards/card.comments.json", "projects/photo/cards/card.highlights.json"]);
    expect(await v.textHighlights(moved.meta.path)).toHaveLength(1);
  });
});
