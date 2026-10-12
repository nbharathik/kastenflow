// The Slides view: a way to start a presentation at once, search and sort, and the decks newest first.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { loadSlides } from "@kasten-slides/wasm";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { DeckInfo, NoteMeta, VaultClient } from "../../lib/vault/types";
import { useWorkspace } from "../workspace/store";
import { SlidesHome } from "./SlidesHome";
import { useDecks } from "./store";

beforeAll(async () => {
  await loadSlides(await readFile(join(import.meta.dirname, "../../../../packages/slides-wasm/pkg/slides_wasm_bg.wasm")));
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 160 });
});

const deck = (title: string, modified: number, project: string | null = null): DeckInfo => ({ path: `library/${title.toLowerCase().replace(/\s+/g, "-")}.deck`, title, project, slides: 4, modified, size: 100, problem: null });
const DECKS = [deck("Tool use", 300), deck("Q3 review", 500, "trip"), deck("Alpha talk", 100), deck("Lecture", 400)];
const NOTES = [{ path: "projects/trip/trip.md", title: "Japan trip", kind: "project", project: "trip" } as unknown as NoteMeta];

function fakeVault(list: DeckInfo[] = DECKS) {
  return {
    decks: vi.fn(async () => list),
    createDeck: vi.fn(async () => "library/untitled-presentation.deck"),
    deck: vi.fn(async () => {
      throw new Error("no preview in a test");
    }),
  } as unknown as VaultClient;
}

beforeEach(() => {
  localStorage.clear();
  useDecks.setState({ list: [], loaded: false, creating: false, draftProject: null });
});
afterEach(() => {
  cleanup();
  useWorkspace.setState({ client: null });
});

/** The titles of the deck cards, in the order they are drawn. */
const order = () => screen.getAllByRole("button", { name: /^Open / }).map((b) => b.getAttribute("aria-label")!.slice(5));

async function open(list: DeckInfo[] = DECKS) {
  const client = fakeVault(list);
  const openPath = vi.fn();
  useWorkspace.setState({ client, openPath, notes: NOTES });
  render(<SlidesHome />);
  if (list.length > 0) await waitFor(() => expect(screen.getAllByRole("button", { name: /^Open / })).toHaveLength(list.length));
  return { client, openPath };
}

describe("starting a presentation", () => {
  it("offers a blank one and the first of the templates, each a card", async () => {
    await open();
    const row = screen.getByRole("region", { name: "Start a new presentation" });
    expect(within(row).getByRole("button", { name: "Blank presentation" })).toBeTruthy();
    await waitFor(() => expect(within(row).getAllByRole("button", { name: / presentation$/ }).length).toBeGreaterThanOrEqual(5));
    for (const name of ["Light", "Dark", "Minimal", "Modern", "Pitch"]) expect(within(row).getByRole("button", { name: `${name} presentation` })).toBeTruthy();
    expect(within(row).getByRole("button", { name: /Template gallery/ })).toBeTruthy();
  });

  it("makes a blank presentation, called Untitled, in one press, and opens it", async () => {
    const { client, openPath } = await open();
    fireEvent.click(screen.getByRole("button", { name: "Blank presentation" }));
    await waitFor(() => expect(openPath).toHaveBeenCalledWith("library/untitled-presentation.deck", "here"));
    const [title, project, text] = (client.createDeck as ReturnType<typeof vi.fn>).mock.calls[0]! as [string, string | null, string];
    expect(title).toBe("Untitled presentation");
    expect(project).toBeNull();
    const made = JSON.parse(text) as { slides: unknown[]; theme: { name: string }; size: { w: number; h: number } };
    expect(made.slides).toHaveLength(1);
    expect(made.size).toEqual({ w: 960, h: 540 });
  });

  it("makes a deck of a template with its example slides, and opens it", async () => {
    const { client, openPath } = await open();
    await waitFor(() => expect(screen.getByRole("button", { name: "Pitch presentation" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Pitch presentation" }));
    await waitFor(() => expect(openPath).toHaveBeenCalled());
    const text = (client.createDeck as ReturnType<typeof vi.fn>).mock.calls[0]![2] as string;
    const made = JSON.parse(text) as { slides: unknown[]; theme: { name: string } };
    expect(made.theme.name).toBe("Pitch");
    expect(made.slides.length).toBeGreaterThan(1);
  });

  it("tells the person when the vault refuses, and opens nothing", async () => {
    const { client, openPath } = await open();
    (client.createDeck as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("The vault is read only"));
    const toast = vi.fn();
    useWorkspace.setState({ toast });
    fireEvent.click(screen.getByRole("button", { name: "Blank presentation" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("The vault is read only"));
    expect(openPath).not.toHaveBeenCalled();
    // Pressing again works: the row was let go.
    await waitFor(() => expect((screen.getByRole("button", { name: "Blank presentation" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("opens the gallery from its button, where the name and the shape are chosen", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: /Template gallery/ }));
    expect(useDecks.getState().creating).toBe(true);
    expect(screen.getByRole("form", { name: "New deck" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Start a new presentation" })).toBeNull();
  });

  it("is there with no decks yet, with a line that says what to do", async () => {
    await open([]);
    await waitFor(() => expect(screen.getByText(/No decks yet/)).toBeTruthy());
    expect(screen.getByRole("button", { name: "Blank presentation" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Sort decks by" })).toBeNull();
  });
});

describe("the decks", () => {
  it("are newest first, and say how many slides and how long ago, and which project", async () => {
    await open();
    expect(order()).toEqual(["Q3 review", "Lecture", "Tool use", "Alpha talk"]);
    const card = screen.getByRole("button", { name: "Open Q3 review" });
    expect(card.textContent).toContain("4 slides");
    expect(card.textContent).toContain("Japan trip");
  });

  it("are found by the words of their name, or their project, and say so when there is none", async () => {
    await open();
    const box = screen.getByRole("searchbox", { name: "Find a deck" });
    fireEvent.change(box, { target: { value: "lec" } });
    expect(order()).toEqual(["Lecture"]);
    fireEvent.change(box, { target: { value: "japan" } });
    expect(order()).toEqual(["Q3 review"]);
    fireEvent.change(box, { target: { value: "zebra" } });
    expect(screen.getByText(/No deck is called “zebra”/)).toBeTruthy();
  });

  it("are sorted by name when asked, and the choice is kept for next time", async () => {
    await open();
    fireEvent.click(within(screen.getByRole("group", { name: "Sort decks by" })).getByRole("button", { name: "Name" }));
    expect(order()).toEqual(["Alpha talk", "Lecture", "Q3 review", "Tool use"]);
    expect(localStorage.getItem("kasten.slides.sort")).toBe("name");
    cleanup();
    await open();
    expect(order()).toEqual(["Alpha talk", "Lecture", "Q3 review", "Tool use"]);
    expect(within(screen.getByRole("group", { name: "Sort decks by" })).getByRole("button", { name: "Name" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("are shown by project when asked, the ones in none last", async () => {
    await open();
    fireEvent.click(within(screen.getByRole("group", { name: "Sort decks by" })).getByRole("button", { name: "Project" }));
    const sections = screen.getAllByRole("region").filter((s) => s.getAttribute("aria-label") !== "Start a new presentation");
    expect(sections.map((s) => s.getAttribute("aria-label"))).toEqual(["Japan trip", "Not in a project"]);
    expect(within(sections[0]!).getAllByRole("button", { name: /^Open / })).toHaveLength(1);
    expect(within(sections[1]!).getAllByRole("button", { name: /^Open / })).toHaveLength(3);
  });
});
