// A PNG of a diagram: the editor draws it, off screen, because a window will not
// draw the picture saved beside the source into a canvas.

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryVault } from "../workspace/preview/memory-vault";
import { contentHash } from "../workspace/preview/vault-text";
import { useWorkspace } from "../workspace/store";
import DiagramHost from "./DiagramHost";
import { useDiagramEditor, type EditorInfo } from "./editor";
import { useDiagramHost } from "./host-store";
import { diagramPng, sizeOfSvg } from "./picture";

const XML = '<mxfile host="test"><diagram id="p1" name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" style="background: #fff" width="3000px" height="1500px" viewBox="0 0 3000 1500"><g/></svg>';
const INSTALLED: EditorInfo = { version: "32.2.0", bytes: 48_235_802, url: "", installed: true, busy: false };
const MISSING: EditorInfo = { ...INSTALLED, installed: false };

/** The host's own way to ask, which a test puts a stand-in in place of. */
const realRenderPng = useDiagramHost.getState().renderPng;

let vault: MemoryVault;
let flow: string;

async function setup(info: EditorInfo, picture: boolean) {
  vault = new MemoryVault({});
  flow = await vault.createDiagram("Flow", null, XML);
  if (picture) await vault.saveDiagram(flow, XML, SVG, contentHash(XML));
  useDiagramEditor.setState({ info });
  await useWorkspace.getState().connect({ client: vault });
}

beforeEach(() => {
  useDiagramHost.setState({ modal: null, picker: null, queue: [], seen: [], editing: [], pngs: [], renderPng: realRenderPng });
});
afterEach(cleanup);

describe("the size a picture says it has", () => {
  it("is read from its root element, in pixels", () => {
    expect(sizeOfSvg(SVG)).toEqual({ w: 3000, h: 1500 });
    expect(sizeOfSvg('<svg width="81" height="41.5px">')).toEqual({ w: 81, h: 41.5 });
    expect(sizeOfSvg('<svg viewBox="0 0 10 10"><rect width="5" height="5"/></svg>')).toBeNull();
    expect(sizeOfSvg("not a picture")).toBeNull();
  });
});

describe("a PNG of a diagram", () => {
  it("is asked of the editor, which draws it off screen, at the scale that keeps its longer side within the limit", async () => {
    await setup(INSTALLED, true);
    const bytes = new Uint8Array([1, 2, 3]);
    const renderPng = vi.fn(async () => bytes);
    useDiagramHost.setState({ renderPng });
    // 3000 pixels wide, 2x would be 6000: drawn at 4096 / 3000.
    expect(await diagramPng(useWorkspace.getState().client!, flow, { scale: 2, maxSide: 4096 })).toBe(bytes);
    expect(renderPng).toHaveBeenCalledWith(flow, 4096 / 3000);
    await diagramPng(useWorkspace.getState().client!, flow);
    expect(renderPng).toHaveBeenLastCalledWith(flow, 2);
  });

  it("is asked of the editor even when the diagram has no picture yet: it is drawn from the source", async () => {
    await setup(INSTALLED, false);
    const renderPng = vi.fn(async () => new Uint8Array([9]));
    useDiagramHost.setState({ renderPng });
    await diagramPng(useWorkspace.getState().client!, flow, { scale: 2, maxSide: 4096 });
    expect(renderPng).toHaveBeenCalledWith(flow, 2);
  });

  it("says to install the editor when there is neither, and when this window will not draw the saved picture", async () => {
    await setup(MISSING, false);
    await expect(diagramPng(useWorkspace.getState().client!, flow)).rejects.toThrow("Install the diagram editor");
    await setup(MISSING, true);
    // This test window has no canvas to draw a picture on; a real one refuses the editor's labels.
    await expect(diagramPng(useWorkspace.getState().client!, flow)).rejects.toThrow("without the diagram editor");
  });

  it("is refused at once by the host while no editor is installed", async () => {
    await setup(MISSING, true);
    await expect(useDiagramHost.getState().renderPng(flow, 2)).rejects.toThrow("not installed");
    expect(useDiagramHost.getState().pngs).toEqual([]);
  });
});

describe("the host's hidden frame for a PNG", () => {
  it("is made for each ask, loads the diagram, and is gone when the answer is told", async () => {
    await setup(INSTALLED, true);
    render(<DiagramHost />);
    const asked = useDiagramHost.getState().renderPng(flow, 2);
    asked.catch(() => {});
    await waitFor(() => expect(document.querySelector("iframe.kasten-diagram-hidden")).not.toBeNull());
    expect(useDiagramHost.getState().pngs).toHaveLength(1);
    // The frame is a hidden one on the editor's page, in png mode: nobody is told of an editor open on the diagram.
    expect(document.querySelector("iframe")!.getAttribute("title")).toBe(`Drawing ${flow} as a picture`);
    expect(useDiagramHost.getState().editing).toEqual([]);
    // Left unanswered, the job is given up on after a while; here it is ended by hand.
    const job = useDiagramHost.getState().pngs[0]!;
    act(() => job.reject(new Error("stopped")));
    await expect(asked).rejects.toThrow("stopped");
    act(() => useDiagramHost.getState().donePng(job.id));
    await waitFor(() => expect(document.querySelector("iframe")).toBeNull());
  });
});
