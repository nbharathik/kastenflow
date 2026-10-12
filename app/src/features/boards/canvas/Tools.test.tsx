// The board's tools: picking them by key and from the bar,
// placing a shape, drawing a stroke and erasing it again.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { MemoryVault } from "../../workspace/preview/memory-vault";
import { derive } from "../../workspace/store-layout";
import { useWorkspace } from "../../workspace/store";
import { initialLayout } from "../../workspace/tabs";
import { useBoards } from "../store";
import { BoardCanvas } from "./BoardCanvas";
import { mockReactFlow } from "./test/flow-mocks";
import { forgetTrails } from "./trail";

const MAIN = "library/main.canvas";
const STROKE = { id: "d1", type: "text", text: "", x: 400, y: 0, width: 120, height: 40 };
const SEED = {
  [MAIN]: JSON.stringify({
    nodes: [{ id: "s1", type: "text", text: "A sticky", x: 0, y: 0, width: 260, height: 120 }, STROKE],
    edges: [],
    "x-kasten": { title: "Main", draw: { d1: { points: "4,20 60,20 116,20", size: 4 } } },
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
  await waitFor(() => expect(view.container.querySelectorAll(".react-flow__node")).toHaveLength(2));
  const pane = view.container.querySelector<HTMLElement>(".react-flow__pane")!;
  /** Where a point on the board is on screen (the board's element sits at 0, 0). */
  const screenOf = (x: number, y: number) => {
    const t = view.container.querySelector<HTMLElement>(".react-flow__viewport")!.style.transform;
    const [, tx, ty, zoom] = /translate\(([-\d.]+)px, ?([-\d.]+)px\) ?scale\(([\d.]+)\)/.exec(t)!.map(Number);
    return { clientX: x * zoom! + tx!, clientY: y * zoom! + ty! };
  };
  return { view, board, pane, screenOf };
}

const nodes = async () => (await vault.board(MAIN)).nodes;

describe("board tools", () => {
  it("picks tools with their keys and the bar, and Esc goes back to selecting", async () => {
    const { board } = await open();
    const bar = screen.getByRole("toolbar", { name: "Tools" });
    await act(async () => fireEvent.keyDown(board, { key: "d" }));
    expect(board.className).toContain("is-tool-draw");
    expect(within(bar).getByRole("button", { name: "Pen" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("group", { name: "Pen" })).toBeTruthy();
    await act(async () => fireEvent.keyDown(board, { key: "Escape" }));
    expect(board.className).toContain("is-tool-select");
    // The pen's own options hold the eraser, and the key X reaches it too.
    expect(within(bar).queryByRole("button", { name: "Eraser" })).toBeNull();
    fireEvent.click(within(bar).getByRole("button", { name: "Pen" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Pen" })).getByRole("button", { name: "Eraser" }));
    expect(board.className).toContain("is-tool-erase");
    await act(async () => fireEvent.keyDown(board, { key: "Escape" }));
    await act(async () => fireEvent.keyDown(board, { key: "x" }));
    expect(board.className).toContain("is-tool-erase");
    fireEvent.click(within(bar).getByRole("button", { name: "Shapes" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Shapes" })).getByRole("button", { name: "Diamond" }));
    expect(within(bar).getByRole("button", { name: "Shapes" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps the strip to select, hand, sticky, shapes, pen, connector, section and +", async () => {
    await open();
    const bar = screen.getByRole("toolbar", { name: "Tools" });
    expect(within(bar).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Select", "Hand", "Sticky", "Shapes", "Pen", "Connector", "Section", "Add"]);
  });

  it("joins two things with the connector tool and then goes back to selecting", async () => {
    const { board, view } = await open();
    await act(async () => fireEvent.keyDown(board, { key: "l" }));
    expect(board.className).toContain("is-tool-connect");
    expect(within(screen.getByRole("toolbar", { name: "Tools" })).getByRole("button", { name: "Connector" }).getAttribute("aria-pressed")).toBe("true");
    // Nothing moves or opens while it is the tool.
    const sticky = view.container.querySelector<HTMLElement>('.react-flow__node[data-id="s1"]')!;
    fireEvent.click(sticky);
    expect(useWorkspace.getState().stack).toEqual([]);
    await act(async () => fireEvent.keyDown(board, { key: "Escape" }));
    expect(board.className).toContain("is-tool-select");
  });

  it("clears the selection when a drawing tool is picked", async () => {
    const { view, board } = await open();
    await act(async () => fireEvent.keyDown(board, { key: "a", ctrlKey: true }));
    await waitFor(() => expect(view.container.querySelectorAll(".react-flow__node.selected")).toHaveLength(2));
    await act(async () => fireEvent.keyDown(board, { key: "h" }));
    expect(view.container.querySelectorAll(".react-flow__node.selected")).toHaveLength(2);
    await act(async () => fireEvent.keyDown(board, { key: "d" }));
    expect(view.container.querySelectorAll(".react-flow__node.selected")).toHaveLength(0);
  });

  it("places a shape where the board is clicked, then selects again", async () => {
    const { board, pane, screenOf } = await open();
    await act(async () => fireEvent.keyDown(board, { key: "o" }));
    const at = screenOf(200, 400);
    await act(async () => {
      fireEvent.pointerDown(pane, { button: 0, pointerId: 1, ...at });
      fireEvent.pointerUp(pane, { button: 0, pointerId: 1, ...at });
    });
    await waitFor(async () => expect((await nodes()).some((n) => n.shape === "ellipse")).toBe(true));
    const shape = (await nodes()).find((n) => n.shape === "ellipse")!;
    expect(Math.round(shape.x + shape.width / 2)).toBe(200);
    expect(Math.round(shape.y + shape.height / 2)).toBe(400);
    expect(board.className).toContain("is-tool-select");
  });

  it("draws a stroke with the pen, and erases what the eraser crosses", async () => {
    const { board, pane, screenOf } = await open();
    await act(async () => fireEvent.keyDown(board, { key: "d" }));
    await act(async () => {
      fireEvent.pointerDown(pane, { button: 0, pointerId: 1, ...screenOf(0, 300) });
      for (let i = 1; i <= 10; i++) fireEvent.pointerMove(pane, { pointerId: 1, buttons: 1, ...screenOf(i * 20, 300 + (i % 2) * 30) });
      fireEvent.pointerUp(pane, { pointerId: 1, ...screenOf(200, 300) });
    });
    await waitFor(async () => expect((await nodes()).filter((n) => n.draw)).toHaveLength(2));
    const drawn = (await nodes()).find((n) => n.draw && n.id !== "d1")!;
    expect(drawn.draw!.size).toBe(4);
    expect(drawn.draw!.points.split(" ").length).toBeGreaterThan(5);

    // The eraser crosses the seeded stroke from top to bottom, and only it.
    await act(async () => fireEvent.keyDown(board, { key: "x" }));
    await act(async () => {
      fireEvent.pointerDown(pane, { button: 0, pointerId: 2, ...screenOf(460, -20) });
      for (let y = -10; y <= 60; y += 10) fireEvent.pointerMove(pane, { pointerId: 2, buttons: 1, ...screenOf(460, y) });
      fireEvent.pointerUp(pane, { pointerId: 2, ...screenOf(460, 60) });
    });
    await waitFor(async () => expect((await nodes()).some((n) => n.id === "d1")).toBe(false));
    expect((await nodes()).map((n) => n.id)).toContain("s1");

    // Undo brings it back as it was.
    await act(async () => fireEvent.keyDown(board, { key: "z", ctrlKey: true }));
    await waitFor(async () => expect((await nodes()).find((n) => n.id === "d1")?.draw?.points).toBe("4,20 60,20 116,20"));
  });

  it("ends a stroke whose release never came, keeping what was drawn", async () => {
    const { board, pane, screenOf } = await open();
    await act(async () => fireEvent.keyDown(board, { key: "d" }));
    await act(async () => {
      fireEvent.pointerDown(pane, { button: 0, pointerId: 3, ...screenOf(0, 500) });
      for (let i = 1; i <= 6; i++) fireEvent.pointerMove(pane, { pointerId: 3, buttons: 1, ...screenOf(i * 20, 500) });
      // The button went up where the board never heard of it.
      fireEvent.pointerMove(pane, { pointerId: 3, buttons: 0, ...screenOf(400, 700) });
      fireEvent.pointerMove(pane, { pointerId: 3, buttons: 0, ...screenOf(500, 800) });
    });
    await waitFor(async () => expect((await nodes()).filter((n) => n.draw)).toHaveLength(2));
    const drawn = (await nodes()).find((n) => n.draw && n.id !== "d1")!;
    expect(drawn.width).toBeLessThan(200);
    expect(board.querySelector(".kasten-sketch path, .kasten-sketch polyline")).toBeNull();
  });
});
