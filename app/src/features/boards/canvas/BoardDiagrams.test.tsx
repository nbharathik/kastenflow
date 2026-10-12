// Diagrams on a whiteboard: a card on a `.drawio` file shows the picture kept
// beside it, a double click edits the diagram over the board, and a diagram
// dragged from the Diagrams view becomes such a card.

import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { useDiagramHost } from "../../diagrams/host-store";
import { useDiagrams } from "../../diagrams/store";
import { NOTE_DRAG } from "../../workspace/drag";
import { MemoryVault } from "../../workspace/preview/memory-vault";
import { contentHash } from "../../workspace/preview/vault-text";
import { derive } from "../../workspace/store-layout";
import { useWorkspace } from "../../workspace/store";
import { initialLayout } from "../../workspace/tabs";
import { useBoards } from "../store";
import { BoardCanvas } from "./BoardCanvas";
import { mockReactFlow } from "./test/flow-mocks";
import { forgetTrails } from "./trail";

const XML = '<mxfile host="test">\n  <diagram id="p1" name="Page-1">\n    <mxGraphModel>\n      <root>\n        <mxCell id="0" />\n        <mxCell id="1" parent="0" />\n      </root>\n    </mxGraphModel>\n  </diagram>\n</mxfile>\n';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="81px" height="41px"><defs/><g/></svg>';
const SEED = { "projects/demo/_project.md": "---\ntitle: Demo\ntype: project\n---\nThe project.\n" };

let vault: MemoryVault;
let board: string;
let flow: string;
let network: string;

beforeAll(mockReactFlow);

beforeEach(async () => {
  localStorage.clear();
  forgetTrails();
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:picture-${++n}`);
  URL.revokeObjectURL = vi.fn();
  vault = new MemoryVault(SEED);
  flow = await vault.createDiagram("Login flow", null, XML);
  await vault.saveDiagram(flow, XML, SVG, contentHash(XML));
  network = await vault.createDiagram("Network", "demo", XML);
  board = await vault.createBoard("Map", null);
  await vault.addToBoard(board, [flow]);
  useWorkspace.setState({ client: vault, ready: true, notes: await vault.list(), ...derive(initialLayout()), stack: [], stackOpen: false, recent: [], toasts: [] });
  useDiagrams.setState({ list: [], loaded: false, templateFor: null });
  useDiagramHost.setState({ modal: null, picker: null, queue: [], seen: [], editing: [] });
  await useBoards.getState().load();
});
afterEach(cleanup);

async function open() {
  const view = render(<BoardCanvas path={board} />);
  const canvas = await view.findByLabelText(/^Whiteboard:/);
  const count = (await vault.board(board)).nodes.length;
  await waitFor(() => expect(view.container.querySelectorAll(".react-flow__node")).toHaveLength(count));
  return { view, canvas, nodes: () => [...view.container.querySelectorAll<HTMLElement>(".react-flow__node")] };
}

describe("a diagram on a whiteboard", () => {
  it("shows the picture kept beside the diagram, not a file card", async () => {
    const { canvas } = await open();
    const picture = await within(canvas).findByRole("img", { name: "Login flow" });
    expect(picture.getAttribute("src")).toMatch(/^blob:picture-/);
    expect(within(canvas).getByLabelText("Diagram: Login flow")).toBeTruthy();
    expect(within(canvas).queryByLabelText(/^File:/)).toBeNull();
  });

  it("shows its name where the picture is not drawn yet", async () => {
    await vault.createDiagram("Fresh sketch", null, XML);
    const second = (await vault.diagrams()).find((d) => d.title === "Fresh sketch")!;
    await vault.addToBoard(board, [second.path]);
    const { canvas } = await open();
    expect(await within(canvas).findByLabelText("Diagram: Fresh sketch")).toBeTruthy();
    expect(within(canvas).getByText("Fresh sketch", { selector: ".kasten-image-placeholder span" })).toBeTruthy();
  });

  it("edits the diagram over the board on a double click", async () => {
    const { nodes } = await open();
    expect(useDiagramHost.getState().modal).toBeNull();
    fireEvent.doubleClick(nodes()[0]!);
    expect(useDiagramHost.getState().modal).toBe(flow);
    // The board itself is untouched: it is still on the same board.
    expect(useWorkspace.getState().place).not.toEqual({ view: "diagrams", path: flow });
  });

  it("takes a diagram dragged from the Diagrams view as a card, once", async () => {
    const { canvas } = await open();
    const dataTransfer = { types: [NOTE_DRAG, "text/plain"], effectAllowed: "copyLink", dropEffect: "none", getData: (type: string) => (type === NOTE_DRAG ? network : "") };
    await act(async () => {
      fireEvent.dragOver(canvas, { dataTransfer, clientX: 300, clientY: 200 });
      fireEvent.drop(canvas, { dataTransfer, clientX: 300, clientY: 200 });
    });
    await waitFor(async () => expect((await vault.board(board)).nodes.filter((n) => n.file === network)).toHaveLength(1));
    expect(await within(canvas).findByLabelText("Diagram: Network")).toBeTruthy();
    await act(async () => {
      fireEvent.drop(canvas, { dataTransfer, clientX: 300, clientY: 200 });
    });
    expect((await vault.board(board)).nodes.filter((n) => n.file === network)).toHaveLength(1);
  });

  it("follows the diagram when it is renamed, and says when it is gone", async () => {
    const { canvas } = await open();
    await within(canvas).findByLabelText("Diagram: Login flow");
    const moved = await vault.renameDiagram(flow, "Sign in");
    expect((await vault.board(board)).nodes.map((n) => n.file)).toEqual([moved.path]);
  });
});
