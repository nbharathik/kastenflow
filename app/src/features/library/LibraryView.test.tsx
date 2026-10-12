import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useShell } from "../../lib/store";
import { AppShell } from "../../shell/AppShell";
import { usePrefs } from "../workspace/prefs";
import { MemoryVault } from "../workspace/preview/memory-vault";
import { useWorkspace } from "../workspace/store";
import { LibraryView } from "./LibraryView";

const SEED = {
  "library/welcome.md": "---\nid: W1\ntitle: Welcome\nicon: 👋\ntags: [guide]\n---\nHello [[Roadmap]].\n",
  "projects/demo/_project.md": "---\ntitle: Demo project\ntype: project\n---\nThe project.\n",
  "projects/demo/pages/roadmap.md": "---\ntitle: Roadmap\ntags: [plan]\n---\nFirst steps.\n\n## Later\n\n" + "Filler text. ".repeat(40) + "Build the thumbnail cache.\n",
  "projects/demo/cards/metric.md": "---\ntitle: Diff metric\ntype: card\n---\nA hash-matched diff.\n",
  "inbox/idea.md": "---\ntitle: An idea\n---\nThink about it.\n",
  "templates/paper.md": '---\ntitle: "{{title}}"\n---\n## Abstract\n',
};

let vault: MemoryVault;

/** Opens the app on `seed` and goes to the Card Library from the sidebar. */
async function openLibrary(seed: Record<string, string> = SEED, prepare?: (vault: MemoryVault) => void) {
  vault = new MemoryVault(seed);
  prepare?.(vault);
  // The sidebar pins a few views; this one is pinned so its button is there to click.
  usePrefs.setState({ navPinned: ["library"] });
  render(<AppShell connect={async () => ({ client: vault })} />);
  const sidebar = await screen.findByRole("navigation", { name: "Sidebar" });
  await act(async () => fireEvent.click(within(sidebar).getByRole("button", { name: "Card Library" })));
  return screen.getByRole("searchbox", { name: "Find a card" });
}

const grid = () => screen.getByRole("listbox", { name: "Cards" });
const card = (title: string) => within(grid()).getByRole("option", { name: title });
// Plain DOM queries: role queries get slow on hundreds of cards in jsdom.
const titles = () => [...grid().querySelectorAll('[role="option"]')].map((o) => document.getElementById(o.getAttribute("aria-labelledby")!)?.textContent);

beforeEach(() => {
  localStorage.clear();
  useWorkspace.setState({ client: null, ready: false, notes: [], place: { view: "home" }, back: [], forward: [], recent: [], toasts: [] });
  useShell.setState({ sidebarOpen: true, focusMode: false, paletteOpen: false, shortcutsOpen: false, panels: [], sourceOpen: false });
});
afterEach(cleanup);

describe("Card Library", () => {
  it("shows every note as a card with the total count, search box focused", async () => {
    const search = await openLibrary();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Card Library");
    expect(screen.getByLabelText("5 cards")).toBeTruthy();
    expect(titles().sort()).toEqual(["An idea", "Demo project", "Diff metric", "Roadmap", "Welcome"]);
    expect(document.activeElement).toBe(search);
    // Each card says where it lives; counts load from the index.
    expect(card("Diff metric").textContent).toContain("Demo project");
    expect(card("An idea").textContent).toContain("Inbox");
    expect(await within(card("Roadmap")).findByLabelText("1 backlink")).toBeTruthy();
    // Each kind of note has its colour: a card's icon sits on a tile of it.
    const tile = (title: string) => card(title).querySelector("[data-kind-color]")!.getAttribute("data-kind-color");
    expect([tile("An idea"), tile("Welcome"), tile("Demo project")]).toEqual(["yellow", "blue", "purple"]);
  });

  it("finds cards as you type, and by their full text after a pause", async () => {
    const search = await openLibrary();
    fireEvent.change(search, { target: { value: "diff" } });
    expect(await within(grid()).findByRole("option", { name: "Diff metric" })).toBeTruthy();
    expect(within(grid()).queryByRole("option", { name: "Welcome" })).toBeNull();
    // Only the body of Roadmap says this, beyond its excerpt.
    fireEvent.change(search, { target: { value: "thumbnail" } });
    expect(await screen.findByText("Searching the full text…")).toBeTruthy();
    const found = await screen.findByRole("option", { name: "Roadmap" });
    expect(found.textContent).toContain("thumbnail cache");
    expect(titles()).toEqual(["Roadmap"]);
    // Ctrl+F comes back to the box; Esc empties it.
    act(() => found.focus());
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    expect(document.activeElement).toBe(search);
    fireEvent.keyDown(search, { key: "Escape" });
    expect((search as HTMLInputElement).value).toBe("");
  });

  it("switches to the table, sorts by a header and remembers it", async () => {
    await openLibrary();
    fireEvent.click(screen.getByRole("button", { name: "Table" }));
    const table = screen.getByRole("table", { name: "Cards" });
    const header = within(table).getByRole("columnheader", { name: "Title" });
    fireEvent.click(within(header).getByRole("button"));
    expect(header.getAttribute("aria-sort")).toBe("ascending");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("cell")[1]!.textContent)).toEqual(["An idea", "Demo project", "Diff metric", "Roadmap", "👋Welcome"]);
    // Notes without an icon of their own show a line icon for their kind.
    expect(rows[0]!.querySelector("svg.kasten-glyph-line")).toBeTruthy();
    expect(rows[0]!.querySelector("[data-kind-color]")!.getAttribute("data-kind-color")).toBe("yellow");
    expect(JSON.parse(localStorage.getItem("kasten.library")!)).toMatchObject({ mode: "table", sort: { key: "title", dir: "asc" } });
  });

  it("selects two cards and tags them through the bulk bar", async () => {
    await openLibrary();
    fireEvent.click(card("Welcome"), { ctrlKey: true });
    fireEvent.click(card("An idea").querySelector("[data-check]")!);
    expect(card("Welcome").getAttribute("aria-selected")).toBe("true");
    const bar = screen.getByRole("toolbar", { name: "Selected cards" });
    expect(bar.textContent).toContain("2 selected");
    fireEvent.click(within(bar).getByRole("button", { name: "Add tag…" }));
    const input = within(screen.getByRole("dialog", { name: "Add tag" })).getByRole("textbox");
    fireEvent.change(input, { target: { value: "#urgent" } });
    await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
    expect(await screen.findByText("Tagged 2 cards #urgent")).toBeTruthy();
    expect((await vault.read("library/welcome.md")).meta.tags).toEqual(["guide", "urgent"]);
    expect((await vault.read("inbox/idea.md")).meta.tags).toEqual(["urgent"]);
    expect((await vault.read("projects/demo/pages/roadmap.md")).meta.tags).toEqual(["plan"]);
    // The selection is gone, and the cards show their new tag.
    expect(screen.queryByRole("toolbar", { name: "Selected cards" })).toBeNull();
    expect(card("An idea").textContent).toContain("urgent");
  });

  it("moves selected cards to a project", async () => {
    await openLibrary();
    fireEvent.click(card("Welcome"), { ctrlKey: true });
    fireEvent.click(card("An idea"), { metaKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Move to…" }));
    const input = within(screen.getByRole("dialog", { name: "Move to" })).getByRole("textbox");
    fireEvent.change(input, { target: { value: "demo" } });
    await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
    expect(await screen.findByText("Moved 2 cards to Demo project")).toBeTruthy();
    expect((await vault.list()).map((n) => n.path)).toEqual(expect.arrayContaining(["projects/demo/pages/welcome.md", "projects/demo/cards/idea.md"]));
  });

  it("adds selected cards to a new board", async () => {
    await openLibrary();
    fireEvent.click(card("Diff metric"), { ctrlKey: true });
    fireEvent.click(card("Roadmap"), { ctrlKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Add to board…" }));
    const picker = screen.getByRole("dialog", { name: "Add to board" });
    expect(await within(picker).findByText("No boards yet")).toBeTruthy();
    fireEvent.change(within(picker).getByRole("textbox"), { target: { value: "Ideas" } });
    await act(async () => fireEvent.keyDown(within(picker).getByRole("textbox"), { key: "Enter" }));
    expect(await screen.findByText("Added 2 cards to “Ideas”")).toBeTruthy();
    const [board] = await vault.boards();
    // Both notes share the demo project, so the board goes there.
    expect(board).toMatchObject({ path: "projects/demo/boards/ideas.canvas", nodes: 2 });
    expect(await within(card("Roadmap")).findByLabelText("On 1 board")).toBeTruthy();
  });

  it("opens the selected cards side by side in the side stack, first on top", async () => {
    await openLibrary();
    useWorkspace.getState().clearStack();
    fireEvent.click(card("Roadmap"), { ctrlKey: true });
    fireEvent.click(card("An idea"), { ctrlKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Open side by side" }));
    const { stack, stackOpen } = useWorkspace.getState();
    expect(stackOpen).toBe(true);
    expect(stack).toHaveLength(2);
    expect(new Set(stack)).toEqual(new Set(["projects/demo/pages/roadmap.md", "inbox/idea.md"]));
    expect(await screen.findByText("Opened 2 in the side stack")).toBeTruthy();
  });

  it("moves the keyboard focus across the grid; Space selects, Esc clears", async () => {
    const search = await openLibrary();
    fireEvent.keyDown(search, { key: "ArrowDown" });
    const first = document.activeElement as HTMLElement;
    expect(first.getAttribute("role")).toBe("option");
    fireEvent.keyDown(first, { key: "ArrowRight" });
    const second = document.activeElement as HTMLElement;
    expect(second).not.toBe(first);
    expect(second.getAttribute("tabindex")).toBe("0");
    fireEvent.keyDown(second, { key: " " });
    expect(second.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(second, { key: "a", ctrlKey: true });
    expect(screen.getByRole("toolbar", { name: "Selected cards" }).textContent).toContain("5 selected");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("toolbar", { name: "Selected cards" })).toBeNull();
  });

  it("closes a menu with Esc, keeping the selection and the focus", async () => {
    await openLibrary();
    fireEvent.click(card("Welcome"), { ctrlKey: true });
    const bar = screen.getByRole("toolbar", { name: "Selected cards" });
    const button = within(bar).getByRole("button", { name: "Move to…" });
    act(() => button.focus());
    fireEvent.click(button);
    const input = within(screen.getByRole("dialog", { name: "Move to" })).getByRole("textbox");
    expect(document.activeElement).toBe(input);
    await act(async () => fireEvent.keyDown(input, { key: "Escape" }));
    expect(screen.queryByRole("dialog", { name: "Move to" })).toBeNull();
    expect(bar.textContent).toContain("1 selected");
    expect(document.activeElement).toBe(button);
  });

  it("asks before trashing more than five, and trashes through the store", async () => {
    const seed: Record<string, string> = { ...SEED };
    for (let i = 1; i <= 3; i++) seed[`inbox/extra-${i}.md`] = `---\ntitle: Extra ${i}\n---\nMore.\n`;
    await openLibrary(seed);
    fireEvent.click(card("Extra 1"), { ctrlKey: true });
    fireEvent.keyDown(card("Extra 1"), { key: "a", ctrlKey: true });
    const bar = () => screen.getByRole("toolbar", { name: "Selected cards" });
    fireEvent.click(within(bar()).getByRole("button", { name: "Trash" }));
    const ask = screen.getByRole("alertdialog", { name: "Move 8 cards to the trash?" });
    fireEvent.click(within(ask).getByRole("button", { name: "Cancel" }));
    expect(await vault.listTrash()).toEqual([]);
    expect(bar().textContent).toContain("8 selected");

    fireEvent.click(within(bar()).getByRole("button", { name: "Trash" }));
    await act(async () => fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Move to trash" })));
    expect(await screen.findByText("Moved 8 cards to the trash")).toBeTruthy();
    expect(await vault.listTrash()).toHaveLength(8);
    // One notice for all eight, whose one Undo brings them all back.
    const undo = screen.getAllByRole("button", { name: "Undo" });
    expect(undo).toHaveLength(1);
    await act(async () => fireEvent.click(undo[0]!));
    await expect.poll(async () => (await vault.listTrash()).length).toBe(0);
  });

  it("filters by type, and clears filters when nothing matches", async () => {
    const search = await openLibrary();
    fireEvent.click(screen.getByRole("button", { name: "Cards" }));
    expect(titles().sort()).toEqual(["An idea", "Diff metric"]);
    expect(JSON.parse(localStorage.getItem("kasten.library")!).filters.kind).toBe("card");
    fireEvent.change(search, { target: { value: "nothing like this" } });
    expect(await screen.findByText("No cards match. Try fewer filters.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(await screen.findByLabelText("5 cards")).toBeTruthy();
    expect(titles()).toHaveLength(5);
    expect((search as HTMLInputElement).value).toBe("");
  });

  it("draws 200 cards at a time", async () => {
    const seed: Record<string, string> = {};
    for (let i = 0; i < 450; i++) seed[`library/note-${i}.md`] = `---\ntitle: Note ${i}\n---\nBody ${i}.\n`;
    // The view alone: the shell's sidebar would list all 450 pages too.
    await useWorkspace.getState().connect({ client: new MemoryVault(seed) });
    await act(async () => {
      render(<LibraryView />);
    });
    expect(screen.getByLabelText("450 cards")).toBeTruthy();
    expect(titles()).toHaveLength(200);
    fireEvent.click(screen.getByText("Show 200 more"));
    expect(titles()).toHaveLength(400);
    fireEvent.click(screen.getByText("Show 50 more"));
    expect(titles()).toHaveLength(450);
    expect(screen.queryByText(/Show \d+ more/)).toBeNull();
  });

  it("stars the cards with agent writing to review, asking once for all of them", async () => {
    const asked: string[][] = [];
    await openLibrary(SEED, (v) => {
      v.agentMarked = async (paths) => {
        asked.push(paths);
        return paths.filter((p) => p === "inbox/idea.md");
      };
    });
    const star = { name: "Agent writing to review" };
    expect(await within(card("An idea")).findByRole("img", star)).toBeTruthy();
    expect(within(card("Welcome")).queryByRole("img", star)).toBeNull();
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("library/welcome.md");
    fireEvent.click(screen.getByRole("button", { name: "Table" }));
    const row = screen.getByRole("button", { name: /An idea/ }).closest("tr")!;
    expect(within(row).getByRole("img", star)).toBeTruthy();
  });

  it("points an empty vault to quick capture", async () => {
    await openLibrary({});
    expect(screen.getByText("Your library is empty")).toBeTruthy();
    expect(screen.getByRole("button", { name: "New quick note" })).toBeTruthy();
  });
});
