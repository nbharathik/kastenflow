import { beforeEach, describe, expect, it } from "vitest";

import { dayFrom } from "../../lib/dates";
import { MemoryVault } from "./preview/memory-vault";
import { usePrefs } from "./prefs";
import { useWorkspace } from "./store";
import { derive } from "./store-layout";
import { initialLayout } from "./tabs";

const SEED = {
  "library/plan.canvas": '{"nodes":[],"edges":[]}',
  "library/a.md": "---\ntitle: Alpha\n---\nA\n",
  "library/b.md": "---\ntitle: Beta\n---\nB\n",
  "templates/journal.md": '---\ntitle: "{{date}}"\ntype: journal\n---\n## Morning\n',
};

let vault: MemoryVault;
const state = () => useWorkspace.getState();

beforeEach(async () => {
  localStorage.clear();
  vault = new MemoryVault(SEED);
  useWorkspace.setState({ ...derive(initialLayout()), stack: [], stackOpen: false, recent: [], toasts: [] });
  await state().connect({ client: vault });
});

describe("workspace", () => {
  it("opens pages in their own tabs when asked to, keeping Home", () => {
    const tabs = () => state().layout.panes[0]!.tabs.map((t) => t.place.path ?? t.place.view);
    usePrefs.getState().set({ newTabs: true });
    state().go({ view: "home" });
    state().openPath("library/a.md");
    state().openPath("library/b.md");
    expect(tabs()).toEqual(["home", "library/a.md", "library/b.md"]);
    // Opening one already open goes to its tab.
    state().openPath("library/a.md");
    expect(tabs()).toHaveLength(3);
    expect(state().place.path).toBe("library/a.md");
    // A view keeps the page it would have taken the place of, goes to a tab
    // that already shows it, and after another view changes its own tab.
    state().go({ view: "inbox" });
    expect(tabs()).toEqual(["home", "library/a.md", "inbox", "library/b.md"]);
    state().go({ view: "home" });
    expect(tabs()).toEqual(["home", "library/a.md", "inbox", "library/b.md"]);
    expect(state().place.view).toBe("home");
    state().go({ view: "tasks" });
    expect(tabs()).toEqual(["tasks", "library/a.md", "inbox", "library/b.md"]);
    // Off again, a page takes the place of what the tab shows.
    usePrefs.getState().set({ newTabs: false });
    state().openPath("library/b.md");
    expect(tabs()).toEqual(["library/b.md", "library/a.md", "inbox", "library/b.md"]);
  });

  it("goes back and forward, and remembers recent pages", () => {
    state().openPath("library/a.md");
    state().openPath("library/b.md");
    state().goBack();
    expect(state().place).toEqual({ view: "page", path: "library/a.md" });
    state().goForward();
    expect(state().place.path).toBe("library/b.md");
    expect(state().recent).toEqual(["library/b.md", "library/a.md"]);
    state().go({ view: "inbox" });
    expect(state().forward).toEqual([]);
  });

  it("opens titles and days, and offers to create what is missing", async () => {
    await state().openTitle("beta");
    expect(state().place.path).toBe("library/b.md");
    await state().openTitle(dayFrom(0));
    expect(state().place.path).toBe(`journal/${dayFrom(0).slice(0, 4)}/${dayFrom(0)}.md`);
    await state().openTitle("Gamma");
    const toast = state().toasts.at(-1)!;
    expect(toast.text).toContain("Gamma");
    toast.action!.run();
    await expect.poll(() => state().notes.some((n) => n.title === "Gamma")).toBe(true);
  });

  it("trashes a page, leaves it, and brings it back with Undo", async () => {
    state().openPath("library/a.md");
    state().openPath("library/b.md");
    await state().trash("library/b.md");
    expect(state().place.path).toBe("library/a.md");
    expect(state().notes.map((n) => n.path)).not.toContain("library/b.md");
    state().toasts.at(-1)!.action!.run();
    await expect.poll(() => state().notes.map((n) => n.path)).toContain("library/b.md");
  });

  it("trashes a page with its sub-pages, closing their tabs, and Undo brings all back", async () => {
    const top = await vault.create({ kind: "page", title: "Trip plan", date: "2026-09-28", project: null });
    const mid = await vault.create({ kind: "page", title: "Packing", date: "2026-09-28", project: null, parent: top.meta.path });
    const low = await vault.create({ kind: "page", title: "Shoes", date: "2026-09-28", project: null, parent: mid.meta.path });
    await state().refresh();
    state().openPath("library/a.md");
    state().openPath(low.meta.path);
    await state().trash(top.meta.path);
    const paths = () => state().notes.map((n) => n.path);
    for (const note of [top, mid, low]) expect(paths()).not.toContain(note.meta.path);
    expect(state().place.path).toBe("library/a.md");
    expect(state().toasts.at(-1)!.text).toBe("Moved “Trip plan” and 2 sub-pages to the trash");
    state().toasts.at(-1)!.action!.run();
    await expect.poll(paths).toContain(low.meta.path);
    expect(paths()).toContain(mid.meta.path);
  });

  it("keeps a page made while the vault is still listing, and its tab", async () => {
    // The first list answers late, as a big vault's does, with notes as they
    // were when it was asked for.
    const slow = new MemoryVault(SEED);
    const list = slow.list.bind(slow);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let calls = 0;
    slow.list = async () => {
      const answer = await list();
      if (calls++ === 0) await gate;
      return answer;
    };
    useWorkspace.setState({ ...derive(initialLayout()), notes: [], stack: [], stackOpen: false, recent: [], toasts: [] });
    const connecting = state().connect({ client: slow });
    const made = await state().create({ kind: "page", title: "Captured" });
    release();
    await connecting;
    expect(state().notes.map((n) => n.path)).toContain(made!.meta.path);
    expect(state().place).toEqual({ view: "page", path: made!.meta.path });
  });

  it("keeps a board's tab open when the window opens the vault again", async () => {
    state().openPath("library/plan.canvas");
    state().openPath("library/gone.canvas", "tab");
    expect(state().place).toEqual({ view: "boards", path: "library/gone.canvas" });
    await state().connect({ client: vault });
    const open = () => state().layout.panes.flatMap((pane) => pane.tabs.map((tab) => tab.place.path));
    // The lists of boards, decks and diagrams arrive after the window is ready.
    await expect.poll(open).not.toContain("library/gone.canvas");
    expect(open()).toContain("library/plan.canvas");
  });

  it("is ready before the boards, decks and diagrams are listed, and each list stands alone", async () => {
    const slow = new MemoryVault(SEED);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    slow.boards = async () => {
      await gate;
      return [];
    };
    slow.decks = async () => {
      throw new Error("decks are unreadable");
    };
    useWorkspace.setState({ ...derive(initialLayout()), notes: [], stack: [], stackOpen: false, recent: [], toasts: [] });
    state().openPath("library/gone.canvas", "tab");
    state().openPath("library/gone.deck", "tab");
    await state().connect({ client: slow });
    const open = () => state().layout.panes.flatMap((pane) => pane.tabs.map((tab) => tab.place.path));
    expect(state().ready).toBe(true);
    // Nothing is judged until the lists are in.
    expect(open()).toContain("library/gone.canvas");
    release();
    await expect.poll(open).not.toContain("library/gone.canvas");
    // The deck list failed: its tab stays.
    expect(open()).toContain("library/gone.deck");
  });
});

describe("the first start", () => {
  const WELCOME = { ...SEED, "library/welcome.md": "---\ntitle: Welcome to Kasten\n---\nHello.\n" };

  it("opens the welcome page when nothing else was asked for", async () => {
    useWorkspace.setState({ ...derive(initialLayout()), stack: [], stackOpen: false, recent: [], navigated: false });
    await state().connect({ client: new MemoryVault(WELCOME) });
    expect(state().place).toEqual({ view: "page", path: "library/welcome.md" });
  });

  it("opens the welcome page by its KastenFlow title too", async () => {
    useWorkspace.setState({ ...derive(initialLayout()), stack: [], stackOpen: false, recent: [], navigated: false });
    await state().connect({ client: new MemoryVault({ ...SEED, "library/tour.md": "---\ntitle: Welcome to KastenFlow\n---\nHello.\n" }) });
    expect(state().place).toEqual({ view: "page", path: "library/tour.md" });
  });

  it("stays where a person went while the vault was being read", async () => {
    useWorkspace.setState({ ...derive(initialLayout()), stack: [], stackOpen: false, recent: [], navigated: false });
    const vault = new MemoryVault(WELCOME);
    const list = vault.list.bind(vault);
    let release: () => void = () => {};
    vault.list = async () => {
      await new Promise<void>((r) => (release = r));
      return list();
    };
    const connecting = state().connect({ client: vault });
    // Home, clicked before the list came.
    state().go({ view: "home" });
    release();
    await connecting;
    expect(state().place.view).toBe("home");
  });
});
