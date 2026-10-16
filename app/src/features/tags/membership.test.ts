// Putting pages into a tag's database: they gain the tag and nothing else,
// as one change with one Undo; pages the view's filters hide are said so.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NoteMeta, TagSchema, TagView } from "../../lib/vault/types";
import { MemoryVault } from "../workspace/preview/memory-vault";
import { useWorkspace } from "../workspace/store";
import { addPagesToTag, hiddenBy, undoAdded, type Destination } from "./membership";

const SEED = {
  "library/a.md": "---\nid: 01A\ntitle: Alpha\ntags: [idea]\nprops:\n  status: Open\n---\nA body.\n",
  "library/b.md": "---\nid: 01B\ntitle: Beta\n---\nB body.\n",
  "library/c.md": "---\nid: 01C\ntitle: Gamma\ntags: [reading]\n---\nC body.\n",
  "projects/trip/_project.md": "---\nid: 01P\ntitle: Trip\ntype: project\n---\n",
  "projects/trip/pages/d.md": "---\nid: 01D\ntitle: Delta\n---\nD body.\n",
};

const schema: TagSchema = { name: "reading", color: null, properties: [{ key: "status", type: "select", options: ["Open", "Done"] }], views: [], path: "tags/reading.yaml" };
const all: TagView = { name: "All", type: "table" };
const open: TagView = { name: "Open", type: "table", filter: [{ key: "status", op: "is", value: "Open" }] };

let vault: MemoryVault;
const toast = vi.fn();
const dest = (view: TagView = all, extra: Partial<Destination> = {}): Destination => ({ tag: "reading", view, schema, folder: null, ...extra });
const tagsOf = async (path: string) => (await vault.read(path)).meta.tags;

beforeEach(async () => {
  vault = new MemoryVault({ ...SEED });
  useWorkspace.setState({ client: vault, notes: await vault.list(), toast });
  toast.mockClear();
});

describe("adding pages to a tag", () => {
  it("gives the pages the tag, keeps the rest of each, and offers one Undo", async () => {
    const before = await vault.read("library/a.md");
    const added = await addPagesToTag(["library/a.md", "library/b.md", "library/a.md"], dest());
    expect(added?.changed.map((n) => n.path)).toEqual(["library/a.md", "library/b.md"]);
    expect(await tagsOf("library/a.md")).toEqual(["idea", "reading"]);
    expect(await tagsOf("library/b.md")).toEqual(["reading"]);
    // The pages did not move, and nothing but the tags changed.
    expect((await vault.read("library/a.md")).text).toBe(before.text.replace("tags: [idea]", "tags: [idea, reading]"));
    expect(useWorkspace.getState().notes.find((n) => n.path === "library/b.md")?.tags).toEqual(["reading"]);
    expect(toast).toHaveBeenCalledTimes(1);
    const [text, action] = toast.mock.calls[0] as [string, { label: string; run(): void }];
    expect(text).toBe("Added 2 pages to #reading");
    expect(action.label).toBe("Undo");
    action.run();
    await vi.waitFor(async () => expect(await tagsOf("library/b.md")).toEqual([]));
    expect(await tagsOf("library/a.md")).toEqual(["idea"]);
  });

  it("names the page when there is one, and says what had the tag already", async () => {
    await addPagesToTag(["library/b.md"], dest());
    expect(toast.mock.calls[0]![0]).toBe("Added “Beta” to #reading");
    toast.mockClear();
    await addPagesToTag(["library/b.md", "library/c.md", "library/a.md"], dest());
    expect(toast.mock.calls[0]![0]).toBe("Added “Alpha” to #reading, 2 already had it");
    toast.mockClear();
    await addPagesToTag(["library/b.md"], dest());
    expect(toast).toHaveBeenCalledWith("That page is already in #reading");
    toast.mockClear();
    await addPagesToTag(["library/b.md", "library/a.md"], dest());
    expect(toast).toHaveBeenCalledWith("Those pages are already in #reading");
  });

  it("takes pages only, and does nothing for a drop with none", async () => {
    const spy = vi.spyOn(vault, "addTagToMany");
    expect(await addPagesToTag(["boards/map.canvas", "sources/a.pdf"], dest())).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    await addPagesToTag(["boards/map.canvas", "library/b.md"], dest());
    expect(spy).toHaveBeenCalledWith(["library/b.md"], "reading");
  });

  it("refuses the whole when a page is gone, and says so", async () => {
    expect(await addPagesToTag(["library/b.md", "library/gone.md"], dest())).toBeNull();
    expect(toast.mock.calls[0]![0]).toMatch(/No note at library\/gone\.md/);
    expect(await tagsOf("library/b.md")).toEqual([]);
  });

  it("says when the view’s filters hide an added page, and reveals it on request", async () => {
    const reveal = vi.fn();
    await addPagesToTag(["library/b.md", "library/a.md"], dest(open, { reveal }));
    // Alpha has status Open and shows; Beta has none and is hidden.
    expect(toast).toHaveBeenCalledTimes(2);
    expect(toast.mock.calls[1]![0]).toBe("1 added page is hidden by this view’s filters");
    const action = toast.mock.calls[1]![1] as { label: string; run(): void };
    expect(action.label).toBe("Reveal");
    action.run();
    expect(reveal).toHaveBeenCalledWith(["library/b.md"]);
    // Revealing changed no property.
    expect((await vault.read("library/b.md")).meta.props).toEqual({});
    toast.mockClear();
    await addPagesToTag(["projects/trip/pages/d.md"], dest(all));
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("works out which pages a view hides", async () => {
    const changed = (await vault.list()).filter((n) => n.path === "library/a.md" || n.path === "library/b.md");
    const notes: NoteMeta[] = changed.map((n) => ({ ...n, tags: [...n.tags, "reading"] }));
    expect(hiddenBy(notes, dest(open), notes)).toEqual(["library/b.md"]);
    expect(hiddenBy(notes, dest(all), notes)).toEqual([]);
  });

  it("takes the tag off again by the pages when no commit is there to undo", async () => {
    const added = (await addPagesToTag(["library/b.md"], dest()))!;
    expect(added.commit).toBeNull();
    await undoAdded(vault, added);
    expect(await tagsOf("library/b.md")).toEqual([]);
    expect(useWorkspace.getState().notes.find((n) => n.path === "library/b.md")?.tags).toEqual([]);
  });

  it("says so when a page changed since and the commit cannot be undone", async () => {
    const undoCommit = vi.fn(async () => ({ reverted: [], conflict: { path: "library/a.md", detail: "Edited since" } }) as never);
    useWorkspace.setState({ refresh: vi.fn(async () => {}) });
    await undoAdded({ undoCommit } as never, { tag: "reading", changed: [], already: [], commit: "abc123" });
    expect(toast).toHaveBeenCalledWith("Not undone: library/a.md changed since (edited since)");
  });

  it("undoes by the commit when there is one", async () => {
    const undoCommit = vi.fn(async () => ({ reverted: [], conflict: null }) as never);
    const refresh = vi.fn(async () => {});
    useWorkspace.setState({ refresh });
    await undoAdded({ undoCommit } as never, { tag: "reading", changed: [], already: [], commit: "abc123" });
    expect(undoCommit).toHaveBeenCalledWith("abc123");
    expect(refresh).toHaveBeenCalled();
  });
});
