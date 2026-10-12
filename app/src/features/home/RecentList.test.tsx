// Home's Recent: the list, its chips, the project and text filters, what is
// remembered, the keys, and what it says when there is nothing to show.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useShell } from "../../lib/store";
import type { BoardInfo, DeckInfo, DiagramInfo, NoteMeta } from "../../lib/vault/types";
import { OpenMenuHost } from "../../shell/open-menu";
import { useBoards } from "../boards/store";
import { useDiagrams } from "../diagrams/store";
import { useDecks } from "../slides/store";
import { usePrefs } from "../workspace/prefs";
import { useWorkspace } from "../workspace/store";
import { derive } from "../workspace/store-layout";
import { initialLayout } from "../workspace/tabs";
import { RecentList } from "./RecentList";

const NOW = Date.now();
const MIN = 60_000;

const note = (path: string, title: string, over: Partial<NoteMeta> = {}): NoteMeta => ({
  path,
  id: null,
  title,
  kind: "page",
  icon: null,
  cover: null,
  parent: null,
  project: null,
  tags: [],
  modified: NOW - 90 * MIN,
  created: null,
  updated: null,
  excerpt: "",
  words: 0,
  props: {},
  locked: false,
  ...over,
});
const board = (path: string, title: string, minutes: number, project: string | null = null): BoardInfo => ({ path, title, project, nodes: 2, modified: NOW - minutes * MIN });
const deck = (path: string, title: string, minutes: number): DeckInfo => ({ path, title, project: null, slides: 3, modified: NOW - minutes * MIN, size: 1, problem: null });
const diagram = (path: string, title: string, minutes: number): DiagramInfo => ({ path, title, project: null, pages: 1, modified: NOW - minutes * MIN, size: 1, preview: "fresh", problem: null });

const TRIP = note("projects/trip/_project.md", "Trip", { kind: "project", project: "trip", id: "T", modified: NOW - 500 * MIN });
const NOTES = [
  TRIP,
  note("projects/trip/pages/roadmap.md", "Roadmap", { project: "trip", modified: NOW - 5 * MIN }),
  note("library/ideas.md", "Ideas", { modified: NOW - 30 * MIN }),
  note("inbox/call.md", "Call the printer", { kind: "card", modified: NOW - 20 * MIN }),
];
const BOARDS = [board("projects/trip/launch.canvas", "Launch plan", 10, "trip")];
const DECKS = [deck("library/pitch.deck", "Pitch", 15)];

const state = () => useWorkspace.getState();
const rows = () => within(screen.getByRole("list", { name: "Recent items" })).getAllByRole("button");
const titles = () => rows().map((r) => r.querySelector(".kasten-home-row-title")?.textContent);
const chip = (name: string) => within(screen.getByRole("group", { name: "Show" })).getByRole("button", { name });

function setup(over: { notes?: NoteMeta[]; boards?: BoardInfo[]; decks?: DeckInfo[]; diagrams?: DiagramInfo[]; recent?: string[]; ready?: boolean } = {}) {
  useBoards.setState({ list: over.boards ?? BOARDS, loaded: true });
  useDecks.setState({ list: over.decks ?? DECKS, loaded: true });
  useDiagrams.setState({ list: over.diagrams ?? [], loaded: true });
  useWorkspace.setState({ client: null, notes: over.notes ?? NOTES, recent: over.recent ?? [], ready: over.ready ?? true, ...derive(initialLayout()), stack: [], stackOpen: false, toasts: [] });
  return render(
    <>
      <RecentList />
      <OpenMenuHost />
    </>,
  );
}

beforeEach(() => {
  localStorage.clear();
  usePrefs.setState({ homeFilter: "all", homeProject: null, homeLayout: "list", newTabs: false });
  useShell.setState({ paletteOpen: false, paletteQuery: "" });
});
afterEach(cleanup);

describe("Home's recent list", () => {
  it("lists what changed last first, each with its kind, project and how long ago", () => {
    setup();
    expect(titles()).toEqual(["Roadmap", "Launch plan", "Pitch", "Call the printer", "Ideas", "Trip"]);
    const roadmap = rows()[0]!;
    expect(roadmap.textContent).toContain("Page");
    expect(roadmap.querySelector(".kasten-home-row-project")?.textContent).toBe("Trip");
    expect(roadmap.querySelector(".kasten-home-row-time")?.textContent).toBe("5m");
    expect(rows()[1]!.textContent).toContain("Whiteboard");
    expect(rows()[2]!.textContent).toContain("Deck");
    expect(rows()[3]!.textContent).toContain("Card");
  });

  it("leads with what was opened lately", () => {
    setup({ recent: ["library/ideas.md"] });
    expect(titles().slice(0, 2)).toEqual(["Ideas", "Roadmap"]);
  });

  it("opens a row where its thing is", () => {
    setup();
    fireEvent.click(within(screen.getByRole("list", { name: "Recent items" })).getByRole("button", { name: /^Launch plan/ }));
    expect(state().place).toEqual({ view: "boards", path: "projects/trip/launch.canvas" });
    fireEvent.click(within(screen.getByRole("list", { name: "Recent items" })).getByRole("button", { name: /^Pitch/ }));
    expect(state().place).toEqual({ view: "slides", path: "library/pitch.deck" });
  });

  it("gives a row the Open menu on a right-click", () => {
    setup();
    fireEvent.contextMenu(rows()[0]!);
    const labels = within(screen.getByRole("menu", { name: "Open" })).getAllByRole("menuitem").map((el) => el.querySelector("span.flex-1")?.textContent);
    expect(labels.slice(0, 3)).toEqual(["Open", "Open in new tab", "Open to the right"]);
  });
});

describe("the chips", () => {
  it("narrow the list to one kind, and the choice is remembered", () => {
    const first = setup();
    expect(chip("All").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(chip("Boards"));
    expect(titles()).toEqual(["Launch plan"]);
    expect(usePrefs.getState().homeFilter).toBe("board");
    expect(JSON.parse(localStorage.getItem("kasten.prefs")!).homeFilter).toBe("board");
    first.unmount();
    setup();
    expect(chip("Boards").getAttribute("aria-pressed")).toBe("true");
    expect(titles()).toEqual(["Launch plan"]);
    fireEvent.click(chip("Cards"));
    expect(titles()).toEqual(["Call the printer"]);
    fireEvent.click(chip("All"));
    expect(titles()).toHaveLength(6);
  });

  it("leave out a kind there is none of, until there is one", () => {
    const first = setup();
    const shown = () => within(screen.getByRole("group", { name: "Show" })).getAllByRole("button").map((b) => b.textContent);
    expect(shown()).toEqual(["All", "Pages", "Cards", "Boards", "Decks"]);
    first.unmount();
    setup({ diagrams: [diagram("library/flow.drawio", "Flow", 3)], notes: [...NOTES, note("inbox/clip.md", "A clip", { kind: "card", tags: ["capture"] })] });
    expect(shown()).toEqual(["All", "Pages", "Cards", "Boards", "Decks", "Diagrams", "Captures"]);
    fireEvent.click(chip("Diagrams"));
    expect(titles()).toEqual(["Flow"]);
    fireEvent.click(chip("Captures"));
    expect(titles()).toEqual(["A clip"]);
  });

  it("come back as they were, even when what they show is gone", () => {
    usePrefs.getState().set({ homeFilter: "diagram" });
    setup();
    expect(chip("Diagrams").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("status").textContent).toContain("No diagrams yet.");
    fireEvent.click(screen.getByRole("button", { name: "Show everything" }));
    expect(usePrefs.getState().homeFilter).toBe("all");
    expect(titles()).toHaveLength(6);
  });

  it("ignore a remembered name they do not know", () => {
    usePrefs.setState({ homeFilter: "sideways" });
    setup();
    expect(chip("All").getAttribute("aria-pressed")).toBe("true");
    expect(titles()).toHaveLength(6);
  });
});

describe("the project and the field", () => {
  it("narrow the list to a project, remembered, and to what is in none", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Project: All projects" }));
    fireEvent.click(screen.getByRole("option", { name: /Trip/ }));
    expect(titles()).toEqual(["Roadmap", "Launch plan", "Trip"]);
    expect(usePrefs.getState().homeProject).toBe("trip");
    expect(screen.getByRole("button", { name: "Project: Trip" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Project: Trip" }));
    fireEvent.click(screen.getByRole("option", { name: /No project/ }));
    expect(titles()).toEqual(["Pitch", "Call the printer", "Ideas"]);
  });

  it("ignore a remembered project that is gone", () => {
    usePrefs.setState({ homeProject: "gone" });
    setup();
    expect(titles()).toHaveLength(6);
  });

  it("have no project list while there are no projects", () => {
    setup({ notes: [note("library/ideas.md", "Ideas")] });
    expect(screen.queryByRole("button", { name: /^Project:/ })).toBeNull();
  });

  it("narrow the list as you type, put the better matches first, and clear with Escape", async () => {
    setup({ notes: [...NOTES, note("library/travel.md", "Plan the travel"), note("library/x.md", "Airplane")] });
    const field = screen.getByRole("textbox", { name: "Filter the list" });
    fireEvent.change(field, { target: { value: "plan" } });
    await waitFor(() => expect(titles()).toEqual(["Plan the travel", "Launch plan", "Airplane"]));
    fireEvent.keyDown(field, { key: "Escape" });
    expect((field as HTMLInputElement).value).toBe("");
    await waitFor(() => expect(titles()).toHaveLength(8));
  });

  it("show how many there are, and search everywhere for the rest", async () => {
    const many = Array.from({ length: 14 }, (_, i) => note(`library/n${i}.md`, `Note ${i}`, { modified: NOW - i * MIN }));
    setup({ notes: many, boards: [], decks: [] });
    expect(titles()).toHaveLength(10);
    expect(screen.getByText("10 of 14")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Filter the list" }), { target: { value: "note" } });
    await waitFor(() => expect(screen.getByText("10 of 14")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Search everywhere" }));
    expect(useShell.getState().paletteOpen).toBe(true);
    expect(useShell.getState().paletteQuery).toBe("note");
  });
});

describe("the keys", () => {
  it("send / to the field from anywhere that is not a field", () => {
    setup();
    const field = screen.getByRole("textbox", { name: "Filter the list" });
    fireEvent.keyDown(document.body, { key: "/" });
    expect(document.activeElement).toBe(field);
    (field as HTMLInputElement).blur();
    const other = document.createElement("input");
    document.body.append(other);
    other.focus();
    fireEvent.keyDown(other, { key: "/" });
    expect(document.activeElement).toBe(other);
    other.remove();
    fireEvent.keyDown(document.body, { key: "/", ctrlKey: true });
    expect(document.activeElement).not.toBe(field);
  });

  it("move through the list with the arrows, from the field and back", () => {
    setup();
    const field = screen.getByRole("textbox", { name: "Filter the list" });
    field.focus();
    fireEvent.keyDown(field, { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows()[0]);
    fireEvent.keyDown(rows()[0]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows()[1]);
    fireEvent.keyDown(rows()[1]!, { key: "End" });
    expect(document.activeElement).toBe(rows()[5]);
    fireEvent.keyDown(rows()[5]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows()[5]);
    fireEvent.keyDown(rows()[5]!, { key: "Home" });
    expect(document.activeElement).toBe(rows()[0]);
    fireEvent.keyDown(rows()[0]!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(field);
  });

  it("have one stop in the list for Tab: the row you were on", () => {
    setup();
    const stops = () => rows().filter((r) => r.tabIndex === 0);
    expect(stops()).toEqual([rows()[0]]);
    act(() => rows()[2]!.focus());
    expect(stops()).toEqual([rows()[2]]);
  });

  it("open the first match with Enter in the field, and a row to the right with Ctrl+Enter", () => {
    setup();
    const field = screen.getByRole("textbox", { name: "Filter the list" });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(state().place).toEqual({ view: "page", path: "projects/trip/pages/roadmap.md" });
    act(() => state().go({ view: "home" }));
    fireEvent.keyDown(rows()[1]!, { key: "Enter", ctrlKey: true });
    expect(state().layout.panes).toHaveLength(2);
    expect(state().place).toEqual({ view: "boards", path: "projects/trip/launch.canvas" });
  });

  it("open the first match to the right with Ctrl+Enter in the field", () => {
    setup();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Filter the list" }), { key: "Enter", ctrlKey: true });
    expect(state().layout.panes).toHaveLength(2);
    expect(state().place).toEqual({ view: "page", path: "projects/trip/pages/roadmap.md" });
  });
});

describe("the layout and what is shown while there is nothing", () => {
  it("switches to a denser grid, remembered", () => {
    setup();
    const list = screen.getByRole("list", { name: "Recent items" });
    expect(list.getAttribute("data-layout")).toBe("list");
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    expect(list.getAttribute("data-layout")).toBe("grid");
    expect(JSON.parse(localStorage.getItem("kasten.prefs")!).homeLayout).toBe("grid");
    expect(screen.getByRole("button", { name: "Grid" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("says in one sentence when nothing matches, and offers everything back", async () => {
    setup();
    fireEvent.change(screen.getByRole("textbox", { name: "Filter the list" }), { target: { value: "zzz" } });
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Nothing matches “zzz”.");
    fireEvent.click(within(status).getByRole("button", { name: "Show everything" }));
    expect((screen.getByRole("textbox", { name: "Filter the list" }) as HTMLInputElement).value).toBe("");
    await waitFor(() => expect(titles()).toHaveLength(6));
  });

  it("says the vault is empty when it is", () => {
    setup({ notes: [], boards: [], decks: [] });
    expect(screen.getByRole("status").textContent).toContain("Nothing here yet.");
    expect(screen.queryByRole("button", { name: "Show everything" })).toBeNull();
  });

  it("holds the rows' places until the vault has answered", () => {
    setup({ notes: [], boards: [], decks: [], ready: false });
    const list = screen.getByRole("list", { name: "Recent items" });
    expect(list.getAttribute("aria-busy")).toBe("true");
    expect(list.querySelectorAll("li")).toHaveLength(10);
    expect(screen.queryByRole("status")).toBeNull();
    expect(within(screen.getByRole("group", { name: "Show" })).getAllByRole("button").map((b) => b.textContent)).toEqual(["All"]);
  });
});
