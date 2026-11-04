import { describe, expect, it, vi } from "vitest";

import type { LibraryLayout, VaultClient } from "../../lib/vault/types";
import { layoutLibraryHost } from "./layout-library-host";

const entry = (over: Partial<LibraryLayout>): LibraryLayout => ({ path: "templates/layouts/a.layout", id: "L-a", label: "Alpha", slots: 2, modified: 5, size: 100, problem: null, ...over });

const FILES: LibraryLayout[] = [
  entry({}),
  entry({ path: "templates/layouts/odd.layout", id: "", label: "odd", slots: 0, problem: "Not a KastenFlow layout: not JSON" }),
  entry({ path: "templates/layouts/b.layout", id: "L-b", label: "Beta", slots: 1 }),
];

function client(over: Partial<VaultClient> = {}) {
  const saved: string[] = [];
  const trashed: string[] = [];
  const api = {
    layoutLibrary: vi.fn(async () => FILES),
    libraryLayout: vi.fn(async (path: string) => ({ path, text: `text of ${path}`, hash: "h", modified: 1 })),
    saveLibraryLayout: vi.fn(async (text: string) => {
      saved.push(text);
      return { path: "templates/layouts/new.layout", id: "L-new", replaced: false, unchanged: false };
    }),
    removeLibraryLayout: vi.fn(async (path: string) => {
      trashed.push(path);
      return `.trash/20261102T000000Z/${path}`;
    }),
    ...over,
  };
  return { api: api as unknown as VaultClient, saved, trashed, fns: api };
}

describe("the layout library of the Kasten host", () => {
  it("has no library where the client keeps none", () => {
    expect(layoutLibraryHost({} as VaultClient)).toEqual({});
    expect(layoutLibraryHost({ layoutLibrary: async () => [] } as unknown as VaultClient)).toEqual({});
  });

  it("lists the layouts that can be used, by their own id, and leaves a file that cannot be read out", async () => {
    const { layoutLibrary } = layoutLibraryHost(client().api);
    expect(await layoutLibrary!.list()).toEqual([
      { id: "L-a", label: "Alpha", slots: 2, modified: 5 },
      { id: "L-b", label: "Beta", slots: 1, modified: 5 },
    ]);
  });

  it("reads an entry by id as the text of its file, and says so when it is gone", async () => {
    const { layoutLibrary } = layoutLibraryHost(client().api);
    expect(await layoutLibrary!.read("L-b")).toBe("text of templates/layouts/b.layout");
    await expect(layoutLibrary!.read("L-none")).rejects.toThrow("no longer in My layouts");
  });

  it("saves the editor's text through the core, and tells every editor that listens", async () => {
    const c = client();
    const { layoutLibrary } = layoutLibraryHost(c.api);
    const heard = vi.fn();
    const stop = layoutLibrary!.watch!(heard);
    const other = vi.fn();
    layoutLibraryHost(c.api).layoutLibrary!.watch!(other);
    await layoutLibrary!.save("the text");
    expect(c.saved).toEqual(["the text"]);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(other, "another editor hears it too").toHaveBeenCalledTimes(1);
    stop();
    await layoutLibrary!.save("again");
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("does not tell anyone when the save failed", async () => {
    const c = client({ saveLibraryLayout: vi.fn(async () => Promise.reject(new Error("refused"))) });
    const { layoutLibrary } = layoutLibraryHost(c.api);
    const heard = vi.fn();
    const stop = layoutLibrary!.watch!(heard);
    await expect(layoutLibrary!.save("x")).rejects.toThrow("refused");
    expect(heard).not.toHaveBeenCalled();
    stop();
  });

  it("takes an entry out by moving its file to the trash, found by id", async () => {
    const c = client();
    const { layoutLibrary } = layoutLibraryHost(c.api);
    await layoutLibrary!.remove!("L-a");
    expect(c.trashed).toEqual(["templates/layouts/a.layout"]);
    await expect(layoutLibrary!.remove!("L-none")).rejects.toThrow("no longer in My layouts");
    expect(c.trashed).toHaveLength(1);
  });

  it("offers no removal where the client cannot", () => {
    const { layoutLibrary } = layoutLibraryHost(client({ removeLibraryLayout: undefined }).api);
    expect(layoutLibrary!.remove).toBeUndefined();
  });
});
