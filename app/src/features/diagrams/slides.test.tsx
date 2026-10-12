// A diagram in a slide: Insert → Diagram… (choose or make one, get its picture
// as a PNG kept in assets/) and Edit diagram (the editor opens over the slide;
// the picture comes back).

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { VaultClient } from "../../lib/vault/types";
import { MemoryVault } from "../workspace/preview/memory-vault";
import { contentHash } from "../workspace/preview/vault-text";
import { useWorkspace } from "../workspace/store";
import DiagramHost from "./DiagramHost";
import { setEditorBackend, useDiagramEditor, type EditorInfo } from "./editor";
import { useDiagramHost } from "./host-store";
import { editDiagramPicture, pickDiagramPicture, pictureOf } from "./slides";
import { useDiagrams } from "./store";

// The PNG itself is drawn by the editor, off screen; picture.test.ts says how. Here it is a stand-in.
const diagramPng = vi.hoisted(() => vi.fn());
vi.mock("./picture", async (original) => ({ ...(await original<typeof import("./picture")>()), diagramPng }));

const XML = '<mxfile host="test">\n  <diagram id="p1" name="Page-1">\n    <mxGraphModel>\n      <root>\n        <mxCell id="0" />\n        <mxCell id="1" parent="0" />\n      </root>\n    </mxGraphModel>\n  </diagram>\n</mxfile>\n';
const withBox = (label: string) => XML.replace("</root>", `<mxCell id="2" value="${label}" vertex="1" parent="1"/></root>`);
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="81px" height="41px"><defs/><g/></svg>';

/** A PNG that says it is 3 pixels wide and 2 high; the bytes differ with `seed`. */
function png(seed: number): Uint8Array {
  const chunk = (kind: string, data: number[]) => [(data.length >>> 24) & 255, (data.length >>> 16) & 255, (data.length >>> 8) & 255, data.length & 255, ...[...kind].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, seed];
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk("IHDR", [0, 0, 0, 3, 0, 0, 0, 2, 8, 6, 0, 0, 0]), ...chunk("IEND", [])]);
}

const INSTALLED: EditorInfo = { version: "32.2.0", bytes: 48_235_802, url: "https://example.test/draw.war", installed: true, busy: false };
const MISSING: EditorInfo = { ...INSTALLED, installed: false };

let vault: MemoryVault;
let client: VaultClient;
let flow: string;

async function setup(info: EditorInfo = MISSING, picture = true) {
  vault = new MemoryVault({});
  flow = await vault.createDiagram("Login flow", null, XML);
  if (picture) await vault.saveDiagram(flow, XML, SVG, contentHash(XML));
  setEditorBackend({ status: async () => info, install: async () => "installed", cancel: async () => {}, remove: async () => {} });
  useDiagramEditor.setState({ info });
  await useWorkspace.getState().connect({ client: vault });
  client = useWorkspace.getState().client!;
  render(<DiagramHost />);
}

beforeEach(() => {
  diagramPng.mockReset();
  diagramPng.mockResolvedValue(png(1));
  useDiagramHost.setState({ modal: null, picker: null, queue: [], seen: [], editing: [], pngs: [] });
  useDiagrams.setState({ list: [], loaded: false, templateFor: null });
  useDiagramEditor.setState({ info: null, progress: null, error: null, installing: false });
  useWorkspace.setState({ toasts: [] });
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:picture-${++n}`);
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  setEditorBackend(null);
});

describe("the picture of a diagram for a slide", () => {
  it("is a 2x PNG of the diagram, kept in assets/ with what it is, and named for the slide", async () => {
    await setup();
    const picture = await pictureOf(client, flow);
    expect(diagramPng).toHaveBeenCalledWith(client, flow, { scale: 2, maxSide: 4096 });
    expect(picture).toEqual({ path: "assets/login-flow.png", source: flow, name: "Login flow", width: 3, height: 2 });
    expect(await vault.asset(picture.path)).toMatchObject({ source: "file", caption: "Diagram: Login flow", tags: ["diagram"] });
  });

  it("is the same picture when it draws the same, and another when it does not", async () => {
    await setup();
    const first = await pictureOf(client, flow);
    expect((await pictureOf(client, flow)).path).toBe(first.path);
    diagramPng.mockResolvedValue(png(2));
    expect((await pictureOf(client, flow)).path).toBe("assets/login-flow-2.png");
  });

  it("says why when no PNG can be drawn, and keeps nothing", async () => {
    await setup();
    diagramPng.mockRejectedValue(new Error("This diagram has no picture yet. Install the diagram editor to draw it"));
    await expect(pictureOf(client, flow)).rejects.toThrow("Install the diagram editor");
    expect(await vault.assets()).toEqual([]);
  });
});

describe("Insert → Diagram", () => {
  it("lists the diagrams, narrows them as you type, and gives the picture of the one chosen", async () => {
    await setup();
    await vault.createDiagram("Network", null, withBox("Router"));
    const asked = pickDiagramPicture(client);
    const dialog = await screen.findByRole("dialog", { name: "Choose a diagram" });
    expect(await within(dialog).findByRole("button", { name: "Use Network" })).toBeTruthy();
    fireEvent.change(within(dialog).getByRole("searchbox", { name: "Find a diagram" }), { target: { value: "login" } });
    expect(within(dialog).queryByRole("button", { name: "Use Network" })).toBeNull();
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Use Login flow" })));
    expect(await asked).toMatchObject({ source: flow, name: "Login flow" });
    expect(screen.queryByRole("dialog", { name: "Choose a diagram" })).toBeNull();
    expect(useDiagramHost.getState().picker).toBeNull();
  });

  it("gives nothing when the person closes it", async () => {
    await setup();
    const asked = pickDiagramPicture(client);
    const dialog = await screen.findByRole("dialog", { name: "Choose a diagram" });
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" })));
    expect(await asked).toBeNull();
  });

  it("a second ask puts the first away", async () => {
    await setup();
    const first = pickDiagramPicture(client);
    await screen.findByRole("dialog", { name: "Choose a diagram" });
    const second = pickDiagramPicture(client);
    expect(await first).toBeNull();
    const dialog = await screen.findByRole("dialog", { name: "Choose a diagram" });
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" })));
    expect(await second).toBeNull();
  });

  it("makes a new diagram, opens it in the editor, and gives its picture once something was drawn", async () => {
    await setup();
    const asked = pickDiagramPicture(client);
    const dialog = await screen.findByRole("dialog", { name: "Choose a diagram" });
    fireEvent.change(within(dialog).getByRole("searchbox", { name: "Find a diagram" }), { target: { value: "Plan" } });
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "New diagram “Plan”" })));
    await waitFor(() => expect(useDiagramHost.getState().modal).toBe("library/Plan.drawio"));
    // Drawn in the editor, which writes the file and its picture; then closed.
    const read = await vault.diagram("library/Plan.drawio");
    await vault.saveDiagram("library/Plan.drawio", withBox("Start"), SVG, read.hash);
    act(() => useDiagramHost.getState().closeModal());
    expect(await asked).toMatchObject({ source: "library/Plan.drawio", name: "Plan" });
  });

  it("gives nothing for a new diagram that was left empty", async () => {
    await setup();
    const asked = pickDiagramPicture(client);
    const dialog = await screen.findByRole("dialog", { name: "Choose a diagram" });
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "New diagram" })));
    await waitFor(() => expect(useDiagramHost.getState().modal).toBe("library/Untitled-diagram.drawio"));
    act(() => useDiagramHost.getState().closeModal());
    expect(await asked).toBeNull();
  });
});

describe("Edit diagram", () => {
  it("opens the diagram over the slide and gives the picture of it as it is when the editor is closed", async () => {
    await setup();
    const asked = editDiagramPicture(client, flow);
    await waitFor(() => expect(useDiagramHost.getState().modal).toBe(flow));
    const read = await vault.diagram(flow);
    await vault.saveDiagram(flow, withBox("New box"), SVG.replace("81px", "161px"), read.hash);
    diagramPng.mockResolvedValue(png(3));
    act(() => useDiagramHost.getState().closeModal());
    const picture = await asked;
    expect(picture).toMatchObject({ source: flow, name: "Login flow" });
    expect(diagramPng).toHaveBeenLastCalledWith(client, flow, { scale: 2, maxSide: 4096 });
  });

  it("gives nothing when the diagram was not changed, so the slide is left as it is", async () => {
    await setup();
    const asked = editDiagramPicture(client, flow);
    await waitFor(() => expect(useDiagramHost.getState().modal).toBe(flow));
    act(() => useDiagramHost.getState().closeModal());
    expect(await asked).toBeNull();
    expect(diagramPng).not.toHaveBeenCalled();
  });

  it("fails at once for a diagram that is gone, with no editor opened", async () => {
    await setup();
    await expect(editDiagramPicture(client, "library/Gone.drawio")).rejects.toThrow();
    expect(useDiagramHost.getState().modal).toBeNull();
  });
});
