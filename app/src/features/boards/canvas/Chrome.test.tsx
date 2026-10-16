// The board's chrome: the slim strip of tools, the one small view control, the
// title with Present and More, focus mode (every bar gone, back at an edge or
// on a key), and what a double-click makes.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryVault } from "../../workspace/preview/memory-vault";
import { derive } from "../../workspace/store-layout";
import { useWorkspace } from "../../workspace/store";
import { initialLayout } from "../../workspace/tabs";
import { useBoardPrefs } from "../board-prefs";
import { useBoards } from "../store";
import { BoardCanvas } from "./BoardCanvas";
import { mockReactFlow } from "./test/flow-mocks";
import { forgetTrails } from "./trail";

const MAIN = "library/main.canvas";
const IDEA = "library/idea.md";
const SEED = {
  [IDEA]: "---\ntitle: Idea\ntype: card\n---\nThe first lines of the idea.\n",
  [MAIN]: JSON.stringify({
    nodes: [
      { id: "g", type: "group", label: "Ideas", x: -40, y: -80, width: 800, height: 420 },
      { id: "c1", type: "file", file: IDEA, x: 0, y: 0, width: 320, height: 180 },
      { id: "s1", type: "text", text: "A sticky", x: 0, y: 600, width: 260, height: 120 },
    ],
    edges: [],
    "x-kasten": { title: "Main" },
  }),
};

let vault: MemoryVault;

beforeAll(mockReactFlow);
beforeEach(async () => {
  localStorage.clear();
  forgetTrails();
  useBoardPrefs.setState({ alwaysToolbar: false, minimap: false, doubleClick: "card" });
  vault = new MemoryVault(SEED);
  useWorkspace.setState({ client: vault, ready: true, notes: await vault.list(), ...derive(initialLayout()), stack: [], stackOpen: false, recent: [], toasts: [] });
  await useBoards.getState().load();
});
afterEach(cleanup);

async function open(embedded = false) {
  const view = render(<BoardCanvas path={MAIN} embedded={embedded} />);
  const board = await view.findByLabelText(/^Whiteboard:/);
  await waitFor(() => expect(view.container.querySelectorAll(".react-flow__node")).toHaveLength(3));
  return { view, board };
}

const labels = (el: HTMLElement) => within(el).getAllByRole("button").map((b) => b.getAttribute("aria-label"));
/** The zoom button, whatever the board's zoom is once it has fitted itself. */
const zoomButton = () => screen.getByRole("button", { name: /^Zoom \d+%$/ });

describe("the view control", () => {
  it("is one small bar: undo, redo, zoom out, the percentage, zoom in and the minimap", async () => {
    await open();
    const control = screen.getByRole("toolbar", { name: "View" });
    expect(labels(control).map((l) => l?.replace(/\d+%/, "N%"))).toEqual(["Undo", "Redo", "Zoom out", "Zoom N%", "Zoom in", "Minimap"]);
    // Present and the keys moved to the top; fit and the zoom levels are behind the percentage.
    expect(within(control).queryByRole("button", { name: "Fit to view" })).toBeNull();
    expect(screen.queryByRole("toolbar", { name: "Add to the board" })).toBeNull();
    expect(screen.queryByRole("menu", { name: "Zoom" })).toBeNull();
  });

  it("opens fit, 100 % and more from the percentage, and closes on a choice or Escape", async () => {
    await open();
    const control = screen.getByRole("toolbar", { name: "View" });
    fireEvent.click(within(control).getByRole("button", { name: /^Zoom \d+%$/ }));
    const menu = screen.getByRole("menu", { name: "Zoom" });
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Fit everything in viewF", "100%Shift+0", "50%", "200%"]);
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Zoom" })).toBeNull();
    fireEvent.click(zoomButton());
    fireEvent.click(within(screen.getByRole("menu", { name: "Zoom" })).getByRole("menuitem", { name: /^50%/ }));
    expect(screen.queryByRole("menu", { name: "Zoom" })).toBeNull();
  });

  it("turns the minimap on and off, and remembers it for the next board", async () => {
    const { view } = await open();
    expect(view.container.querySelector(".react-flow__minimap")).toBeNull();
    const button = screen.getByRole("button", { name: "Minimap" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(useBoardPrefs.getState().minimap).toBe(true);
    expect(JSON.parse(localStorage.getItem("kasten.board.prefs")!)).toMatchObject({ minimap: true });
    await waitFor(() => expect(view.container.querySelector(".react-flow__minimap")).toBeTruthy());
    fireEvent.click(button);
    expect(view.container.querySelector(".react-flow__minimap")).toBeNull();
  });

  it("is a bar that rests faintly: it and the others are chrome the board can hide", async () => {
    await open();
    for (const name of ["View", "Tools", "Whiteboard actions"]) expect(screen.getByRole("toolbar", { name }).classList.contains("kasten-chrome")).toBe(true);
    expect(screen.getByRole("navigation", { name: "Board breadcrumb" }).classList.contains("kasten-chrome")).toBe(true);
  });
});

describe("the tool strip", () => {
  it("rests quietly unless the setting keeps it at full strength", async () => {
    await open();
    const strip = screen.getByRole("toolbar", { name: "Tools" });
    expect(strip.hasAttribute("data-solid")).toBe(false);
    act(() => useBoardPrefs.getState().set({ alwaysToolbar: true }));
    expect(strip.hasAttribute("data-solid")).toBe(true);
  });

  it("puts a sticky in the middle of the view from its button, and cards and links behind +", async () => {
    await open();
    fireEvent.click(within(screen.getByRole("toolbar", { name: "Tools" })).getByRole("button", { name: "Sticky" }));
    await waitFor(async () => expect((await vault.board(MAIN)).nodes.filter((n) => n.kind === "text")).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const menu = screen.getByRole("menu", { name: "Add to the board" });
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["New cardC", "Link…", "Note…or drag notes in", "Board inside this board…"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Link…" }));
    expect(screen.getByRole("dialog", { name: "Add a link" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Web address" }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Add a link" })).toBeNull();
  });

  it("makes a card or a sticky on a double-click, as chosen in + and kept", async () => {
    const { view } = await open();
    const pane = view.container.querySelector(".react-flow__pane")!;
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const choice = screen.getByRole("group", { name: "Double-click makes" });
    expect(within(choice).getByRole("button", { name: "Card" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(choice).getByRole("button", { name: "Sticky" }));
    expect(useBoardPrefs.getState().doubleClick).toBe("sticky");
    expect(JSON.parse(localStorage.getItem("kasten.board.prefs")!)).toMatchObject({ doubleClick: "sticky" });

    fireEvent.doubleClick(pane, { clientX: 500, clientY: 500 });
    await waitFor(async () => expect((await vault.board(MAIN)).nodes.filter((n) => n.kind === "text")).toHaveLength(2));
    expect((await vault.board(MAIN)).nodes.filter((n) => n.kind === "file")).toHaveLength(1);
    expect(await screen.findByRole("textbox", { name: "Sticky text" })).toBeTruthy();
  });
});

describe("the top of the board", () => {
  it("has Present and a More menu, not a dozen buttons", async () => {
    await open();
    const actions = screen.getByRole("toolbar", { name: "Whiteboard actions" });
    expect(labels(actions)).toEqual(["Present", "More"]);
    // Both are icons: Present's word is in its name and its tooltip.
    const present = within(actions).getByRole("button", { name: "Present" });
    expect(present.textContent).toBe("");
    expect(present.title).toContain("Present");
    fireEvent.click(within(actions).getByRole("button", { name: "More" }));
    const menu = screen.getByRole("menu", { name: "More" });
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent?.replace(/\s+/g, " "))).toEqual([
      "Layout…",
      "Brainstorm with AI…",
      "Mind mapfrom connected cards",
      "Find on this boardCtrl+F",
      "Focus mode\\",
      "Export as an outlineas Markdown",
      "Board keys?",
      "Whiteboard settings",
    ]);
  });

  it("opens the layout helpers, find and the board's keys from More", async () => {
    await open();
    const more = () => fireEvent.click(screen.getByRole("button", { name: "More" }));
    more();
    fireEvent.click(screen.getByRole("menuitem", { name: /^Layout/ }));
    expect(screen.getByRole("menu", { name: "Layout" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("menu", { name: "Layout" }), { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Layout" })).toBeNull();
    more();
    fireEvent.click(screen.getByRole("menuitem", { name: /^Find on this board/ }));
    const finder = await screen.findByRole("dialog", { name: "Find on this board" });
    fireEvent.keyDown(within(finder).getByRole("textbox"), { key: "Escape" });
    more();
    fireEvent.click(screen.getByRole("menuitem", { name: /^Board keys/ }));
    expect(screen.getByRole("dialog", { name: "Board keys" })).toBeTruthy();
  });

  it("copies the board as an outline, and opens the board's settings", async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn(async (text: string) => void written.push(text)) } });
    await open();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: /^Export as an outline/ })));
    expect(written[0]).toContain("# Main");
    expect(written[0]).toContain("## Ideas");
    expect(written[0]).toContain("- [[Idea]]");
    expect(useWorkspace.getState().toasts.at(-1)?.text).toBe("Copied the board as an outline");
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Whiteboard settings/ }));
    expect(useWorkspace.getState().place.view).toBe("settings");
  });

  it("keeps a board inside a page quiet: its header presents it, so no Present or breadcrumb", async () => {
    await open(true);
    expect(screen.queryByRole("button", { name: "Present" })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Board breadcrumb" })).toBeNull();
    // The tools and More are still there for working on it.
    expect(screen.getByRole("toolbar", { name: "Tools" })).toBeTruthy();
    expect(labels(screen.getByRole("toolbar", { name: "Whiteboard actions" }))).toEqual(["More"]);
  });
});

describe("focus mode", () => {
  it("hides the bars with the backslash key, leaving a hint, and shows them again with it", async () => {
    const { board } = await open();
    expect(board.classList.contains("is-focus")).toBe(false);
    await act(async () => fireEvent.keyDown(board, { key: "\\" }));
    expect(board.classList.contains("is-focus")).toBe(true);
    // The bars are still there for the CSS to hide, and a small hint says how to leave.
    const hint = screen.getByRole("button", { name: "Leave focus mode" });
    expect(hint.textContent).toContain("Focus mode");
    expect(hint.closest(".kasten-chrome")).toBeNull();
    await act(async () => fireEvent.keyDown(board, { key: "\\" }));
    expect(board.classList.contains("is-focus")).toBe(false);
    expect(screen.queryByRole("button", { name: "Leave focus mode" })).toBeNull();
  });

  it("is entered from the More menu and the board's menu, and left by the hint or Escape", async () => {
    const { board, view } = await open();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: /^Focus mode/ })));
    expect(board.classList.contains("is-focus")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Leave focus mode" }));
    expect(board.classList.contains("is-focus")).toBe(false);

    const pane = view.container.querySelector<HTMLElement>(".react-flow__pane")!;
    fireEvent.pointerDown(pane, { button: 2, clientX: 100, clientY: 100 });
    fireEvent.contextMenu(pane, { button: 2, clientX: 101, clientY: 100 });
    await act(async () => fireEvent.click(within(await screen.findByRole("menu", { name: "Board menu" })).getByRole("menuitem", { name: /^Focus mode/ })));
    expect(board.classList.contains("is-focus")).toBe(true);
    await act(async () => fireEvent.keyDown(board, { key: "Escape" }));
    expect(board.classList.contains("is-focus")).toBe(false);
  });

  it("brings the bars back at an edge of the board, and on a key, but not for keys typed into a sticky", async () => {
    const { board, view } = await open();
    board.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width: 1200, height: 800, right: 1200, bottom: 800, toJSON: () => ({}) });
    await act(async () => fireEvent.keyDown(board, { key: "\\" }));
    expect(board.dataset.peek).toBeUndefined();
    // The middle of the board: nothing.
    fireEvent.pointerMove(board, { clientX: 600, clientY: 400 });
    expect(board.dataset.peek).toBeUndefined();
    // Near an edge: the bars show.
    fireEvent.pointerMove(board, { clientX: 20, clientY: 400 });
    expect(board.dataset.peek).toBe("true");
    await act(async () => fireEvent.keyDown(board, { key: "\\" }));
    expect(board.dataset.peek).toBeUndefined();

    // Back in focus, a key on the board shows them.
    await act(async () => fireEvent.keyDown(board, { key: "\\" }));
    expect(board.dataset.peek).toBeUndefined();
    fireEvent.keyDown(board, { key: "ArrowRight" });
    expect(board.dataset.peek).toBe("true");
    await act(async () => fireEvent.keyDown(board, { key: "\\" }));

    // Writing in a sticky keeps the bars away.
    await act(async () => fireEvent.keyDown(board, { key: "\\" }));
    fireEvent.doubleClick(view.container.querySelector('.react-flow__node[data-id="s1"]')!);
    const field = await screen.findByRole("textbox", { name: "Sticky text" });
    fireEvent.keyDown(field, { key: "a" });
    expect(board.dataset.peek).toBeUndefined();
  });

  it("is not on while presenting, and a presentation starts from the bar", async () => {
    const { board } = await open();
    await act(async () => fireEvent.keyDown(board, { key: "\\" }));
    expect(board.classList.contains("is-focus")).toBe(true);
    await act(async () => fireEvent.keyDown(board, { key: "p" }));
    expect(board.classList.contains("is-presenting")).toBe(true);
    expect(board.classList.contains("is-focus")).toBe(false);
    expect(screen.queryByRole("button", { name: "Leave focus mode" })).toBeNull();
  });
});
