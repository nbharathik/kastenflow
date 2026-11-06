// The Slides home as a page: its sections, grid or list, the keys, the menu on a card, the first-steps page, and thumbnails drawn lazily.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { DeckEngine, loadSlides } from "@kasten-slides/wasm";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { DeckInfo, NoteMeta, VaultClient } from "../../lib/vault/types";
import { useWorkspace } from "../workspace/store";
import { resetPreviews } from "./previews";
import { SlidesHome } from "./SlidesHome";
import { useDecks } from "./store";

let text = "";

beforeAll(async () => {
  await loadSlides(await readFile(join(import.meta.dirname, "../../../../packages/slides-wasm/pkg/slides_wasm_bg.wasm")));
  const engine = DeckEngine.create("Sample", "Light", 1, { size: { w: 960, h: 540 }, examples: true });
  text = engine.save();
  engine.dispose();
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 160 });
});

const deck = (title: string, modified: number, project: string | null = null): DeckInfo => ({ path: `library/${title.toLowerCase().replace(/\s+/g, "-")}.deck`, title, project, slides: 4, modified, size: 100, problem: null });
const DECKS = [deck("Tool use", 300), deck("Q3 review", 500, "trip"), deck("Alpha talk", 100), deck("Lecture", 400)];
const NOTES = [{ path: "projects/trip/trip.md", title: "Japan trip", kind: "project", project: "trip" } as unknown as NoteMeta];

function fakeVault(list: DeckInfo[]) {
  return {
    decks: vi.fn(async () => list),
    createDeck: vi.fn(async () => "library/copy.deck"),
    saveDeck: vi.fn(async () => ({ status: "written" })),
    deck: vi.fn(async (path: string) => ({ path, text, hash: "h1", modified: 1 })),
  } as unknown as VaultClient & Record<"decks" | "createDeck" | "saveDeck" | "deck", ReturnType<typeof vi.fn>>;
}

const openPath = vi.fn();
const trash = vi.fn();
const toast = vi.fn();

async function open(list: DeckInfo[] = DECKS) {
  const client = fakeVault(list);
  useWorkspace.setState({ client, openPath, trash, toast, notes: NOTES, recent: [] });
  render(<SlidesHome />);
  // By attribute, not by role: a hundred cards make the accessible-name search slow.
  if (list.length > 0) await waitFor(() => expect(document.querySelectorAll("[data-deck-card]")).toHaveLength(list.length));
  return client;
}

beforeEach(() => {
  localStorage.clear();
  resetPreviews();
  openPath.mockReset();
  trash.mockReset();
  toast.mockReset();
  useDecks.setState({ list: [], loaded: false, creating: false, draftProject: null });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useWorkspace.setState({ client: null });
});

const cards = () => screen.getAllByRole("button", { name: /^Open / });

describe("the sections", () => {
  it("are the header, Continue, Start and All decks, in that order", async () => {
    await open();
    expect(screen.getByRole("heading", { level: 1, name: "Slides" })).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: "Find a deck" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "New deck" })).toBeTruthy();
    const regions = screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"));
    expect(regions).toEqual(["Continue", "Start a new presentation"]);
    expect(screen.getByRole("heading", { name: /^All decks/ }).textContent).toContain("4");
    expect(screen.getByRole("group", { name: "Decks" })).toBeTruthy();
  });

  it("offer a blank deck, one from a note, one from an outline, and a PowerPoint file to bring in", async () => {
    await open();
    const row = screen.getByRole("region", { name: "Start a new presentation" });
    for (const name of [/^Blank/, /^From a note/, /^From an outline/, /^Import PowerPoint/]) expect(within(row).getByRole("button", { name })).toBeTruthy();
  });

  it("put the decks edited last in Continue, with how many slides each has", async () => {
    await open();
    const row = screen.getByRole("region", { name: "Continue" });
    const first = within(row).getAllByRole("button")[0]!;
    expect(first.getAttribute("aria-label")).toBe("Continue: Q3 review");
    expect(first.textContent).toContain("4 slides");
    expect(first.textContent).toContain("edited");
  });

  it("choose a page for a deck from the note card, and start nothing until one is chosen", async () => {
    const note = { path: "library/plan.md", id: "n1", title: "Launch plan", kind: "page", project: null, modified: 5 } as unknown as NoteMeta;
    await open();
    useWorkspace.setState({ notes: [...NOTES, note] });
    fireEvent.click(screen.getByRole("button", { name: /^From a note/ }));
    const picker = screen.getByRole("dialog", { name: "Choose a page" });
    expect(within(picker).getByRole("button", { name: /Launch plan/ })).toBeTruthy();
    expect(within(picker).queryByRole("button", { name: /Japan trip/ })).toBeNull();
    expect(openPath).not.toHaveBeenCalled();
    fireEvent.keyDown(picker, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Choose a page" })).toBeNull();
  });

  it("make a deck that opens on its outline from the outline card", async () => {
    const client = await open();
    fireEvent.click(screen.getByRole("button", { name: /^From an outline/ }));
    await waitFor(() => expect(openPath).toHaveBeenCalledWith("library/copy.deck", "here"));
    expect(client.createDeck).toHaveBeenCalledTimes(1);
    const { deckUi } = await import("./deck-ui");
    expect(deckUi("library/copy.deck")?.view).toBe("outline");
  });

  it("show each template with its first slides, and all of them on request", async () => {
    await open();
    await waitFor(() => expect(screen.getByRole("button", { name: "Pitch presentation" })).toBeTruthy());
    const more = screen.getByRole("button", { name: /^All \d+ templates/ });
    fireEvent.click(more);
    expect(screen.getByRole("button", { name: /^Fewer templates/ })).toBeTruthy();
  });
});

describe("grid or list", () => {
  it("is a grid first, becomes a list on a click, and is a list again next time", async () => {
    await open();
    const group = screen.getByRole("group", { name: "Decks" });
    expect(group.getAttribute("data-view")).toBe("grid");
    fireEvent.click(within(screen.getByRole("group", { name: "Show decks as" })).getByRole("button", { name: "List" }));
    expect(screen.getByRole("group", { name: "Decks" }).getAttribute("data-view")).toBe("list");
    expect(localStorage.getItem("kasten.slides.view")).toBe("list");
    cleanup();
    await open();
    expect(screen.getByRole("group", { name: "Decks" }).getAttribute("data-view")).toBe("list");
    expect(within(screen.getByRole("group", { name: "Show decks as" })).getByRole("button", { name: "List" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("works when the window will not keep the choice", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    await open();
    fireEvent.click(within(screen.getByRole("group", { name: "Show decks as" })).getByRole("button", { name: "List" }));
    expect(screen.getByRole("group", { name: "Decks" }).getAttribute("data-view")).toBe("list");
  });
});

describe("the keys", () => {
  it("move between cards with the arrows, to the ends with Home and End, and keep one card in the Tab order", async () => {
    await open();
    const [first, second] = cards();
    expect(first!.tabIndex).toBe(0);
    expect(second!.tabIndex).toBe(-1);
    first!.focus();
    fireEvent.keyDown(first!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(second);
    expect(second!.tabIndex).toBe(0);
    expect(first!.tabIndex).toBe(-1);
    fireEvent.keyDown(second!, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first!, { key: "End" });
    expect(document.activeElement).toBe(cards().at(-1));
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement).toBe(first);
  });

  it("move down a row in a list", async () => {
    await open();
    fireEvent.click(within(screen.getByRole("group", { name: "Show decks as" })).getByRole("button", { name: "List" }));
    const [first, second] = cards();
    first!.focus();
    fireEvent.keyDown(first!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(first);
  });

  it("open the focused deck on Enter", async () => {
    await open();
    const second = cards()[1]!;
    second.focus();
    fireEvent.keyDown(second, { key: "Enter" });
    expect(openPath).toHaveBeenCalledWith("library/lecture.deck", "here");
  });

  it("start a deck on Ctrl+N, before the app makes a page", async () => {
    await open();
    const press = fireEvent.keyDown(screen.getByRole("searchbox", { name: "Find a deck" }), { key: "n", ctrlKey: true });
    expect(press).toBe(false);
    expect(useDecks.getState().creating).toBe(true);
    expect(screen.getByRole("form", { name: "New deck" })).toBeTruthy();
  });
});

describe("the menu on a deck", () => {
  const menuOf = async (title: string) => {
    fireEvent.contextMenu(screen.getByRole("button", { name: `Open ${title}` }));
    return screen.findByRole("menu", { name: `More for ${title}` });
  };

  it("opens on a right-click with Open, Rename, Duplicate and Move to Trash", async () => {
    await open();
    const menu = await menuOf("Lecture");
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent?.replace(/Ctrl\+click/, ""))).toEqual(["Open", "Open in new tab", "Rename", "Duplicate", "Move to Trash"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Open" }));
    expect(openPath).toHaveBeenCalledWith("library/lecture.deck", "here");
  });

  it("moves the deck to the Trash, nothing more", async () => {
    await open();
    fireEvent.click(within(await menuOf("Lecture")).getByRole("menuitem", { name: "Move to Trash" }));
    expect(trash).toHaveBeenCalledWith("library/lecture.deck");
  });

  it("renames the deck in place, saved through the vault", async () => {
    const client = await open();
    fireEvent.click(within(await menuOf("Lecture")).getByRole("menuitem", { name: "Rename" }));
    const box = screen.getByRole("textbox", { name: "Name of Lecture" });
    fireEvent.change(box, { target: { value: "Keynote" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(client.saveDeck).toHaveBeenCalledTimes(1));
    expect((client.saveDeck.mock.calls[0] as string[])[1]).toContain("Keynote");
  });

  it("keeps a copy, in the same project, and says so", async () => {
    const client = await open();
    fireEvent.click(within(await menuOf("Q3 review")).getByRole("menuitem", { name: "Duplicate" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Made “Q3 review copy”"));
    const [title, project] = client.createDeck.mock.calls[0] as [string, string | null];
    expect(title).toBe("Q3 review copy");
    expect(project).toBe("trip");
  });
});

describe("with no deck yet", () => {
  it("teaches the first three steps, and still offers the ways to start", async () => {
    await open([]);
    const page = await screen.findByRole("region", { name: "Your first deck" });
    expect(within(page).getByText("No decks yet")).toBeTruthy();
    expect(within(page).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByRole("region", { name: "Continue" })).toBeNull();
    expect(screen.queryByRole("searchbox", { name: "Find a deck" })).toBeNull();
    expect(screen.getByRole("button", { name: "Blank presentation" })).toBeTruthy();
  });
});

/** An IntersectionObserver the test drives: nothing is near the window until it says so. */
function stubWindow() {
  const watching: { target: Element; tell(near: boolean): void }[] = [];
  class Watcher {
    private readonly listener: IntersectionObserverCallback;
    constructor(listener: IntersectionObserverCallback) {
      this.listener = listener;
    }
    observe(target: Element) {
      watching.push({ target, tell: (near) => this.listener([{ isIntersecting: near, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver) });
    }
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  vi.stubGlobal("IntersectionObserver", Watcher);
  return watching;
}

describe("thumbnails", () => {
  const MANY = Array.from({ length: 100 }, (_, i) => deck(`Deck ${String(i).padStart(3, "0")}`, 1000 - i));
  const drawn = () => document.querySelectorAll('[data-thumb="drawn"]').length;

  it("are drawn, and the decks read, only for the cards near the window", async () => {
    const watching = stubWindow();
    const started = performance.now();
    const client = await open(MANY);
    const took = performance.now() - started;
    // 100 decks open at once: nothing is read and nothing drawn until a card comes near.
    expect(document.querySelectorAll("[data-deck-card]")).toHaveLength(100);
    expect(client.deck).not.toHaveBeenCalled();
    expect(drawn()).toBe(0);
    // A generous ceiling: a slow computer must pass, a page that draws a hundred slides up front must not.
    expect(took).toBeLessThan(5000);

    const grid = document.querySelector<HTMLElement>('[data-view].sh-grid')!;
    const near = watching.filter((w) => grid.contains(w.target)).slice(0, 8);
    expect(near).toHaveLength(8);
    act(() => near.forEach((w) => w.tell(true)));
    await waitFor(() => expect(client.deck).toHaveBeenCalledTimes(8));
    expect(drawn()).toBe(8);
    expect(new Set(client.deck.mock.calls.map((call) => call[0] as string)).size).toBe(8);

    // Scrolled past: the picture goes, the deck stays kept and is not read again on the way back.
    act(() => near.forEach((w) => w.tell(false)));
    expect(drawn()).toBe(0);
    act(() => near.forEach((w) => w.tell(true)));
    expect(drawn()).toBe(8);
    expect(client.deck).toHaveBeenCalledTimes(8);
  }, 30_000);
});
