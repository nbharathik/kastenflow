// The board's single-key shortcuts, arrows that move the view, the board
// keys list, and its menu: a right-click, not a right-drag, and the keys.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryVault } from "../../workspace/preview/memory-vault";
import { derive } from "../../workspace/store-layout";
import { useWorkspace } from "../../workspace/store";
import { initialLayout } from "../../workspace/tabs";
import { useBoards } from "../store";
import { BoardCanvas } from "./BoardCanvas";
import { mockReactFlow } from "./test/flow-mocks";
import { forgetTrails } from "./trail";

const MAIN = "library/main.canvas";
const EMPTY = "library/empty.canvas";
const SEED = {
  [MAIN]: JSON.stringify({ nodes: [{ id: "s1", type: "text", text: "A sticky", x: 0, y: 0, width: 260, height: 120 }], edges: [], "x-kasten": { title: "Main" } }),
  [EMPTY]: JSON.stringify({ nodes: [], edges: [], "x-kasten": { title: "Empty" } }),
};

let vault: MemoryVault;

beforeAll(mockReactFlow);
beforeEach(async () => {
  localStorage.clear();
  forgetTrails();
  vault = new MemoryVault(SEED);
  useWorkspace.setState({ client: vault, ready: true, notes: await vault.list(), ...derive(initialLayout()), stack: [], stackOpen: false, recent: [], toasts: [] });
  await useBoards.getState().load();
});
afterEach(cleanup);

async function open() {
  const view = render(<BoardCanvas path={MAIN} />);
  const board = await view.findByLabelText(/^Whiteboard:/);
  await waitFor(() => expect(view.container.querySelectorAll(".react-flow__node")).toHaveLength(1));
  return { view, board };
}

const kinds = async () => (await vault.board(MAIN)).nodes.map((n) => n.kind).sort();
const viewport = (container: HTMLElement) => container.querySelector<HTMLElement>(".react-flow__viewport")!.style.transform;

describe("board keys", () => {
  it("makes a sticky with S and a card with C, in the middle of the view", async () => {
    const { board } = await open();
    await act(async () => fireEvent.keyDown(board, { key: "s" }));
    await waitFor(async () => expect(await kinds()).toEqual(["text", "text"]));
    await act(async () => fireEvent.keyDown(board, { key: "c" }));
    await waitFor(async () => expect((await kinds()).length).toBe(3));
  });

  it("keeps an empty board's view where it is when the first thing lands", async () => {
    const view = render(<BoardCanvas path={EMPTY} />);
    const board = await view.findByLabelText(/^Whiteboard:/);
    const before = viewport(view.container);
    await act(async () => fireEvent.keyDown(board, { key: "s" }));
    await waitFor(() => expect(view.container.querySelectorAll(".react-flow__node")).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(viewport(view.container)).toBe(before);
  });

  it("moves the view with the arrows when nothing is selected", async () => {
    const { view, board } = await open();
    const before = viewport(view.container);
    await act(async () => fireEvent.keyDown(board, { key: "ArrowRight" }));
    await waitFor(() => expect(viewport(view.container)).not.toBe(before));
  });

  it("lists the board keys with ?, and closes them", async () => {
    const { board } = await open();
    await act(async () => fireEvent.keyDown(board, { key: "?" }));
    const help = screen.getByRole("dialog", { name: "Board keys" });
    expect(within(help).getByText("Right-drag, middle-drag or Space+drag")).toBeTruthy();
    fireEvent.click(within(help).getByRole("button", { name: "Close the board keys" }));
    expect(screen.queryByRole("dialog", { name: "Board keys" })).toBeNull();
  });

  it("gives the board keys the focus from the menu, and Escape on the board closes them first", async () => {
    const { view, board } = await open();
    const sticky = () => view.container.querySelector('.react-flow__node[data-id="s1"]')!;
    fireEvent.click(sticky());
    const pane = view.container.querySelector<HTMLElement>(".react-flow__pane")!;
    fireEvent.pointerDown(pane, { button: 2, clientX: 100, clientY: 100 });
    fireEvent.contextMenu(pane, { button: 2, clientX: 100, clientY: 100 });
    const menu = await screen.findByRole("menu", { name: "Board menu" });
    await act(async () => fireEvent.click(within(menu).getByRole("menuitem", { name: /Board keys/ })));
    const help = screen.getByRole("dialog", { name: "Board keys" });
    await waitFor(() => expect(document.activeElement).toBe(help));
    // Back on the board, Escape closes the list and leaves the selection.
    board.focus();
    await act(async () => fireEvent.keyDown(board, { key: "Escape" }));
    expect(screen.queryByRole("dialog", { name: "Board keys" })).toBeNull();
    expect(sticky().classList.contains("selected")).toBe(true);
  });

  it("brings a card made at the edge of the view into it", async () => {
    const { view, board } = await open();
    board.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width: 1200, height: 800, right: 1200, bottom: 800, toJSON: () => ({}) });
    const pane = view.container.querySelector<HTMLElement>(".react-flow__pane")!;
    fireEvent.pointerDown(pane, { button: 2, clientX: 1150, clientY: 760 });
    fireEvent.contextMenu(pane, { button: 2, clientX: 1150, clientY: 760 });
    const menu = await screen.findByRole("menu", { name: "Board menu" });
    await act(async () => fireEvent.click(within(menu).getByRole("menuitem", { name: /New card here/ })));
    await waitFor(async () => expect((await vault.board(MAIN)).nodes).toHaveLength(2));
    const card = (await vault.board(MAIN)).nodes.find((n) => n.id !== "s1")!;
    await waitFor(() => {
      const [, x, y, zoom] = /translate\(([-\d.]+)px, ?([-\d.]+)px\) ?scale\(([\d.]+)\)/.exec(viewport(view.container))!.map(Number);
      const left = card.x * zoom! + x!;
      const top = card.y * zoom! + y!;
      expect([left >= 48, top >= 48, left + card.width * zoom! <= 1152, top + card.height * zoom! <= 752]).toEqual([true, true, true, true]);
    });
  });

  it("opens the menu on a right-click that stays put, not after a right-drag", async () => {
    const { view, board } = await open();
    const pane = view.container.querySelector<HTMLElement>(".react-flow__pane")!;
    fireEvent.pointerDown(pane, { button: 2, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(pane, { button: 2, buttons: 2, clientX: 180, clientY: 140 });
    fireEvent.contextMenu(pane, { button: 2, clientX: 180, clientY: 140 });
    expect(screen.queryByRole("menu", { name: "Board menu" })).toBeNull();
    fireEvent.pointerDown(pane, { button: 2, clientX: 100, clientY: 100 });
    fireEvent.contextMenu(pane, { button: 2, clientX: 101, clientY: 100 });
    const menu = await screen.findByRole("menu", { name: "Board menu" });
    expect(within(menu).getByRole("menuitem", { name: /Board keys/ })).toBeTruthy();
    // The pointer goes on to the menu, the button up: the menu stays.
    fireEvent.pointerMove(menu, { buttons: 0, clientX: 260, clientY: 220 });
    expect(screen.getByRole("menu", { name: "Board menu" })).toBeTruthy();
    expect(board).toBeTruthy();
  });

  it("opens the menu from the keys after a right-drag, in whichever order the system sends its events", async () => {
    const { view, board } = await open();
    const pane = view.container.querySelector<HTMLElement>(".react-flow__pane")!;
    const rightDrag = () => {
      fireEvent.pointerDown(pane, { button: 2, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(pane, { button: 2, buttons: 2, clientX: 180, clientY: 140 });
      fireEvent.pointerUp(pane, { button: 2, clientX: 180, clientY: 140 });
    };
    const keysOpenTheMenu = async () => {
      board.focus();
      expect(fireEvent.contextMenu(board, { button: 0 })).toBe(false);
      expect(await screen.findByRole("menu", { name: "Board menu" })).toBeTruthy();
      await act(async () => fireEvent.keyDown(document.activeElement!, { key: "Escape" }));
    };
    // Windows: the drag's own menu comes once the button is up.
    rightDrag();
    fireEvent.contextMenu(pane, { button: 2, clientX: 180, clientY: 140 });
    expect(screen.queryByRole("menu", { name: "Board menu" })).toBeNull();
    await keysOpenTheMenu();
    // macOS and Linux: it came with the press; the keys' menu comes later.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      rightDrag();
      vi.setSystemTime(Date.now() + 2_000);
      await keysOpenTheMenu();
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves text being written its own menu, for cutting, copying and pasting", async () => {
    const { view, board } = await open();
    fireEvent.click(view.container.querySelector('.react-flow__node[data-id="s1"]')!);
    await act(async () => fireEvent.keyDown(board, { key: "Enter" }));
    const field = await screen.findByRole("textbox");
    // Not cancelled: the system's menu shows, and the board's does not.
    expect(fireEvent.contextMenu(field, { button: 2, clientX: 40, clientY: 40 })).toBe(true);
    expect(screen.queryByRole("menu", { name: "Board menu" })).toBeNull();
  });

  it("opens the menu from the keyboard, for what is selected or for the board", async () => {
    const { view, board } = await open();
    board.focus();
    // The menu key or Shift+F10 on the board itself.
    expect(fireEvent.contextMenu(board, { button: 0 })).toBe(false);
    let menu = await screen.findByRole("menu", { name: "Board menu" });
    expect(within(menu).getAllByRole("menuitem")[0]!.textContent).toMatch(/New card here/);
    await act(async () => fireEvent.keyDown(document.activeElement!, { key: "Escape" }));
    expect(screen.queryByRole("menu", { name: "Board menu" })).toBeNull();

    fireEvent.click(view.container.querySelector('.react-flow__node[data-id="s1"]')!);
    board.focus();
    fireEvent.contextMenu(board, { button: 0 });
    menu = await screen.findByRole("menu", { name: "Board menu" });
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toContain("EditEnter");
    // The keys go through its items, and Esc gives the focus back.
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
    // Down to "Colour…": the colours show only once it is asked for, then
    // they are one stop, along them, and on.
    fireEvent.keyDown(items[0]!, { key: "ArrowDown" });
    const colour = document.activeElement as HTMLElement;
    expect(colour.textContent).toMatch(/^Colour…/);
    expect(within(menu).queryByRole("group", { name: "Colour" })).toBeNull();
    fireEvent.click(colour);
    expect(within(menu).getByRole("group", { name: "Colour" })).toBeTruthy();
    fireEvent.keyDown(colour, { key: "ArrowDown" });
    expect(document.activeElement!.getAttribute("aria-label")).toBe("No colour");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(document.activeElement!.getAttribute("aria-label")).not.toBe("No colour");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    const all = within(menu).getAllByRole("menuitem");
    expect(document.activeElement).toBe(all[all.indexOf(colour) + 1]);
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement).toBe(all.at(-1));
    fireEvent.keyDown(all.at(-1)!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(all[0]);
    await act(async () => fireEvent.keyDown(items[0]!, { key: "Escape" }));
    expect(screen.queryByRole("menu", { name: "Board menu" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(board));
  });
});
