// The bar over a selection: one small colour dot (the swatches only when it
// is pressed), the few actions that fit what is selected, the keys 1 to 9 for
// colours, and a connection's own small bar.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { BoardNode } from "../../../lib/vault/types";
import { MemoryVault } from "../../workspace/preview/memory-vault";
import { derive } from "../../workspace/store-layout";
import { useWorkspace } from "../../workspace/store";
import { initialLayout } from "../../workspace/tabs";
import { useBoards } from "../store";
import { BoardCanvas } from "./BoardCanvas";
import { colorForKey, keyForColor, PRESETS } from "./colors";
import { mockReactFlow } from "./test/flow-mocks";
import { barActions } from "./toolbar/selection-actions";
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
      { id: "s2", type: "text", text: "Another", x: 400, y: 600, width: 260, height: 120, color: "2" },
    ],
    edges: [{ id: "e1", fromNode: "s1", fromSide: "right", toNode: "s2", toSide: "left" }],
    "x-kasten": { title: "Main" },
  }),
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
  await waitFor(() => expect(view.container.querySelectorAll(".react-flow__node")).toHaveLength(4));
  const node = (id: string) => view.container.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)!;
  /** Selects one node without opening it (a Shift+click). */
  const choose = async (id: string) => {
    fireEvent.click(node(id), { shiftKey: true });
    await waitFor(() => expect(node(id).classList.contains("selected")).toBe(true));
  };
  return { view, board, node, choose };
}

const colourOf = async (id: string) => (await vault.board(MAIN)).nodes.find((n) => n.id === id)?.color;
const bar = () => screen.findByRole("toolbar", { name: "Selection" });
const names = (el: HTMLElement) => within(el).getAllByRole("button").map((b) => b.getAttribute("aria-label"));

const node = (patch: Partial<BoardNode>): BoardNode => ({ id: "n", kind: "text", x: 0, y: 0, width: 100, height: 50, ...patch });

describe("what the selection's bar offers", () => {
  it("is a few actions that fit the kind, always led by the colour dot and ending with More", () => {
    expect(barActions([])).toEqual([]);
    expect(barActions([node({ kind: "group", label: "Ideas" })])).toEqual(["colour", "fold", "ungroup", "more"]);
    expect(barActions([node({ kind: "file", file: "a.md" })])).toEqual(["colour", "size", "open", "remove", "more"]);
    expect(barActions([node({ kind: "file", file: "a.md", missing: true })])).toEqual(["colour", "group", "remove", "more"]);
    expect(barActions([node({ text: "A sticky" })])).toEqual(["colour", "group", "remove", "more"]);
    expect(barActions([node({ shape: "ellipse" })])).toEqual(["colour", "group", "remove", "more"]);
    expect(barActions([node({ kind: "link", url: "https://example.com" })])).toEqual(["colour", "group", "remove", "more"]);
    expect(barActions([node({ id: "a" }), node({ id: "b" })])).toEqual(["colour", "align", "group", "remove", "more"]);
    for (const nodes of [[node({ kind: "group" })], [node({ kind: "file", file: "a.md" })], [node({}), node({ id: "b" })]]) expect(barActions(nodes).length).toBeLessThanOrEqual(5);
  });

  it("names nine colours that the keys 1 to 9 pick, and 0 for none", () => {
    expect(PRESETS).toHaveLength(9);
    expect(PRESETS.map((p) => p.name)).toEqual(["Red", "Orange", "Yellow", "Green", "Cyan", "Purple", "Pink", "Brown", "Grey"]);
    expect(PRESETS.slice(0, 6).map((p) => p.value)).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(PRESETS.slice(6).every((p) => /^#[0-9a-f]{6}$/.test(p.value))).toBe(true);
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => colorForKey(String(n)))).toEqual(PRESETS.map((p) => p.value));
    expect(colorForKey("0")).toBeNull();
    expect(colorForKey("a")).toBeUndefined();
    expect(colorForKey("10")).toBeUndefined();
    expect(keyForColor("#d6409f")).toBe("7");
    expect(keyForColor(null)).toBeNull();
  });
});

describe("the bar over a section", () => {
  it("shows one colour dot, not the colours, and opens the swatches only when the dot is pressed", async () => {
    const { choose } = await open();
    await choose("g");
    const selection = await bar();
    // The dot, fold, ungroup and More: four buttons, no swatches.
    expect(names(selection)).toEqual(["Colour: none", "Fold section", "Ungroup section", "More"]);
    expect(within(selection).queryByRole("group", { name: "Colour" })).toBeNull();
    expect(selection.querySelectorAll(".kasten-board-swatch")).toHaveLength(0);

    fireEvent.click(within(selection).getByRole("button", { name: "Colour: none" }));
    const swatches = within(selection).getByRole("group", { name: "Colour" });
    // None and the nine.
    expect(within(swatches).getAllByRole("button")).toHaveLength(10);
    expect(within(swatches).getByRole("button", { name: "No colour" }).getAttribute("aria-pressed")).toBe("true");

    await act(async () => fireEvent.click(within(swatches).getByRole("button", { name: "Green" })));
    await waitFor(async () => expect(await colourOf("g")).toBe("4"));
    // Chosen, it closes and the dot shows the colour.
    await waitFor(() => expect(within(selection).queryByRole("group", { name: "Colour" })).toBeNull());
    expect(within(selection).getByRole("button", { name: "Colour: Green" })).toBeTruthy();
  });

  it("closes the swatches with Escape, which leaves the selection alone", async () => {
    const { choose, node } = await open();
    await choose("g");
    const selection = await bar();
    const dot = within(selection).getByRole("button", { name: "Colour: none" });
    fireEvent.click(dot);
    const first = within(selection).getByRole("button", { name: "No colour" });
    await waitFor(() => expect(document.activeElement).toBe(first));
    // Along the swatches with the arrows.
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(document.activeElement!.getAttribute("aria-label")).toBe("Red");
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(within(selection).queryByRole("group", { name: "Colour" })).toBeNull();
    expect(document.activeElement).toBe(dot);
    expect(node("g").classList.contains("selected")).toBe(true);
  });

  it("takes a number key inside the swatches as the colour, and no arrow moves the selection", async () => {
    const { choose } = await open();
    await choose("g");
    const selection = await bar();
    fireEvent.click(within(selection).getByRole("button", { name: "Colour: none" }));
    const first = within(selection).getByRole("button", { name: "No colour" });
    const before = (await vault.board(MAIN)).nodes.find((n) => n.id === "g")!;
    // An arrow goes along the swatches (and round), not on to the board to nudge the section.
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement!.getAttribute("aria-label")).toBe("Red");
    await act(async () => fireEvent.keyDown(document.activeElement!, { key: "3" }));
    await waitFor(async () => expect(await colourOf("g")).toBe("3"));
    expect(within(selection).queryByRole("group", { name: "Colour" })).toBeNull();
    const after = (await vault.board(MAIN)).nodes.find((n) => n.id === "g")!;
    expect([after.x, after.y]).toEqual([before.x, before.y]);
  });

  it("takes the section away without its contents when ungrouped, and folds it", async () => {
    const { choose } = await open();
    await choose("g");
    fireEvent.click(within(await bar()).getByRole("button", { name: "Fold section" }));
    await waitFor(async () => expect((await vault.board(MAIN)).nodes.find((n) => n.id === "g")?.collapsed).toBe(true));
    fireEvent.click(within(await bar()).getByRole("button", { name: "Ungroup section" }));
    await waitFor(async () => expect((await vault.board(MAIN)).nodes.some((n) => n.id === "g")).toBe(false));
    expect((await vault.board(MAIN)).nodes.some((n) => n.id === "c1")).toBe(true);
  });
});

describe("the bar over other things", () => {
  it("offers a card its size and a way to open it, and a sticky only the few that fit", async () => {
    const { choose } = await open();
    await choose("c1");
    expect(names(await bar())).toEqual(["Colour: none", "Card size", "Open in the side stack", "Remove from board", "More"]);
    // Its size is a small menu, not a row of buttons.
    fireEvent.click(within(await bar()).getByRole("button", { name: "Card size" }));
    const sizes = screen.getByRole("menu", { name: "Card size" });
    expect(within(sizes).getAllByRole("menuitemradio").map((i) => i.textContent)).toEqual(["Title only", "Title and first lines", "Whole note"]);
    fireEvent.click(within(sizes).getByRole("menuitemradio", { name: "Title only" }));
    await waitFor(async () => expect((await vault.board(MAIN)).nodes.find((n) => n.id === "c1")?.size).toBe("title"));

    await choose("s1");
    await waitFor(() => expect(names(screen.getByRole("toolbar", { name: "Selection" }))).toEqual(["Colour: none", "Wrap in a section", "Remove from board", "More"]));
  });

  it("shows the colour a thing has, and a dashed dot for several different ones", async () => {
    const { board, choose, view } = await open();
    await choose("s2");
    expect(within(await bar()).getByRole("button", { name: "Colour: Orange" })).toBeTruthy();
    fireEvent.keyDown(board, { key: "a", ctrlKey: true });
    await waitFor(() => expect(within(screen.getByRole("toolbar", { name: "Selection" })).getByRole("button", { name: "Colour: mixed" })).toBeTruthy());
    expect(view.container.querySelector(".kasten-dot.is-mixed")).toBeTruthy();
    // Several things: the dot, align, wrap, remove and More.
    expect(names(screen.getByRole("toolbar", { name: "Selection" }))).toEqual(["Colour: mixed", "Align and arrange", "Wrap in a section", "Remove from board", "More"]);
  });

  it("opens the board's menu from More", async () => {
    const { choose } = await open();
    await choose("s1");
    fireEvent.click(within(await bar()).getByRole("button", { name: "More" }));
    const menu = await screen.findByRole("menu", { name: "Board menu" });
    expect(within(menu).getByRole("menuitem", { name: /Wrap in a section/ })).toBeTruthy();
    // The menu does not list the colours until asked either.
    expect(within(menu).queryByRole("group", { name: "Colour" })).toBeNull();
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Colour…/ }));
    expect(within(menu).getByRole("group", { name: "Colour" })).toBeTruthy();
  });
});

describe("colour keys", () => {
  it("colour the selection with 1 to 9 and take the colour off with 0", async () => {
    const { board, choose } = await open();
    await choose("s1");
    await act(async () => fireEvent.keyDown(board, { key: "3" }));
    await waitFor(async () => expect(await colourOf("s1")).toBe("3"));
    await act(async () => fireEvent.keyDown(board, { key: "7" }));
    await waitFor(async () => expect(await colourOf("s1")).toBe("#d6409f"));
    await act(async () => fireEvent.keyDown(board, { key: "9" }));
    await waitFor(async () => expect(await colourOf("s1")).toBe("#7a7a7a"));
    await act(async () => fireEvent.keyDown(board, { key: "0" }));
    await waitFor(async () => expect(await colourOf("s1")).toBeUndefined());
  });

  it("colour everything selected at once, and do nothing with nothing selected", async () => {
    const { board } = await open();
    await act(async () => fireEvent.keyDown(board, { key: "2" }));
    expect((await vault.board(MAIN)).nodes.filter((n) => n.color === "2")).toHaveLength(1);
    fireEvent.keyDown(board, { key: "a", ctrlKey: true });
    await waitFor(() => expect(board.querySelectorAll(".react-flow__node.selected")).toHaveLength(4));
    await act(async () => fireEvent.keyDown(board, { key: "5" }));
    await waitFor(async () => expect((await vault.board(MAIN)).nodes.every((n) => n.color === "5")).toBe(true));
  });

  it("leave Shift+1 to fit the view and keys typed into a sticky to the sticky", async () => {
    const { board, node, choose } = await open();
    await choose("s1");
    const before = (await vault.board(MAIN)).nodes.find((n) => n.id === "s1")?.color;
    fireEvent.keyDown(board, { key: "!", code: "Digit1", shiftKey: true });
    expect(await colourOf("s1")).toBe(before);
    fireEvent.doubleClick(node("s1"));
    const field = await screen.findByRole("textbox", { name: "Sticky text" });
    fireEvent.keyDown(field, { key: "4" });
    expect(await colourOf("s1")).toBe(before);
  });
});

describe("a connection's bar", () => {
  it("has the same colour dot, and no row of swatches", async () => {
    const { view } = await open();
    const edge = view.container.querySelector<SVGElement>('.react-flow__edge[data-id="e1"]')!;
    expect(edge).toBeTruthy();
    fireEvent.click(edge);
    const selection = await screen.findByRole("toolbar", { name: "Connection" });
    expect(within(selection).getByRole("button", { name: "Colour: none" })).toBeTruthy();
    expect(selection.querySelectorAll(".kasten-board-swatch")).toHaveLength(0);
    expect(names(selection)).toEqual(["Colour: none", "Arrow at the end", "Curved line", "Dashed", "Edit label", "Delete connection"]);
    fireEvent.click(within(selection).getByRole("button", { name: "Colour: none" }));
    await act(async () => fireEvent.click(within(selection).getByRole("button", { name: "Purple" })));
    await waitFor(async () => expect((await vault.board(MAIN)).edges[0]?.color).toBe("6"));
  });
});
