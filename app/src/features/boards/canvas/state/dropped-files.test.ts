import { describe, expect, it, vi } from "vitest";

import { MemoryVault } from "../../../workspace/preview/memory-vault";
import { flowKind } from "../model/flow";
import { BoardController, type BoardDeps } from "./controller";
import { addFiles, pictureShape } from "./dropped-files";

const BOARD = "projects/demo/boards/trip.canvas";

async function setup() {
  const vault = new MemoryVault({
    "projects/demo/_project.md": "---\ntitle: Demo\ntype: project\n---\n",
    [BOARD]: JSON.stringify({ nodes: [], edges: [] }),
  });
  const toast = vi.fn();
  const deps: BoardDeps = { client: vault, notes: () => [], toast, open: vi.fn(), create: vi.fn(), trash: vi.fn(), enter: vi.fn() };
  const board = new BoardController(BOARD, await vault.board(BOARD), deps);
  return { vault, board, toast };
}

const file = (name: string, type: string) => new File([new Uint8Array([1, 2, 3])], name, { type });

describe("files dropped on a board", () => {
  it("keeps each file in assets/ and places a card for it, pictures in their shape", async () => {
    const { vault, board, toast } = await setup();
    const shape = async (f: File) => (f.type.startsWith("image/") ? { width: 270, height: 360 } : null);
    const ids = await addFiles(board, [file("Town map.png", "image/png"), file("Trip budget.xlsx", "application/vnd.ms-excel")], { x: 0, y: 0 }, shape);
    expect(toast.mock.calls).toEqual([]);
    expect(ids).toHaveLength(2);
    const saved = await vault.board(BOARD);
    const nodes = saved.nodes.map((n) => ({ file: n.file, width: n.width, height: n.height }));
    expect(nodes).toEqual([
      { file: "assets/town-map.png", width: 270, height: 360 },
      { file: "assets/trip-budget.xlsx", width: 320, height: 180 },
    ]);
    // Side by side, not on top of each other.
    const [a, b] = saved.nodes;
    expect(b!.x).toBeGreaterThanOrEqual(a!.x + 320);
    expect(board.store.getState().nodes.filter((n) => n.selected).map((n) => n.id)).toEqual(ids);
  });

  it("leaves out a file the vault refuses, saying why", async () => {
    const { vault, board, toast } = await setup();
    const ids = await addFiles(board, [file("setup.exe", "application/octet-stream")], { x: 0, y: 0 }, async () => null);
    expect(ids).toEqual([]);
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/not files that run/));
    expect((await vault.board(BOARD)).nodes).toEqual([]);
  });

  it("keeps a diagram's picture as a picture, and brings a diagram file in as a diagram of the board's project", async () => {
    const { vault, board, toast } = await setup();
    const xml = '<mxfile><diagram id="p1" name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>';
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><g/></svg>';
    const ids = await addFiles(board, [new File([svg], "Login flow.drawio.svg", { type: "image/svg+xml" }), new File([xml], "Sketch.drawio", { type: "" })], { x: 0, y: 0 }, async () => ({ width: 200, height: 100 }));
    expect(toast.mock.calls).toEqual([]);
    expect(ids).toHaveLength(2);
    const saved = await vault.board(BOARD);
    const files = saved.nodes.map((n) => n.file);
    // The picture is a picture in assets/ (the vault names it as it names any picture); the diagram is a diagram in the project, drawn as one.
    expect(files).toEqual(["assets/login-flow-drawio.svg", "projects/demo/diagrams/Sketch.drawio"]);
    expect(saved.nodes.map((n) => flowKind(n))).toEqual(["image", "diagram"]);
    expect((await vault.diagrams()).map((d) => d.path)).toEqual(["projects/demo/diagrams/Sketch.drawio"]);
  });

  it("sizes pictures by their longer side", () => {
    expect(pictureShape(1920, 1080)).toEqual({ width: 360, height: 203 });
    expect(pictureShape(600, 1200)).toEqual({ width: 180, height: 360 });
    expect(pictureShape(200, 150)).toEqual({ width: 200, height: 150 });
    expect(pictureShape(16, 16)).toEqual({ width: 120, height: 120 });
    expect(pictureShape(0, 10)).toBeNull();
  });
});
