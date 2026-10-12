import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePeek } from "../../features/peek/store";
import { usePrefs } from "../../features/workspace/prefs";
import { MemoryVault } from "../../features/workspace/preview/memory-vault";
import { useWorkspace } from "../../features/workspace/store";
import { derive } from "../../features/workspace/store-layout";
import { initialLayout } from "../../features/workspace/tabs";
import { openMenuHandlers, OpenMenuHost, showOpenMenu } from ".";
import { useOpenMenu } from "./store";

const SEED = {
  "library/a.md": "---\ntitle: Alpha\n---\nA\n",
  "library/b.md": "---\ntitle: Beta\n---\nB\n",
  "library/plan.canvas": '{"nodes":[],"edges":[]}',
};

const state = () => useWorkspace.getState();
const paneTabs = (pane: number) => state().layout.panes[pane]!.tabs.map((t) => t.place.path ?? t.place.view);
const names = () => screen.getAllByRole("menuitem").map((item) => item.textContent ?? "");
/** The item with exactly this label (its hint is not part of it). */
const item = (label: string) => screen.getAllByRole("menuitem").find((el) => el.querySelector("span.flex-1")?.textContent === label)!;

function surface(target: string | { view: "slides"; path: string } = "library/a.md") {
  render(
    <>
      <button type="button" {...openMenuHandlers(target)}>
        Alpha
      </button>
      <OpenMenuHost />
    </>,
  );
  return screen.getByRole("button", { name: "Alpha" });
}

beforeEach(async () => {
  localStorage.clear();
  usePrefs.setState({ newTabs: false, peekMode: "center", rightReplaces: true });
  usePeek.setState({ peek: null });
  useOpenMenu.setState({ menu: null });
  useWorkspace.setState({ ...derive(initialLayout()), stack: [], stackOpen: false, recent: [], toasts: [] });
  await state().connect({ client: new MemoryVault(SEED) });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the Open menu", () => {
  it("shows on right-click, in place of the browser's menu, with the same items everywhere", () => {
    const row = surface();
    expect(fireEvent.contextMenu(row, { clientX: 40, clientY: 50 })).toBe(false);
    const menu = screen.getByRole("menu", { name: "Open" });
    expect(menu).toBeTruthy();
    const labels = ["Open", "Open in new tab", "Open to the right", "Open in side peek", "Open in center peek", "Open in side stack", "Copy link"];
    expect(names()).toHaveLength(labels.length);
    labels.forEach((label, i) => expect(names()[i]!.startsWith(label)).toBe(true));
  });

  it("opens to the right, in a new tab, in a peek and in the stack from its items", () => {
    const row = surface();
    const choose = (name: string) => {
      fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
      fireEvent.click(item(name));
      // Choosing an item closes the menu.
      expect(screen.queryByRole("menu")).toBeNull();
    };
    choose("Open in new tab");
    expect(paneTabs(0)).toEqual(["home", "library/a.md"]);
    choose("Open to the right");
    expect(state().layout.panes).toHaveLength(2);
    expect(paneTabs(1)).toEqual(["library/a.md"]);
    choose("Open in side peek");
    expect(usePeek.getState().peek).toEqual({ path: "library/a.md", mode: "side" });
    choose("Open in center peek");
    expect(usePeek.getState().peek).toEqual({ path: "library/a.md", mode: "center" });
    choose("Open in side stack");
    expect(state().stack).toEqual(["library/a.md"]);
    choose("Open");
    expect(state().place.path).toBe("library/a.md");
  });

  it("copies a link to the page", () => {
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", { value: { writeText: (text: string) => void written.push(text) }, configurable: true });
    const row = surface();
    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole("menuitem", { name: /^Copy link/ }));
    expect(written).toEqual(["[[Alpha]]"]);
    expect(state().toasts.at(-1)!.text).toBe("Link copied");
  });

  it("links a whiteboard by its path, and offers a deck no peek", () => {
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", { value: { writeText: (text: string) => void written.push(text) }, configurable: true });
    const row = surface("library/plan.canvas");
    fireEvent.contextMenu(row);
    expect(screen.getByRole("menuitem", { name: /side peek/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: /^Copy link/ }));
    expect(written).toEqual(["[[library/plan.canvas]]"]);
    cleanup();

    const deck = surface("talks/pitch.deck");
    fireEvent.contextMenu(deck);
    expect(screen.queryByRole("menuitem", { name: /peek/ })).toBeNull();
    expect(screen.getByRole("menuitem", { name: /to the right/ })).toBeTruthy();
  });

  it("offers no link and no peek for a place that is no page", () => {
    const row = surface({ view: "slides", path: "" });
    fireEvent.contextMenu(row);
    expect(screen.queryByRole("menuitem", { name: /^Copy link/ })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /peek/ })).toBeNull();
  });

  it("opens a tab on a middle click, without a menu", () => {
    const row = surface();
    fireEvent(row, new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }));
    expect(paneTabs(0)).toEqual(["home", "library/a.md"]);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("moves between items with the arrows and closes on Escape, keeping a dialog behind it open", async () => {
    const row = surface();
    fireEvent.contextMenu(row);
    const items = screen.getAllByRole("menuitem");
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(items.at(-1));
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement).toBe(items[0]);
    const behind = vi.fn();
    document.addEventListener("keydown", behind);
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    await act(async () => void document.activeElement!.dispatchEvent(escape));
    document.removeEventListener("keydown", behind);
    expect(screen.queryByRole("menu")).toBeNull();
    // The press that closed it was marked handled, so a dialog behind stays.
    expect(escape.defaultPrevented).toBe(true);
  });

  it("closes on a press outside it, and a second right-click moves it", () => {
    const row = surface();
    fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    fireEvent.contextMenu(row, { clientX: 90, clientY: 90 });
    expect(screen.getAllByRole("menu")).toHaveLength(1);
    expect(useOpenMenu.getState().menu).toMatchObject({ x: 90, y: 90 });
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("can be shown from a handler of one's own", () => {
    render(
      <>
        <div data-testid="x" onContextMenu={(e) => showOpenMenu(e, "library/b.md")} />
        <OpenMenuHost />
      </>,
    );
    fireEvent.contextMenu(screen.getByTestId("x"));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Open to the right/ }));
    expect(paneTabs(1)).toEqual(["library/b.md"]);
  });
});
