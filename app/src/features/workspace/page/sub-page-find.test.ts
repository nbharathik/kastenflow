// "+ sub-pages" in the workspace: find and replace under a page against the
// preview vault, the toast with Undo for the commit, and the refusals.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryVault } from "../preview/memory-vault";
import { useWorkspace } from "../store";
import { subPageFind } from "./sub-page-find";

const TOP = "---\nid: TOP\ntitle: Trip plan\n---\nWe fly to Paris on Monday.\n";
const MID = "---\nid: MID\ntitle: Paris notes\nparent: TOP\n---\nparis cafes, last paris\n";
const OTHER = "---\nid: OTHER\ntitle: Other\n---\nparis elsewhere\n";

let vault: MemoryVault;
const spec = { query: "paris" };
const toasts = () => useWorkspace.getState().toasts;

beforeEach(async () => {
  vault = new MemoryVault({ "library/top.md": TOP, "library/mid.md": MID, "library/other.md": OTHER });
  useWorkspace.setState({ place: { view: "home" }, back: [], forward: [], toasts: [] });
  await useWorkspace.getState().connect({ client: vault });
});

describe("looking under a page", () => {
  it("lists the page and its sub-pages with matches, titles too, and no other page", async () => {
    const found = await subPageFind(vault, () => "library/top.md").find(spec, 201);
    expect(found.map((n) => [n.path, n.count, n.titleHit])).toEqual([
      ["library/top.md", 1, false],
      ["library/mid.md", 2, true],
    ]);
  });
});

describe("replacing under a page", () => {
  it("writes the pages the preview showed, and says how many", async () => {
    const find = subPageFind(vault, () => "library/top.md");
    const found = await find.find(spec, 201);
    const done = await find.replace({
      spec,
      with: "Rome",
      expect: found.filter((n) => n.count > 0).map(({ path, hash, count }) => ({ path, hash, count })),
    });
    expect(done.total).toBe(3);
    expect((await vault.read("library/top.md")).text).toContain("We fly to Rome on Monday.");
    expect((await vault.read("library/mid.md")).text).toContain("Rome cafes, last Rome");
    // The title is left to Rename, and a page beside it is left alone.
    expect((await vault.read("library/mid.md")).text).toContain("title: Paris notes");
    expect((await vault.read("library/other.md")).text).toBe(OTHER);
    expect(toasts().map((t) => t.text)).toEqual(["Replaced 3 matches in 2 pages"]);
  });

  it("offers Undo for the commit, which takes it back and says so", async () => {
    const find = subPageFind(vault, () => "library/top.md");
    const found = await find.find(spec, 201);
    vi.spyOn(vault, "replaceUnder").mockResolvedValue({ commit: "c0ffee", notes: [["library/top.md", 1]], total: 1 });
    const undo = vi.spyOn(vault, "undoCommit").mockResolvedValue({ reverted: ["c0ffee"], conflict: null });
    await find.replace({ spec, with: "Rome", expect: [{ path: found[0]!.path, hash: found[0]!.hash, count: 1 }] });
    const action = toasts()[0]!.action!;
    expect(action.label).toBe("Undo");
    action.run();
    await vi.waitFor(() => expect(toasts().map((t) => t.text)).toContain("Undid the replace"));
    expect(undo).toHaveBeenCalledWith("c0ffee");
  });

  it("tells when a page changed since, and says nothing was undone", async () => {
    const find = subPageFind(vault, () => "library/top.md");
    const found = await find.find(spec, 201);
    vi.spyOn(vault, "replaceUnder").mockResolvedValue({ commit: "bad", notes: [["library/top.md", 1]], total: 1 });
    vi.spyOn(vault, "undoCommit").mockResolvedValue({ reverted: [], conflict: { commit: "later", summary: "edit: Trip plan", path: "library/top.md", detail: "Edited since" } });
    await find.replace({ spec, with: "Rome", expect: [{ path: found[0]!.path, hash: found[0]!.hash, count: 1 }] });
    toasts()[0]!.action!.run();
    await vi.waitFor(() => expect(toasts().map((t) => t.text)).toContain("Not undone: library/top.md changed since (edited since)."));
  });

  it("refuses, writing nothing, when a page changed since the preview", async () => {
    const find = subPageFind(vault, () => "library/top.md");
    const found = await find.find(spec, 201);
    await vault.saveBody("library/mid.md", "paris bars, last paris\n", (await vault.read("library/mid.md")).hash);
    await expect(find.replace({ spec, with: "Rome", expect: found.filter((n) => n.count > 0).map(({ path, hash, count }) => ({ path, hash, count })) })).rejects.toThrow(/changed since the preview/);
    expect((await vault.read("library/top.md")).text).toBe(TOP);
    expect(toasts()).toEqual([]);
  });
});
