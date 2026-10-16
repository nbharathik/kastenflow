// Saved collections in the browser preview answer as the core's ops do:
// made, changed line by line so unknown keys and comments stay, renamed,
// trashed and restored; a bad value or a stale hash is refused; and a page
// saved before is found however its address is written.

import { describe, expect, it } from "vitest";

import { MemoryVault } from "./memory-vault";

const HAND_MADE = "# Written by hand\nformat: 1\nname: Reading queue\nicon: book\nquery: \"#capture\"   # keep\nwhen: {updated: last-30-days}\nowner: me   # unknown to this version\nextra:\n  - a\n";

const SEED: Record<string, string> = {
  "library/saved.md": "---\nid: 01SAVED\ntitle: Saved\ntype: card\ntags: [capture]\ncreated: 2026-09-01T10:00:00Z\nurl: https://www.example.com/guide/\nprops:\n  captured: 2026-09-01\n---\nBody\n",
  "library/clipped.md": "---\nid: 01CLIPPED\ntitle: Clipped\ntype: card\ncreated: 2026-09-02T10:00:00Z\nprops:\n  url: http://example.com/guide?utm_source=x\n  snapshot_of: 01SAVED\n---\nBody\n",
  "library/other.md": "---\nid: 01OTHER\ntitle: Other\ntype: card\nurl: https://example.com/other\n---\nBody\n",
};

const vault = () => new MemoryVault({ ...SEED });
const withFile = (path: string, text: string) => {
  const v = vault();
  (v as unknown as { data: { views: Record<string, string> } }).data.views = { [path]: text };
  return v;
};

describe("collections in the preview", () => {
  it("makes one, numbers a taken name and lists them by name", async () => {
    const v = vault();
    expect(await v.collections()).toEqual([]);
    const made = await v.createCollection("Reading queue", { icon: "book", query: "#capture", when: { updated: "last-30-days" }, filter: [{ key: "reading", op: "is_not", value: "Finished" }], sort: [{ key: "captured", dir: "desc" }], display: { type: "table", limit: 500 } });
    expect(made).toMatchObject({ path: "views/reading-queue.yaml", name: "Reading queue", icon: "book", query: "#capture", problem: null, readOnly: false, format: 1 });
    expect(made.when).toEqual({ updated: "last-30-days" });
    expect(made.filter).toEqual([{ key: "reading", op: "is_not", value: "Finished" }]);
    expect(made.display).toEqual({ type: "table", limit: 500 });
    const second = await v.createCollection("reading QUEUE");
    expect(second.path).toBe("views/reading-queue-2.yaml");
    expect((await v.collections()).map((c) => c.path)).toEqual(["views/reading-queue.yaml", "views/reading-queue-2.yaml"]);
  });

  it("changes only the keys it names and keeps unknown keys and comments", async () => {
    const v = withFile("views/reading-queue.yaml", HAND_MADE);
    const [found] = await v.collections();
    const updated = await v.updateCollection(found!.path, { query: "tag:paper", icon: null }, found!.hash);
    expect(updated).toMatchObject({ query: "tag:paper", icon: null });
    const text = (v as unknown as { data: { views: Record<string, string> } }).data.views["views/reading-queue.yaml"]!;
    // (The preview quotes a value with a colon; the core leaves it plain. Everything else is as it was.)
    expect(text).toBe(HAND_MADE.replace('query: "#capture"   # keep\n', 'query: "tag:paper"   # keep\n').replace("icon: book\n", ""));
  });

  it("refuses a stale hash, a bad value and a file it cannot use, writing nothing", async () => {
    const v = withFile("views/reading-queue.yaml", HAND_MADE);
    const [found] = await v.collections();
    await expect(v.updateCollection(found!.path, { query: "x" }, "stale")).rejects.toThrow(/changed since/);
    await expect(v.updateCollection(found!.path, { when: { updated: "someday" as never } }, found!.hash)).rejects.toThrow(/span of days/);
    await expect(v.updateCollection(found!.path, { query: "x".repeat(2001) }, found!.hash)).rejects.toThrow(/at most 2000/);
    await expect(v.updateCollection(found!.path, { name: "x" } as never, found!.hash)).rejects.toThrow(/cannot be changed here/);
    await expect(v.createCollection("  ")).rejects.toThrow(/needs a name/);
    expect(await v.collection(found!.path)).toEqual(found);

    const newer = withFile("views/future.yaml", "format: 2\nname: From the future\nquery: tag:x\n");
    const [future] = await newer.collections();
    expect(future).toMatchObject({ name: "From the future", readOnly: true });
    expect(future!.problem).toMatch(/newer version/);
    await expect(newer.updateCollection(future!.path, { query: "y" }, future!.hash)).rejects.toThrow(/newer version/);
    await expect(newer.renameCollection(future!.path, "Other", future!.hash)).rejects.toThrow(/newer version/);
  });

  it("renames the name line and moves the file, keeping its own numbered name", async () => {
    const v = withFile("views/reading-queue.yaml", HAND_MADE);
    const [found] = await v.collections();
    const renamed = await v.renameCollection(found!.path, "Papers to read", found!.hash);
    expect(renamed).toMatchObject({ path: "views/papers-to-read.yaml", name: "Papers to read" });
    expect((await v.collections()).map((c) => c.path)).toEqual(["views/papers-to-read.yaml"]);
    const same = await v.renameCollection(renamed.path, "Papers to READ!", renamed.hash);
    expect(same.path).toBe("views/papers-to-read.yaml");
  });

  it("trashes and restores, under a free name when its own is taken", async () => {
    const v = withFile("views/reading-queue.yaml", HAND_MADE);
    const trashed = await v.trashCollection("views/reading-queue.yaml");
    expect(trashed).toMatch(/^\.trash\/[^/]+\/views\/reading-queue\.yaml$/);
    expect(await v.collections()).toEqual([]);
    const listed = (await v.listTrash()).find((t) => t.trashed === trashed);
    expect(listed).toMatchObject({ original: "views/reading-queue.yaml", title: "Reading queue" });
    expect(await v.readTrashed(trashed)).toBe(HAND_MADE);
    await v.createCollection("Reading queue");
    const back = await v.restoreCollection(trashed);
    expect(back.path).toBe("views/reading-queue-2.yaml");
    expect((await v.listTrash()).some((t) => t.trashed === trashed)).toBe(false);
  });

  it("counts collections among the revision areas", async () => {
    const v = vault();
    const seen: number[] = [];
    v.watch({ changed() {}, committed() {}, error() {}, revised: (revision) => void seen.push(revision.collections) });
    const before = (await v.revision()).collections;
    await v.createCollection("A");
    expect((await v.revision()).collections).toBe(before + 1);
    expect(seen.at(-1)).toBe(before + 1);
  });
});

describe("a page saved before, in the preview", () => {
  it("is found by a url line, a props.url and any way of writing the address, the first saved first", async () => {
    const v = vault();
    const found = await v.capturedFrom("https://example.com/guide#top");
    expect(found.map((n) => n.path)).toEqual(["library/saved.md", "library/clipped.md"]);
    expect(await v.capturedFrom("https://example.com/other/")).toHaveLength(1);
    expect(await v.capturedFrom("https://example.com/none")).toEqual([]);
    expect(await v.capturedFrom("mailto:a@b.c")).toEqual([]);
  });

  it("cannot clip a page, which needs the desktop app", async () => {
    await expect(vault().clipPage("https://example.com/x")).rejects.toThrow(/desktop app/);
  });
});
