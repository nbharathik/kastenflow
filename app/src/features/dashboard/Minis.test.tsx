// The Whiteboards and Decks cards on Home and on a project's home: at most
// four, newest first, as compact rows; "Show all N" in place, remembered per
// list; the count in the head stays the real total.

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BoardInfo, DeckInfo, NoteMeta } from "../../lib/vault/types";
import { useBoards } from "../boards/store";
import { ThumbCard } from "../home/ThumbCards";
import { ProjectSection } from "../projects/ProjectSections";
import { useDecks } from "../slides/store";
import { useFlags } from "../workspace/flags";
import { usePrefs } from "../workspace/prefs";
import { useWorkspace } from "../workspace/store";
import { derive } from "../workspace/store-layout";
import { initialLayout } from "../workspace/tabs";
import { CARD_LIMIT, newest } from "./Minis";

const project = (folder: string): NoteMeta =>
  ({ path: `projects/${folder}/_project.md`, id: folder, title: folder, kind: "project", icon: null, cover: null, parent: null, project: folder, tags: [], modified: 1, created: null, updated: null, excerpt: "", words: 0, props: {}, locked: false }) as NoteMeta;

const DEMO = project("demo");
const OTHER = project("other");

const board = (project: string, i: number, extra: Partial<BoardInfo> = {}): BoardInfo => ({ path: `projects/${project}/boards/b${i}.canvas`, title: `Board ${project} ${i}`, project, nodes: i, modified: 1000 + i, ...extra });
const deck = (project: string, i: number): DeckInfo => ({ path: `projects/${project}/talks/d${i}.deck`, title: `Deck ${project} ${i}`, project, modified: 2000 + i, slides: 3, problem: null }) as DeckInfo;

const many = <T,>(make: (i: number) => T, n: number): T[] => Array.from({ length: n }, (_, i) => make(i));

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  localStorage.clear();
  useFlags.setState({ on: [] });
  usePrefs.setState({ newTabs: false });
  useBoards.setState({ list: [], loaded: true, creating: false, draftProject: null, onlyProject: null });
  useDecks.setState({ list: [], loaded: true, creating: false, draftProject: null });
  useWorkspace.setState({ client: null, notes: [DEMO, OTHER], ...derive(initialLayout()), stack: [], stackOpen: false, recent: [], toasts: [] });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const rows = (region: HTMLElement) => within(region).queryAllByRole("button", { name: /^(Board|Deck) / });
const titles = (region: HTMLElement) => rows(region).map((r) => r.querySelector(".kasten-mini-title")?.textContent);

describe("a project's Whiteboards card", () => {
  it("shows the four most recently edited as compact rows, and the real total", () => {
    // Nine boards, edited in a scrambled order, and one of another project.
    const demo = many((i) => board("demo", i), 9).sort((a, b) => ((a.nodes * 7) % 9) - ((b.nodes * 7) % 9));
    useBoards.setState({ list: [...demo, board("other", 1)] });
    render(<ProjectSection id="boards" project={DEMO} folder="demo" />);
    const card = screen.getByRole("region", { name: "Whiteboards" });
    expect(titles(card)).toEqual(["Board demo 8", "Board demo 7", "Board demo 6", "Board demo 5"]);
    expect(within(card).getByText("9")).toBeTruthy();
    expect(rows(card)).toHaveLength(CARD_LIMIT);
    for (const row of rows(card)) {
      expect(row.classList.contains("kasten-mini")).toBe(true);
      // One line: the full title is on the row for when it is cut short.
      expect(row.getAttribute("title")).toBeTruthy();
    }
    expect(within(card).getByRole("button", { name: "Show all 9" })).toBeTruthy();
  });

  it("shows all of them in place, and remembers that for this project only", () => {
    useBoards.setState({ list: [...many((i) => board("demo", i), 7), ...many((i) => board("other", i), 7)] });
    const view = render(<ProjectSection id="boards" project={DEMO} folder="demo" />);
    fireEvent.click(screen.getByRole("button", { name: "Show all 7" }));
    expect(rows(screen.getByRole("region", { name: "Whiteboards" }))).toHaveLength(7);
    expect(screen.getByRole("button", { name: "Show fewer" })).toBeTruthy();
    // The window remembers: a new visit starts expanded.
    view.unmount();
    expect(JSON.parse(localStorage.getItem("kasten.flags")!)).toEqual(["all:boards:demo"]);
    render(<ProjectSection id="boards" project={DEMO} folder="demo" />);
    expect(rows(screen.getByRole("region", { name: "Whiteboards" }))).toHaveLength(7);
    cleanup();
    // Another project keeps its own.
    render(<ProjectSection id="boards" project={OTHER} folder="other" />);
    expect(rows(screen.getByRole("region", { name: "Whiteboards" }))).toHaveLength(CARD_LIMIT);
    cleanup();
    render(<ProjectSection id="boards" project={DEMO} folder="demo" />);
    fireEvent.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(rows(screen.getByRole("region", { name: "Whiteboards" }))).toHaveLength(CARD_LIMIT);
    expect(JSON.parse(localStorage.getItem("kasten.flags")!)).toEqual([]);
  });

  it("has nothing to expand with four or fewer", () => {
    useBoards.setState({ list: many((i) => board("demo", i), CARD_LIMIT) });
    render(<ProjectSection id="boards" project={DEMO} folder="demo" />);
    expect(rows(screen.getByRole("region", { name: "Whiteboards" }))).toHaveLength(CARD_LIMIT);
    expect(screen.queryByRole("button", { name: /^Show / })).toBeNull();
  });

  it("links to the Whiteboards view with only this project's boards", () => {
    useBoards.setState({ list: many((i) => board("demo", i), 6) });
    render(<ProjectSection id="boards" project={DEMO} folder="demo" />);
    fireEvent.click(screen.getByRole("button", { name: /^All whiteboards/ }));
    expect(useWorkspace.getState().place).toEqual({ view: "boards" });
    expect(useBoards.getState().onlyProject).toBe("demo");
  });

  it("opens a board, and still says when there are none", () => {
    useBoards.setState({ list: [board("demo", 1)] });
    render(<ProjectSection id="boards" project={DEMO} folder="demo" />);
    fireEvent.click(screen.getByRole("button", { name: /^Board demo 1/ }));
    expect(useWorkspace.getState().place).toEqual({ view: "boards", path: "projects/demo/boards/b1.canvas" });
    cleanup();
    useBoards.setState({ list: [] });
    render(<ProjectSection id="boards" project={DEMO} folder="demo" />);
    expect(screen.getByText(/No whiteboards yet/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^All whiteboards/ })).toBeNull();
  });
});

describe("Home's Whiteboards card", () => {
  it("shows the four newest, the real total, and Show all", () => {
    useBoards.setState({ list: [...many((i) => board("demo", i), 5), ...many((i) => board("other", i), 5)] });
    render(<ThumbCard id="boards" />);
    const card = screen.getByRole("region", { name: "Whiteboards" });
    expect(rows(card)).toHaveLength(CARD_LIMIT);
    expect(within(card).getByText("10")).toBeTruthy();
    // Newest first across projects: boards edited at the same time by path.
    expect(titles(card)).toEqual(["Board demo 4", "Board other 4", "Board demo 3", "Board other 3"]);
    fireEvent.click(within(card).getByRole("button", { name: "Show all 10" }));
    expect(rows(card)).toHaveLength(10);
    expect(JSON.parse(localStorage.getItem("kasten.flags")!)).toEqual(["all:boards:home"]);
  });
});

describe("the Decks cards", () => {
  it("show four decks with Show all, on Home and on a project's home", () => {
    useDecks.setState({ list: [...many((i) => deck("demo", i), 6), deck("other", 0)] });
    const view = render(<ThumbCard id="decks" />);
    let card = screen.getByRole("region", { name: "Decks" });
    expect(rows(card)).toHaveLength(CARD_LIMIT);
    expect(within(card).getByText("7")).toBeTruthy();
    expect(titles(card)[0]).toBe("Deck demo 5");
    fireEvent.click(within(card).getByRole("button", { name: "Show all 7" }));
    expect(rows(card)).toHaveLength(7);
    view.unmount();

    render(<ProjectSection id="decks" project={DEMO} folder="demo" />);
    card = screen.getByRole("region", { name: "Decks" });
    expect(titles(card)).toEqual(["Deck demo 5", "Deck demo 4", "Deck demo 3", "Deck demo 2"]);
    expect(within(card).getByText("6")).toBeTruthy();
    // Home's expansion is its own.
    fireEvent.click(within(card).getByRole("button", { name: "Show all 6" }));
    expect(rows(card)).toHaveLength(6);
    expect(JSON.parse(localStorage.getItem("kasten.flags")!)).toEqual(["all:decks:home", "all:decks:demo"]);
    act(() => within(card).getByRole("button", { name: /^All decks/ }).click());
    expect(useWorkspace.getState().place).toEqual({ view: "slides" });
  });
});

describe("newest first", () => {
  it("orders by time, then by path, and leaves the list as it was", () => {
    const list = [board("a", 1, { modified: 5 }), board("a", 2, { modified: 9 }), board("b", 1, { modified: 5 })];
    expect(newest(list).map((b) => b.path)).toEqual(["projects/a/boards/b2.canvas", "projects/a/boards/b1.canvas", "projects/b/boards/b1.canvas"]);
    expect(list[0]!.modified).toBe(5);
  });
});
