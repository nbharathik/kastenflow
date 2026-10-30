// The whiteboard's main flows against the browser preview's vault: open a
// board, add and write on a sticky, connect, remove and undo, drop notes
// and highlights, go into a nested board and back, and one note on two
// boards.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { HIGHLIGHT_DRAG, NOTE_DRAG } from "../../workspace/drag";
import { settleStats } from "../../workspace/note-stats";
import { MemoryVault } from "../../workspace/preview/memory-vault";
import { derive } from "../../workspace/store-layout";
import { useWorkspace } from "../../workspace/store";
import { initialLayout } from "../../workspace/tabs";
import { useBoards } from "../store";
import { BoardCanvas, BoardView, boardDeps } from "./BoardCanvas";
import { BoardController } from "./state/controller";
import { connect } from "./state/gestures";
import { mockReactFlow, reportResizes } from "./test/flow-mocks";
import { placeOn, sideFor } from "./toolbar/ContextMenu";
import { forgetTrails } from "./trail";

const MAIN = "projects/demo/boards/main.canvas";
const INNER = "library/inner.canvas";
const IDEA = "projects/demo/cards/idea.md";
const PLAN = "projects/demo/cards/plan.md";

const SEED = {
  "projects/demo/_project.md": "---\ntitle: Demo\ntype: project\n---\nThe project.\n",
  [IDEA]: "---\ntitle: Idea\ntype: card\ntags: [paper]\n---\nThe first lines of the idea.\n",
  [PLAN]: "---\ntitle: Plan\ntype: card\n---\nWhat to do next.\n",
  "library/loose.md": "---\ntitle: Loose note\n---\nOn no board yet.\n",
  [MAIN]: JSON.stringify({
    nodes: [
      { id: "g", type: "group", label: "Ideas", x: -40, y: -80, width: 800, height: 420 },
      { id: "c1", type: "file", file: IDEA, x: 0, y: 0, width: 320, height: 180 },
      { id: "c2", type: "file", file: PLAN, x: 400, y: 0, width: 320, height: 180 },
      { id: "s1", type: "text", text: "A sticky", x: 0, y: 600, width: 260, height: 120 },
      { id: "b1", type: "file", file: INNER, x: 400, y: 600, width: 320, height: 180 },
    ],
    edges: [{ id: "e1", fromNode: "c1", fromSide: "right", toNode: "c2", toSide: "left", label: "leads to" }],
    "x-kasten": { title: "Main" },
  }),
  [INNER]: JSON.stringify({ nodes: [{ id: "x", type: "file", file: IDEA, x: 0, y: 0, width: 320, height: 180 }], edges: [], "x-kasten": { title: "Inner" } }),
};

let vault: MemoryVault;
/** A card's title (each card also holds a big copy for far out). */
const TITLE = ".kasten-card-title";

beforeAll(mockReactFlow);

beforeEach(async () => {
  localStorage.clear();
  forgetTrails();
  vault = new MemoryVault(SEED);
  useWorkspace.setState({ client: vault, ready: true, notes: await vault.list(), ...derive(initialLayout()), stack: [], stackOpen: false, recent: [], toasts: [] });
  await useBoards.getState().load();
});
afterEach(cleanup);

/** Opens a board and waits for its canvas. */
async function open(path = MAIN) {
  const view = render(<BoardCanvas path={path} />);
  const board = await view.findByLabelText(/^Whiteboard:/);
  // React Flow draws the nodes a render after the canvas.
  const count = (await vault.board(path)).nodes.length;
  await waitFor(() => expect(view.container.querySelectorAll(".react-flow__node")).toHaveLength(count));
  return { view, board, node: (id: string) => view.container.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`) };
}

const onDisk = async (path = MAIN) => vault.board(path);

describe("the whiteboard", () => {
  it("shows cards with their notes' titles and first lines, stickies, sections, edges and nested boards", async () => {
    const { board } = await open();
    const canvas = within(board);
    expect(await canvas.findByText("Idea", { selector: TITLE })).toBeTruthy();
    for (const text of ["The first lines of the idea.", "#paper", "A sticky", "Ideas", "leads to"]) expect(await canvas.findByText(text)).toBeTruthy();
    expect(await canvas.findByLabelText("Board: Inner")).toBeTruthy();
    // Edges show between nodes nobody has pointed at yet.
    expect(board.querySelector('.react-flow__edge[data-id="e1"] path')).toBeTruthy();
    expect(within(canvas.getByRole("navigation", { name: "Board breadcrumb" })).getByText("Main")).toBeTruthy();
  });

  it("stars the cards whose notes have agent writing to review, asking once for the board", async () => {
    const asked: string[][] = [];
    vault.agentMarked = async (paths) => {
      asked.push(paths);
      return paths.filter((p) => p === IDEA);
    };
    const { node } = await open();
    const star = { name: "Agent writing to review" };
    expect(await within(node("c1")!).findByRole("img", star)).toBeTruthy();
    expect(within(node("c2")!).queryByRole("img", star)).toBeNull();
    expect(asked).toEqual([[IDEA, PLAN]]);
  });

  it("adds a sticky and writes in it", async () => {
    const { board } = await open();
    fireEvent.click(within(board).getByRole("button", { name: "Sticky" }));
    const field = (await within(board).findByRole("textbox", { name: "Sticky text" })) as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "Fresh **idea**" } });
    fireEvent.blur(field);
    await waitFor(async () => expect((await onDisk()).nodes.some((n) => n.kind === "text" && n.text === "Fresh **idea**")).toBe(true));
    expect(await within(board).findByText("idea", { selector: "strong" })).toBeTruthy();
  });

  it("writes on a sticky after a double-click", async () => {
    const { board, node } = await open();
    fireEvent.doubleClick(node("s1")!);
    const field = (await within(board).findByRole("textbox", { name: "Sticky text" })) as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "Changed" } });
    fireEvent.keyDown(field, { key: "Escape" });
    await waitFor(async () => expect((await onDisk()).nodes.find((n) => n.id === "s1")?.text).toBe("Changed"));
  });

  it("connects two nodes between the sides dragged", async () => {
    const board = new BoardController(MAIN, await vault.board(MAIN), boardDeps(vault, MAIN));
    const view = render(<BoardView board={board} />);
    await waitFor(() => expect(view.container.querySelectorAll(".react-flow__node")).toHaveLength(board.doc.nodes.length));
    await act(async () => connect(board, "s1", "c2", "top", "bottom"));
    await waitFor(async () => expect((await onDisk()).edges.find((e) => e.from === "s1")).toMatchObject({ to: "c2", fromSide: "top", toSide: "bottom" }));
    const id = board.doc.edges.find((e) => e.from === "s1")!.id;
    await waitFor(() => expect(view.container.querySelector(`.react-flow__edge[data-id="${id}"]`)).toBeTruthy());
  });

  it("takes a card off the board with Delete, keeps the note, and undoes it", async () => {
    const { board, node } = await open();
    fireEvent.click(node("c2")!, { shiftKey: true });
    await waitFor(() => expect(node("c2")!.classList.contains("selected")).toBe(true));
    fireEvent.keyDown(board, { key: "Delete" });
    await waitFor(() => expect(node("c2")).toBeNull());
    expect((await onDisk()).nodes.some((n) => n.id === "c2")).toBe(false);
    expect((await onDisk()).edges).toEqual([]);
    expect((await vault.list()).some((n) => n.path === PLAN)).toBe(true);
    fireEvent.keyDown(board, { key: "z", ctrlKey: true });
    await waitFor(() => expect(node("c2")).toBeTruthy());
    expect((await onDisk()).edges.map((e) => e.id)).toEqual(["e1"]);
    fireEvent.keyDown(board, { key: "z", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(node("c2")).toBeNull());
  });

  it("opens a clicked card in the side stack, but not a Shift+click", async () => {
    const { node } = await open();
    fireEvent.click(node("c2")!, { shiftKey: true });
    expect(useWorkspace.getState().stack).toEqual([]);
    fireEvent.click(node("c1")!);
    expect(useWorkspace.getState().stack).toEqual([IDEA]);
    expect(useWorkspace.getState().stackOpen).toBe(true);
    fireEvent.click(node("c2")!, { ctrlKey: true });
    expect(useWorkspace.getState().layout.panes[0]!.tabs.map((t) => t.place.path)).toContain(PLAN);
  });

  it("puts dropped notes where they land, and selects ones already there", async () => {
    const { board, node } = await open();
    const dataTransfer = {
      types: [NOTE_DRAG, "text/plain"],
      effectAllowed: "copyLink",
      dropEffect: "none",
      getData: (type: string) => (type === NOTE_DRAG ? `library/loose.md\n${PLAN}` : ""),
    };
    fireEvent.dragOver(board, { dataTransfer, clientX: 300, clientY: 200 });
    fireEvent.drop(board, { dataTransfer, clientX: 300, clientY: 200 });
    await waitFor(async () => expect((await onDisk()).nodes.filter((n) => n.file === "library/loose.md")).toHaveLength(1));
    expect((await onDisk()).nodes.filter((n) => n.file === PLAN)).toHaveLength(1);
    await waitFor(() => expect(node("c2")!.classList.contains("selected")).toBe(true));
  });

  it("drops highlights as their cards, made the first time", async () => {
    const pdf = "sources/primer.pdf";
    vault.addSampleSource(pdf, async () => new TextEncoder().encode("%PDF-1.7\n"));
    const h = await vault.addHighlight(pdf, { page: 1, rects: [[72, 500, 300, 512]], text: "Structure is the result of the work.", color: "purple" });
    const { board, node } = await open();
    const dataTransfer = {
      types: [HIGHLIGHT_DRAG, "text/plain"],
      effectAllowed: "copy",
      dropEffect: "none",
      getData: (type: string) => (type === HIGHLIGHT_DRAG ? JSON.stringify([{ source: pdf, id: h.id }]) : ""),
    };
    const drop = () => {
      fireEvent.dragOver(board, { dataTransfer, clientX: 300, clientY: 200 });
      fireEvent.drop(board, { dataTransfer, clientX: 300, clientY: 200 });
    };
    drop();
    await waitFor(async () => expect((await vault.highlights(pdf))[0]!.card).toBeTruthy());
    const card = (await vault.highlights(pdf))[0]!.card!;
    await waitFor(async () => expect((await onDisk()).nodes.filter((n) => n.file === card)).toHaveLength(1));
    expect(await within(board).findByText("Structure is the result of the work.", { selector: TITLE })).toBeTruthy();
    // Dropped again: the same card, selected, not a second one.
    drop();
    const id = (await onDisk()).nodes.find((n) => n.file === card)!.id;
    await waitFor(() => expect(node(id)!.classList.contains("selected")).toBe(true));
    expect((await onDisk()).nodes.filter((n) => n.file === card)).toHaveLength(1);
  });

  it("goes into a nested board with a double-click and back up by the breadcrumb", async () => {
    const first = await open();
    fireEvent.doubleClick(first.node("b1")!);
    expect(useWorkspace.getState().place).toEqual({ view: "boards", path: INNER });
    first.view.unmount();
    const inner = await open(INNER);
    const crumbs = within(inner.board).getByRole("navigation", { name: "Board breadcrumb" });
    expect(crumbs.textContent).toContain("Main");
    expect(crumbs.textContent).toContain("Inner");
    fireEvent.click(within(crumbs).getByRole("button", { name: "Main" }));
    expect(useWorkspace.getState().place).toEqual({ view: "boards", path: MAIN });
  });

  it("shows a note on two boards the same, and edits reach both", async () => {
    const main = await open(MAIN);
    const inner = await open(INNER);
    expect(within(main.board).getByText("Idea", { selector: TITLE })).toBeTruthy();
    expect(within(inner.board).getByText("Idea", { selector: TITLE })).toBeTruthy();
    // Typing in the note, as the editor saves it.
    const note = await vault.read(IDEA);
    const saved = await vault.saveBody(IDEA, "A sharper first line.\n", note.hash);
    act(() => useWorkspace.getState().noteChanged(saved.note.meta));
    // The list takes a typed page's new excerpt once typing settles; leaving the page settles it at once.
    act(() => settleStats());
    expect(within(main.board).getByText("A sharper first line.")).toBeTruthy();
    expect(within(inner.board).getByText("A sharper first line.")).toBeTruthy();
    // A new title moves the file; both boards follow it.
    await act(async () => useWorkspace.getState().rename(IDEA, "Better idea"));
    await waitFor(() => expect(within(main.board).getByText("Better idea", { selector: TITLE })).toBeTruthy());
    await waitFor(() => expect(within(inner.board).getByText("Better idea", { selector: TITLE })).toBeTruthy());
    await waitFor(async () => expect((await onDisk(INNER)).nodes[0]).toMatchObject({ file: "projects/demo/cards/better-idea.md", title: "Better idea" }));
  });

  it("makes a new card in the board's project on a double-click, expanded", async () => {
    const { view } = await open();
    const pane = view.container.querySelector(".react-flow__pane")!;
    fireEvent.doubleClick(pane, { clientX: 500, clientY: 500 });
    await waitFor(async () => expect((await onDisk()).nodes.some((n) => n.file?.startsWith("projects/demo/cards/untitled") && n.size === "expanded")).toBe(true), { timeout: 5000 });
    expect((await vault.list()).some((n) => n.path.startsWith("projects/demo/cards/untitled"))).toBe(true);
  });

  it("selects everything with Ctrl+A and nothing with Escape", async () => {
    const { board, view } = await open();
    fireEvent.keyDown(board, { key: "a", ctrlKey: true });
    await waitFor(() => expect(view.container.querySelectorAll(".react-flow__node.selected")).toHaveLength(5));
    fireEvent.keyDown(board, { key: "Escape" });
    await waitFor(() => expect(view.container.querySelectorAll(".react-flow__node.selected")).toHaveLength(0));
  });

  it("moves a note to the trash only when asked, and keeps its card as missing", async () => {
    const { board, node } = await open();
    fireEvent.contextMenu(node("c2")!);
    const menu = await screen.findByRole("menu", { name: "Board menu" });
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Move note to trash/ }));
    fireEvent.click(within(menu).getByRole("button", { name: "Move to trash" }));
    await waitFor(async () => expect((await vault.list()).some((n) => n.path === PLAN)).toBe(false));
    expect((await vault.listTrash()).map((t) => t.original)).toContain(PLAN);
    await waitFor(() => expect(within(board).getByLabelText("Missing: plan.md")).toBeTruthy());
    expect((await onDisk()).nodes.some((n) => n.id === "c2")).toBe(true);
  });

  it("copies a link to a section, which opens the board there; a card has no such entry", async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (text: string) => void written.push(text) }, configurable: true });
    const { node } = await open();
    fireEvent.contextMenu(node("c2")!);
    const cardMenu = await screen.findByRole("menu", { name: "Board menu" });
    expect(within(cardMenu).queryByRole("menuitem", { name: "Copy link to this location" })).toBeNull();
    fireEvent.keyDown(cardMenu, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu", { name: "Board menu" })).toBeNull());
    fireEvent.contextMenu(node("g")!);
    const menu = await screen.findByRole("menu", { name: "Board menu" });
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Copy link to this location" }));
    await waitFor(() => expect(written).toEqual([`kasten:board/${MAIN}?node=g`]));
  });

  it("keeps its menu inside the window as the menu grows", async () => {
    const { board, node } = await open();
    fireEvent.keyDown(board, { key: "a", ctrlKey: true });
    await waitFor(() => expect(board.querySelectorAll(".react-flow__node.selected")).toHaveLength(5));
    fireEvent.contextMenu(node("c2")!, { clientX: 300, clientY: 700 });
    const menu = await screen.findByRole("menu", { name: "Board menu" });
    let height = 200;
    menu.getBoundingClientRect = () => ({ x: 300, y: 0, left: 300, top: 0, width: 240, height, right: 540, bottom: height, toJSON: () => ({}) });
    act(reportResizes);
    expect(menu.style.top).toBe(`${window.innerHeight - 200 - 8}px`);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Align and arrange…" }));
    height = 500;
    act(reportResizes);
    expect(menu.style.top).toBe(`${window.innerHeight - 500 - 8}px`);
  });

  it("opens its menu up and left of the pointer where it would not fit, and grows up", async () => {
    const { node } = await open();
    let height = 380;
    const measured = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      if (this.getAttribute("role") !== "menu") return measured.call(this);
      return { x: 0, y: 0, left: 0, top: 0, width: 230, height, right: 230, bottom: height, toJSON: () => ({}) };
    };
    try {
      fireEvent.contextMenu(node("c2")!, { clientX: window.innerWidth - 24, clientY: window.innerHeight - 68 });
      const menu = await screen.findByRole("menu", { name: "Board menu" });
      // Its corner at the pointer, so a release there picks nothing.
      expect(menu.style.left).toBe(`${window.innerWidth - 24 - 230}px`);
      expect(menu.style.top).toBe(`${window.innerHeight - 68 - 380}px`);
      height = 500;
      act(reportResizes);
      expect(menu.style.top).toBe(`${window.innerHeight - 68 - 500}px`);
    } finally {
      HTMLElement.prototype.getBoundingClientRect = measured;
    }
  });
});

describe("where a menu opens", () => {
  it("opens after the pointer when it fits, else before it, else as near as it can", () => {
    expect(sideFor(100, 200, 1000)).toBe("after");
    expect(sideFor(900, 200, 1000)).toBe("before");
    expect(sideFor(150, 900, 1000)).toBe("after");
    expect(placeOn("after", 900, 200, 1000)).toBe(792);
    expect(placeOn("before", 900, 200, 1000)).toBe(700);
    expect(placeOn("before", 150, 900, 1000)).toBe(8);
  });
});
