import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { usePeek } from "../../features/peek/store";
import { usePrefs } from "../../features/workspace/prefs";
import { MemoryVault } from "../../features/workspace/preview/memory-vault";
import { loadNotePage } from "../../features/workspace/page/LazyNotePage";
import { derive } from "../../features/workspace/store-layout";
import { useWorkspace } from "../../features/workspace/store";
import { initialLayout } from "../../features/workspace/tabs";
import { AppShell } from "../AppShell";

const SEED = {
  "library/plan.md": "---\ntitle: Plan\n---\nThe plan, with [[Other]] in it.\n",
  "library/notes.md": "---\ntitle: Notes\n---\nSome notes.\n",
  "library/other.md": "---\ntitle: Other\n---\nAnother page.\n",
};

beforeAll(async () => { await loadNotePage(); }, 60_000);

async function shell() {
  render(<AppShell connect={async () => ({ client: new MemoryVault(SEED) })} />);
  await screen.findByRole("navigation", { name: "Sidebar" });
  await act(async () => useWorkspace.getState().openPath("library/notes.md"));
}

beforeEach(() => {
  localStorage.clear();
  useWorkspace.setState({ ...derive(initialLayout()), notes: [], recent: [], stack: [], stackOpen: false });
  usePeek.setState({ peek: null });
  usePrefs.getState().set({ peekMode: "center" });
});
afterEach(cleanup);

describe("page peeks", () => {
  it("peeks at a page in the center, and closes with Escape", async () => {
    await shell();
    await act(async () => useWorkspace.getState().openPath("library/plan.md", "peek"));
    const peek = await screen.findByRole("dialog", { name: "Page peek" });
    expect(peek.querySelector(".kasten-peek-title")?.textContent).toContain("Plan");
    // The view behind stays where it was.
    expect(useWorkspace.getState().place.path).toBe("library/notes.md");
    await act(async () => fireEvent.keyDown(document, { key: "Escape" }));
    expect(screen.queryByRole("dialog", { name: "Page peek" })).toBeNull();
  });

  it("follows a link inside the peek in the peek, keeping the page behind", async () => {
    await shell();
    await act(async () => useWorkspace.getState().openPath("library/plan.md", "peek"));
    const peek = await screen.findByRole("dialog", { name: "Page peek" });
    const link = await vi.waitFor(() => peek.querySelector<HTMLElement>(".kasten-mention") ?? Promise.reject(new Error("no link yet")), { timeout: 10_000 });
    await act(async () => link.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })));
    expect(usePeek.getState().peek).toEqual({ path: "library/other.md", mode: "center" });
    expect(useWorkspace.getState().place.path).toBe("library/notes.md");
  });

  it("moves to the side, closes on a press behind it, and opens as a full page", async () => {
    await shell();
    await act(async () => useWorkspace.getState().openPath("library/plan.md", "peek"));
    await act(async () => fireEvent.click(await screen.findByRole("button", { name: "Open in side peek" })));
    expect(usePeek.getState().peek).toEqual({ path: "library/plan.md", mode: "side" });
    const pane = screen.getAllByRole("region", { name: "Pane" })[0]!;
    await act(async () => fireEvent.pointerDown(pane));
    expect(usePeek.getState().peek).toBeNull();

    await act(async () => useWorkspace.getState().openPath("library/plan.md", "peek"));
    await act(async () => fireEvent.click(await screen.findByRole("button", { name: "Open as full page" })));
    expect(usePeek.getState().peek).toBeNull();
    expect(useWorkspace.getState().place).toEqual({ view: "page", path: "library/plan.md" });
  });

  it("opens the page in place when Settings asks for full pages", async () => {
    usePrefs.getState().set({ peekMode: "full" });
    await shell();
    await act(async () => useWorkspace.getState().openPath("library/plan.md", "peek"));
    expect(usePeek.getState().peek).toBeNull();
    expect(useWorkspace.getState().place.path).toBe("library/plan.md");
  });

  it("goes back with the mouse's back button, closing a peek first", async () => {
    await shell();
    await act(async () => useWorkspace.getState().openPath("library/plan.md"));
    await act(async () => useWorkspace.getState().openPath("library/notes.md", "peek"));
    await act(async () => fireEvent.mouseUp(window, { button: 3 }));
    expect(usePeek.getState().peek).toBeNull();
    expect(useWorkspace.getState().place.path).toBe("library/plan.md");
    await act(async () => fireEvent.mouseUp(window, { button: 3 }));
    expect(useWorkspace.getState().place.path).toBe("library/notes.md");
    await act(async () => fireEvent.mouseUp(window, { button: 4 }));
    expect(useWorkspace.getState().place.path).toBe("library/plan.md");
  });

  it("opens a deck as a full tab, never in a peek", async () => {
    await shell();
    await act(async () => useWorkspace.getState().openPath("talks/pitch.deck", "peek"));
    expect(usePeek.getState().peek).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Page peek" })).toBeNull();
    expect(useWorkspace.getState().place).toEqual({ view: "slides", path: "talks/pitch.deck" });
    await act(async () => useWorkspace.getState().openPath("talks/other.deck", "peek-side"));
    expect(usePeek.getState().peek).toBeNull();
    expect(useWorkspace.getState().place).toEqual({ view: "slides", path: "talks/other.deck" });
  });

  it("sends a peek that was asked for a deck some other way to a tab, without drawing the page editor", async () => {
    await shell();
    await act(async () => usePeek.getState().open("talks/late.deck", "side"));
    expect(usePeek.getState().peek).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Page peek" })).toBeNull();
    expect(useWorkspace.getState().place).toEqual({ view: "slides", path: "talks/late.deck" });
  });

  it("opens a page in the side peek from the page menu", async () => {
    await shell();
    await act(async () => fireEvent.click(await screen.findByRole("button", { name: "Page options" })));
    await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: /^Open in side peek/ })));
    expect(usePeek.getState().peek).toEqual({ path: "library/notes.md", mode: "side" });
  });
});
