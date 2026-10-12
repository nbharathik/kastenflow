import { beforeEach, describe, expect, it } from "vitest";

import { usePeek } from "../peek/store";
import { MemoryVault } from "./preview/memory-vault";
import { usePrefs } from "./prefs";
import { useWorkspace } from "./store";
import { derive } from "./store-layout";
import { initialLayout } from "./tabs";

const SEED = {
  "library/a.md": "---\ntitle: Alpha\n---\nA\n",
  "library/b.md": "---\ntitle: Beta\n---\nB\n",
  "library/c.md": "---\ntitle: Gamma\n---\nC\n",
};

const state = () => useWorkspace.getState();
const paneTabs = (pane: number) => state().layout.panes[pane]!.tabs.map((t) => t.place.path ?? t.place.view);

beforeEach(async () => {
  localStorage.clear();
  usePrefs.setState({ newTabs: false, peekMode: "center", rightReplaces: true });
  usePeek.setState({ peek: null });
  useWorkspace.setState({ ...derive(initialLayout()), stack: [], stackOpen: false, recent: [], toasts: [] });
  await state().connect({ client: new MemoryVault(SEED) });
});

describe("going to a place", () => {
  it("opens a view's pick in a tab of its own when Full page is chosen and pages open in new tabs", () => {
    usePrefs.getState().set({ newTabs: true, peekMode: "full" });
    state().openPath("library/a.md");
    state().openPath("library/b.md", "peek");
    expect(paneTabs(0)).toEqual(["home", "library/a.md", "library/b.md"]);
    expect(state().place.path).toBe("library/b.md");
    expect(usePeek.getState().peek).toBeNull();
  });

  it("opens a view's pick in the tab you are on when Full page is chosen and new tabs are off", () => {
    usePrefs.getState().set({ newTabs: false, peekMode: "full" });
    state().openPath("library/a.md");
    state().openPath("library/b.md", "peek");
    expect(paneTabs(0)).toEqual(["library/b.md"]);
  });

  it("peeks at a page in the center or the side, as asked", () => {
    state().openPath("library/a.md", "peek-side");
    expect(usePeek.getState().peek).toEqual({ path: "library/a.md", mode: "side" });
    state().openPath("library/b.md", "peek-center");
    expect(usePeek.getState().peek).toEqual({ path: "library/b.md", mode: "center" });
    // Nothing opened behind the peek.
    expect(paneTabs(0)).toEqual(["home"]);
  });

  it("keeps the mode of the peek that is open when a link in it peeks", () => {
    state().openPath("library/a.md", "peek-side");
    state().openPath("library/b.md", "peek");
    expect(usePeek.getState().peek).toEqual({ path: "library/b.md", mode: "side" });
  });

  it("opens a deck as a full tab, never in a peek", () => {
    state().openPath("talks/pitch.deck", "peek");
    expect(usePeek.getState().peek).toBeNull();
    expect(paneTabs(0)).toEqual(["home", "talks/pitch.deck"]);
    expect(state().place).toEqual({ view: "slides", path: "talks/pitch.deck" });
    state().openPath("talks/other.deck", "peek-side");
    expect(usePeek.getState().peek).toBeNull();
    expect(paneTabs(0)).toContain("talks/other.deck");
  });

  it("opens to the right: a pane is made, then the next page replaces the tab there", () => {
    state().openPath("library/a.md");
    state().openPath("library/b.md", "right");
    expect(state().layout.panes).toHaveLength(2);
    expect(paneTabs(0)).toEqual(["library/a.md"]);
    expect(paneTabs(1)).toEqual(["library/b.md"]);
    // From the page on the left again.
    state().focusPane(state().layout.panes[0]!.id);
    state().openPath("library/c.md", "right");
    expect(state().layout.panes).toHaveLength(2);
    expect(paneTabs(1)).toEqual(["library/c.md"]);
    expect(state().place.path).toBe("library/c.md");
    expect(state().recent[0]).toBe("library/c.md");
  });

  it("adds a tab to the right when asked not to replace", () => {
    usePrefs.getState().set({ rightReplaces: false });
    state().openPath("library/a.md");
    state().openPath("library/b.md", "right");
    state().focusPane(state().layout.panes[0]!.id);
    state().openPath("library/c.md", "right");
    expect(paneTabs(1)).toEqual(["library/b.md", "library/c.md"]);
  });
});
