// Mind-map mode on a whiteboard, against the browser preview's vault: Tab
// grows a child, Tab while writing grows the next, Shift+Enter a sibling,
// and the Mind map layout lays out what is connected.

import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { MemoryVault } from "../../workspace/preview/memory-vault";
import { derive } from "../../workspace/store-layout";
import { useWorkspace } from "../../workspace/store";
import { initialLayout } from "../../workspace/tabs";
import { useBoards } from "../store";
import { BoardCanvas } from "./BoardCanvas";
import { ACROSS } from "./model/mind-map";
import { mockReactFlow } from "./test/flow-mocks";
import { forgetTrails } from "./trail";

const MAP = "projects/demo/boards/map.canvas";
const IDEA = "projects/demo/cards/idea.md";

const SEED = {
  "projects/demo/_project.md": "---\ntitle: Demo\ntype: project\n---\nThe project.\n",
  [IDEA]: "---\ntitle: Idea\ntype: card\n---\nThe idea.\n",
  [MAP]: JSON.stringify({
    nodes: [
      { id: "root", type: "file", file: IDEA, x: 0, y: 0, width: 320, height: 180 },
      { id: "far", type: "text", text: "Far", x: 900, y: 900, width: 260, height: 120 },
      { id: "near", type: "text", text: "Near", x: -500, y: -700, width: 260, height: 120 },
    ],
    edges: [
      { id: "e1", fromNode: "root", fromSide: "bottom", toNode: "far", toSide: "top" },
      { id: "e2", fromNode: "root", fromSide: "top", toNode: "near", toSide: "bottom" },
    ],
    "x-kasten": { title: "Map" },
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
  const view = render(<BoardCanvas path={MAP} />);
  const board = await view.findByLabelText(/^Whiteboard:/);
  await waitFor(() => expect(view.container.querySelectorAll(".react-flow__node")).toHaveLength(3));
  return { view, board, node: (id: string) => view.container.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`) };
}

const onDisk = () => vault.board(MAP);
const byText = async (text: string) => (await onDisk()).nodes.find((n) => n.kind === "text" && n.text === text);

describe("mind-map mode", () => {
  it("grows children with Tab, the next one while writing, and a sibling with Shift+Enter", async () => {
    const { board, node } = await open();
    // Far hangs off the root and has nothing on its right yet.
    fireEvent.click(node("far")!, { shiftKey: true });
    await waitFor(() => expect(node("far")!.classList.contains("selected")).toBe(true));
    fireEvent.keyDown(board, { key: "Tab" });
    let field = (await within(board).findByRole("textbox", { name: "Sticky text" })) as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "Child" } });
    // Tab while writing keeps the text and grows the next level.
    fireEvent.keyDown(field, { key: "Tab" });
    await waitFor(async () => expect(await byText("Child")).toBeTruthy());
    await waitFor(() => expect(within(board).getByRole("textbox", { name: "Sticky text" })).not.toBe(field));
    field = within(board).getByRole("textbox", { name: "Sticky text" }) as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "Grandchild" } });
    fireEvent.keyDown(field, { key: "Escape" });
    await waitFor(async () => expect(await byText("Grandchild")).toBeTruthy());

    const child = (await byText("Child"))!;
    const grandchild = (await byText("Grandchild"))!;
    expect([child.x, child.y]).toEqual([900 + 260 + ACROSS, 900]);
    expect([grandchild.x, grandchild.y]).toEqual([child.x + 260 + ACROSS, 900]);
    const edges = (await onDisk()).edges;
    expect(edges).toContainEqual(expect.objectContaining({ from: "far", to: child.id, fromSide: "right", toSide: "left" }));
    expect(edges).toContainEqual(expect.objectContaining({ from: child.id, to: grandchild.id }));

    // The grandchild is still selected: Shift+Enter gives it a sibling under Child.
    fireEvent.keyDown(board, { key: "Enter", shiftKey: true });
    field = (await within(board).findByRole("textbox", { name: "Sticky text" })) as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: "Second grandchild" } });
    fireEvent.blur(field);
    await waitFor(async () => expect(await byText("Second grandchild")).toBeTruthy());
    const sibling = (await byText("Second grandchild"))!;
    expect(sibling.x).toBe(grandchild.x);
    expect(sibling.y).toBeGreaterThan(grandchild.y);
    expect((await onDisk()).edges).toContainEqual(expect.objectContaining({ from: child.id, to: sibling.id }));
  });

  it("lays out what is connected as a mind map from the Layout menu", async () => {
    const { board } = await open();
    fireEvent.click(within(board).getByRole("button", { name: "More" }));
    fireEvent.click(within(board).getByRole("menuitem", { name: /^Layout/ }));
    fireEvent.click(within(board).getByRole("menuitem", { name: "Mind map" }));
    await waitFor(async () => expect((await onDisk()).nodes.find((n) => n.id === "near")!.x).toBe(320 + ACROSS));
    const nodes = (await onDisk()).nodes;
    const at = (id: string) => nodes.find((n) => n.id === id)!;
    expect([at("root").x, at("root").y]).toEqual([0, 0]);
    // Near was drawn above Far, so it stays above.
    expect(at("near").y).toBeLessThan(at("far").y);
    expect(at("far").x).toBe(320 + ACROSS);
    for (const e of (await onDisk()).edges) expect([e.fromSide, e.toSide]).toEqual(["right", "left"]);
  });
});
