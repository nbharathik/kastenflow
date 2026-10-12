// Decks on Home and on a project's home: the New menu's deck, a card of the
// newest ones, and decks among Home's recent things.

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OpenMenuHost } from "../../shell/open-menu";
import type { DeckInfo, NoteMeta } from "../../lib/vault/types";
import { HOME_DEFAULT, HOME_SECTIONS } from "../home/sections";
import { HomeSectionView } from "../home/HomeSections";
import { NewMenu } from "../home/NewMenu";
import { ThumbCard } from "../home/ThumbCards";
import { PROJECT_DEFAULT, PROJECT_SECTIONS, projectHome } from "../projects/home";
import { partsOf } from "../projects/project-data";
import { ProjectSection } from "../projects/ProjectSections";
import { useDecks } from "../slides/store";
import { usePrefs } from "../workspace/prefs";
import { useWorkspace } from "../workspace/store";
import { derive } from "../workspace/store-layout";
import { initialLayout } from "../workspace/tabs";

const deck = (path: string, title: string, project: string | null, modified: number): DeckInfo => ({ path, title, project, modified, slides: 3, problem: null }) as DeckInfo;

const DECKS = [
  deck("projects/demo/talks/pitch.deck", "Pitch", "demo", 30),
  deck("projects/demo/talks/review.deck", "Review", "demo", 20),
  deck("library/loose.deck", "Loose talk", null, 10),
];

const PROJECT = {
  path: "projects/demo/_project.md",
  id: "p",
  title: "Demo project",
  kind: "project",
  icon: null,
  cover: null,
  parent: null,
  project: "demo",
  tags: [],
  modified: 1,
  created: null,
  updated: null,
  excerpt: "",
  words: 0,
  props: {},
  locked: false,
} as NoteMeta;

const state = () => useWorkspace.getState();

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  localStorage.clear();
  usePrefs.setState({ newTabs: false });
  useDecks.setState({ list: DECKS, loaded: true, creating: false, draftProject: null });
  useWorkspace.setState({ client: null, notes: [PROJECT], ...derive(initialLayout()), stack: [], stackOpen: false, recent: [], toasts: [] });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("starting a deck from Home", () => {
  it("is one of the ways in the New menu, and opens the Slides view on its form", () => {
    render(<NewMenu />);
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^New deck/ }));
    expect(state().place).toEqual({ view: "slides" });
    expect(useDecks.getState().creating).toBe(true);
    expect(useDecks.getState().draftProject).toBeNull();
  });
});

describe("the Decks card of Home", () => {
  it("is one of the sections Customize offers, and off until it is turned on", () => {
    expect(HOME_DEFAULT).not.toContain("decks");
    expect(HOME_SECTIONS.find((s) => s.id === "decks")).toMatchObject({ label: "Decks", icon: "present", zone: "side" });
  });

  it("shows the newest decks as compact rows with a count, and opens one", () => {
    render(<ThumbCard id="decks" />);
    const section = screen.getByRole("region", { name: "Decks" });
    const tiles = within(section).getAllByRole("button", { name: /^(Pitch|Review|Loose talk)/ });
    expect(tiles.map((t) => t.querySelector(".kasten-mini-title")?.textContent?.trim())).toEqual(["Pitch", "Review", "Loose talk"]);
    expect(within(section).getAllByText(/3 slides · /)).toHaveLength(3);
    fireEvent.click(tiles[1]!);
    expect(state().place).toEqual({ view: "slides", path: "projects/demo/talks/review.deck" });
  });

  it("goes to all of them", () => {
    render(<ThumbCard id="decks" />);
    fireEvent.click(screen.getByRole("button", { name: /^All decks/ }));
    expect(state().place).toEqual({ view: "slides" });
  });

  it("shows nothing while there are no decks", () => {
    useDecks.setState({ list: [] });
    render(<ThumbCard id="decks" />);
    expect(screen.queryByRole("region", { name: "Decks" })).toBeNull();
  });

  it("loads when Home asks for it", async () => {
    render(<HomeSectionView id="decks" />);
    expect(await screen.findByRole("region", { name: "Decks" }, { timeout: 20_000 })).toBeTruthy();
  });

  it("gives a deck the Open menu, without a peek", () => {
    render(
      <>
        <ThumbCard id="decks" />
        <OpenMenuHost />
      </>,
    );
    fireEvent.contextMenu(screen.getAllByRole("button", { name: /^Pitch/ })[0]!);
    const labels = within(screen.getByRole("menu", { name: "Open" })).getAllByRole("menuitem").map((el) => el.querySelector("span.flex-1")?.textContent);
    expect(labels).toEqual(["Open", "Open in new tab", "Open to the right", "Open in side stack", "Copy link"]);
    fireEvent.click(screen.getByRole("menuitem", { name: /^Open to the right/ }));
    expect(state().layout.panes).toHaveLength(2);
    expect(state().place).toEqual({ view: "slides", path: "projects/demo/talks/pitch.deck" });
  });
});

describe("a deck among Home's recent things", () => {
  it("shows a deck opened lately, and opens it", () => {
    useWorkspace.setState({ recent: ["projects/demo/talks/review.deck"] });
    render(<HomeSectionView id="recent" />);
    const row = screen.getByRole("button", { name: /^Review/ });
    expect(row.textContent).toContain("Deck");
    fireEvent.click(row);
    expect(state().place).toEqual({ view: "slides", path: "projects/demo/talks/review.deck" });
  });

  it("leaves out a deck that is gone", () => {
    useWorkspace.setState({ recent: ["projects/demo/talks/gone.deck"] });
    render(<HomeSectionView id="recent" />);
    expect(screen.queryByRole("button", { name: /gone/ })).toBeNull();
  });
});

describe("a project's decks", () => {
  it("is offered, but not shown unless the project's home asks for it", () => {
    expect(PROJECT_SECTIONS.find((s) => s.id === "decks")).toMatchObject({ label: "Decks" });
    expect(PROJECT_DEFAULT).not.toContain("decks");
    expect(projectHome({ home: ["summary", "decks"] }).sections).toEqual(["summary", "decks"]);
  });

  it("collects the decks of the project, newest first", () => {
    const parts = partsOf([PROJECT], [], PROJECT, DECKS);
    expect(parts.decks.map((d) => d.title)).toEqual(["Pitch", "Review"]);
    expect(partsOf([PROJECT], [], PROJECT).decks).toEqual([]);
    expect(parts.edited).toBe(30);
  });

  it("shows them with a + that starts one in this project", () => {
    render(<ProjectSection id="decks" project={PROJECT} folder="demo" />);
    const section = screen.getByRole("region", { name: "Decks" });
    expect(within(section).getAllByRole("button", { name: /^(Pitch|Review)/ })).toHaveLength(2);
    expect(within(section).queryByRole("button", { name: /Loose talk/ })).toBeNull();
    act(() => within(section).getByRole("button", { name: "New deck in this project" }).click());
    expect(state().place).toEqual({ view: "slides" });
    expect(useDecks.getState().draftProject).toBe("demo");
  });

  it("says so when it has none", () => {
    useDecks.setState({ list: [DECKS[2]!] });
    render(<ProjectSection id="decks" project={PROJECT} folder="demo" />);
    expect(screen.getByText(/No decks yet/)).toBeTruthy();
  });
});
