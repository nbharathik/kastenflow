import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useBoards } from "../features/boards/store";
import { useDecks } from "../features/slides/store";
import { usePrefs } from "../features/workspace/prefs";
import { useWorkspace } from "../features/workspace/store";
import { derive } from "../features/workspace/store-layout";
import { initialLayout } from "../features/workspace/tabs";
import { NewTabButton } from "./NewTab";

const state = () => useWorkspace.getState();
const paneTabs = (pane: number) => state().layout.panes[pane]!.tabs.map((t) => t.place.path ?? t.place.view);
/** The menu's items, plain and switches alike (a role pattern is not matched by name). */
const items = () => [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
const item = (label: string) => items().find((el) => el.querySelector("span.flex-1")?.textContent === label)!;

beforeEach(() => {
  localStorage.clear();
  usePrefs.setState({ plusOpensRight: false, newTabs: false });
  useDecks.setState({ creating: false, draftProject: null });
  useBoards.setState({ creating: false, draftProject: null });
  useWorkspace.setState({ ...derive(initialLayout()), notes: [], recent: [], stack: [], stackOpen: false });
  render(<NewTabButton />);
});
afterEach(cleanup);

describe("the new tab button", () => {
  it("makes a Home tab on a plain click, here or to the right as the switch says", () => {
    fireEvent.click(screen.getByRole("button", { name: "New tab" }));
    // Home is already open in the first pane: it is selected, not doubled.
    expect(paneTabs(0)).toEqual(["home"]);
    act(() => state().go({ view: "inbox" }, "tab"));
    expect(paneTabs(0)).toEqual(["home", "inbox"]);
    usePrefs.setState({ plusOpensRight: true });
    fireEvent.click(screen.getByRole("button", { name: "New tab" }));
    expect(state().layout.panes).toHaveLength(2);
    expect(paneTabs(1)).toEqual(["home"]);
  });

  it("shows its menu on right-click and from the small arrow, with the ways to start", () => {
    fireEvent.contextMenu(screen.getByRole("button", { name: "New tab" }), { clientX: 30, clientY: 20 });
    const menu = screen.getByRole("menu", { name: "New tab" });
    expect(menu).toBeTruthy();
    const labels = items().map((el) => el.querySelector("span.flex-1")?.textContent);
    expect(labels).toEqual(["New page", "New page to the right", "Today's journal", "Journal to the right", "Slides", "New deck", "New whiteboard", "Graph", "New tabs open to the right"]);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();

    const arrow = screen.getByRole("button", { name: "More ways to start a tab" });
    expect(arrow.getAttribute("aria-haspopup")).toBe("menu");
    fireEvent.click(arrow);
    expect(arrow.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("menu", { name: "New tab" })).toBeTruthy();
    // The arrow closes it again.
    fireEvent.click(arrow);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("starts pages and journal days in a new tab or to the right", () => {
    const choose = (label: string) => {
      fireEvent.contextMenu(screen.getByRole("button", { name: "New tab" }));
      fireEvent.click(item(label));
    };
    choose("New page");
    expect(paneTabs(0)).toHaveLength(2);
    expect(state().place.view).toBe("page");
    choose("New page to the right");
    expect(state().layout.panes).toHaveLength(2);
    expect(state().place.view).toBe("page");
    // Back on the left, the next one goes to the right again, replacing the tab there.
    act(() => state().focusPane(state().layout.panes[0]!.id));
    choose("Journal to the right");
    expect(state().layout.panes).toHaveLength(2);
    expect(state().place.view).toBe("journal");
    expect(state().layout.focus).toBe(state().layout.panes[1]!.id);
    choose("Today's journal");
    expect(state().place.view).toBe("journal");
  });

  it("opens the Slides view, a new deck form and a new whiteboard form in a new tab", () => {
    const choose = (label: string) => {
      fireEvent.contextMenu(screen.getByRole("button", { name: "New tab" }));
      fireEvent.click(item(label));
    };
    choose("Slides");
    expect(state().place).toEqual({ view: "slides" });
    expect(paneTabs(0)).toEqual(["home", "slides"]);
    choose("New deck");
    expect(useDecks.getState().creating).toBe(true);
    expect(paneTabs(0)).toEqual(["home", "slides"]);
    act(() => state().selectTab(state().layout.panes[0]!.id, state().layout.panes[0]!.tabs[0]!.id));
    choose("New whiteboard");
    expect(useBoards.getState().creating).toBe(true);
    expect(state().place.view).toBe("boards");
    expect(paneTabs(0)).toEqual(["home", "boards", "slides"]);
  });

  it("opens the Graph in a new tab", () => {
    fireEvent.contextMenu(screen.getByRole("button", { name: "New tab" }));
    fireEvent.click(item("Graph"));
    expect(state().place).toEqual({ view: "graph" });
    expect(paneTabs(0)).toEqual(["home", "graph"]);
  });

  it("holds the switch for new tabs to the right, ticked when on", () => {
    fireEvent.contextMenu(screen.getByRole("button", { name: "New tab" }));
    expect(item("New tabs open to the right").getAttribute("aria-checked")).toBe("false");
    fireEvent.click(item("New tabs open to the right"));
    expect(usePrefs.getState().plusOpensRight).toBe(true);
    fireEvent.contextMenu(screen.getByRole("button", { name: "New tab" }));
    expect(item("New tabs open to the right").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(item("New tabs open to the right"));
    expect(usePrefs.getState().plusOpensRight).toBe(false);
  });
});
