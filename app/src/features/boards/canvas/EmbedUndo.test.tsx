// A board shown in a page shares its controller with the board's tab, keeps
// its undo history across remounts, and takes Ctrl+Z for itself.

import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryVault } from "../../workspace/preview/memory-vault";
import { derive } from "../../workspace/store-layout";
import { useWorkspace } from "../../workspace/store";
import { initialLayout } from "../../workspace/tabs";
import { useBoards } from "../store";
import { BoardCanvas } from "./BoardCanvas";
import { mockReactFlow } from "./test/flow-mocks";

const MAIN = "projects/demo/boards/main.canvas";
const SEED = {
  "projects/demo/_project.md": "---\ntitle: Demo\ntype: project\n---\n",
  [MAIN]: JSON.stringify({
    nodes: [
      { id: "s1", type: "text", text: "A sticky", x: 0, y: 0, width: 260, height: 120 },
      { id: "s2", type: "text", text: "Another", x: 400, y: 0, width: 260, height: 120 },
    ],
    edges: [],
    "x-kasten": { title: "Main" },
  }),
};

let vault: MemoryVault;
beforeAll(mockReactFlow);
beforeEach(async () => {
  localStorage.clear();
  vault = new MemoryVault(SEED);
  useWorkspace.setState({ client: vault, ready: true, notes: await vault.list(), ...derive(initialLayout()), stack: [], stackOpen: false, recent: [], toasts: [] });
  await useBoards.getState().load();
});
afterEach(cleanup);

const nodes = (root: HTMLElement) => root.querySelectorAll(".react-flow__node");

describe("a board shown in a page", () => {
  it("keeps its history across a remount, and Ctrl+Z undoes the board without reaching the page", async () => {
    const page = vi.fn();
    const first = render(
      <div onKeyDown={page}>
        <BoardCanvas path={MAIN} embedded />
      </div>,
    );
    const board = await first.findByLabelText(/^Whiteboard:/);
    await waitFor(() => expect(nodes(first.container)).toHaveLength(2));
    fireEvent.click(first.container.querySelector('.react-flow__node[data-id="s2"]')!, { shiftKey: true });
    await waitFor(() => expect(first.container.querySelector('.react-flow__node[data-id="s2"]')!.classList.contains("selected")).toBe(true));
    fireEvent.keyDown(board, { key: "Delete" });
    await waitFor(() => expect(nodes(first.container)).toHaveLength(1));
    first.unmount();

    const second = render(
      <div onKeyDown={page}>
        <BoardCanvas path={MAIN} embedded />
      </div>,
    );
    const again = await second.findByLabelText(/^Whiteboard:/);
    await waitFor(() => expect(nodes(second.container)).toHaveLength(1));
    fireEvent.keyDown(again, { key: "z", ctrlKey: true });
    await waitFor(() => expect(nodes(second.container)).toHaveLength(2));
    expect(page, "the page never saw the key").not.toHaveBeenCalled();
  });

  it("is the same board in a tab and an embed", async () => {
    const tab = render(<BoardCanvas path={MAIN} />);
    const embed = render(<BoardCanvas path={MAIN} embedded />);
    const tabBoard = await within(tab.container).findByLabelText(/^Whiteboard:/);
    await within(embed.container).findByLabelText(/^Whiteboard:/);
    await waitFor(() => expect(nodes(embed.container)).toHaveLength(2));
    fireEvent.click(tab.container.querySelector('.react-flow__node[data-id="s2"]')!, { shiftKey: true });
    await waitFor(() => expect(tab.container.querySelector('.react-flow__node[data-id="s2"]')!.classList.contains("selected")).toBe(true));
    fireEvent.keyDown(tabBoard, { key: "Delete" });
    await waitFor(() => expect(nodes(embed.container)).toHaveLength(1));
  });
});
