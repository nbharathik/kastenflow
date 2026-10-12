import { beforeEach, describe, expect, it } from "vitest";

import { MemoryVault } from "./preview/memory-vault";
import { usePrefs } from "./prefs";
import { useWorkspace } from "./store";
import { derive } from "./store-layout";
import { initialLayout } from "./tabs";

const SEED = {
  "projects/demo/_project.md": "---\ntitle: Demo\ntype: project\n---\n",
  "projects/demo/pages/alpha.md": "---\ntitle: Alpha\n---\nA\n",
  "projects/demo/pages/beta.md": "---\ntitle: Beta\n---\nB\n",
};

const state = () => useWorkspace.getState();
const prefs = () => usePrefs.getState();

beforeEach(async () => {
  localStorage.clear();
  usePrefs.setState({ favourites: [], pinnedPages: [] });
  useWorkspace.setState({ ...derive(initialLayout()), stack: [], stackOpen: false, recent: [], toasts: [] });
  await state().connect({ client: new MemoryVault(SEED) });
});

describe("pinned pages", () => {
  it("are pinned and unpinned, and kept", () => {
    prefs().togglePinnedPage("projects/demo/pages/alpha.md");
    prefs().togglePinnedPage("projects/demo/pages/beta.md");
    expect(prefs().pinnedPages).toEqual(["projects/demo/pages/alpha.md", "projects/demo/pages/beta.md"]);
    expect(JSON.parse(localStorage.getItem("kasten.prefs")!).pinnedPages).toHaveLength(2);
    prefs().togglePinnedPage("projects/demo/pages/alpha.md");
    expect(prefs().pinnedPages).toEqual(["projects/demo/pages/beta.md"]);
  });

  it("follow a page that is renamed, as favourites do", async () => {
    prefs().togglePinnedPage("projects/demo/pages/alpha.md");
    prefs().toggleFavourite("projects/demo/pages/alpha.md");
    await state().rename("projects/demo/pages/alpha.md", "Omega");
    const now = state().notes.find((n) => n.title === "Omega")!.path;
    expect(now).not.toBe("projects/demo/pages/alpha.md");
    expect(prefs().pinnedPages).toEqual([now]);
    expect(prefs().favourites).toEqual([now]);
  });

  it("follow a page that moves out of its project", async () => {
    prefs().togglePinnedPage("projects/demo/pages/beta.md");
    const to = await state().move("projects/demo/pages/beta.md", null, true);
    expect(to).toBeTruthy();
    expect(to).not.toBe("projects/demo/pages/beta.md");
    expect(prefs().pinnedPages).toEqual([to]);
  });

  it("go when the page goes to the trash, and the others stay", async () => {
    prefs().togglePinnedPage("projects/demo/pages/alpha.md");
    prefs().togglePinnedPage("projects/demo/pages/beta.md");
    await state().trash("projects/demo/pages/alpha.md", true);
    expect(prefs().pinnedPages).toEqual(["projects/demo/pages/beta.md"]);
  });

  it("are left alone by a move of something that is not pinned", () => {
    prefs().togglePinnedPage("projects/demo/pages/alpha.md");
    prefs().moveFavourite("projects/demo/pages/beta.md", "elsewhere.md");
    expect(prefs().pinnedPages).toEqual(["projects/demo/pages/alpha.md"]);
    expect(prefs().favourites).toEqual([]);
  });
});
