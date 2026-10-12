// A diagram inside a page: its picture, an Edit button and a double click that
// open the editor over the page, and a placeholder that says what is missing.

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DiagramInfo } from "../../lib/vault/types";
import { MemoryVault } from "../workspace/preview/memory-vault";
import { useWorkspace } from "../workspace/store";
import { DiagramEmbedView } from "./DiagramEmbedView";
import { setEditorBackend, useDiagramEditor, type EditorInfo } from "./editor";
import { useDiagramHost } from "./host-store";
import { diagramChanged, useDiagrams } from "./store";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="81px" height="41px"><defs/><g/></svg>';
const INSTALLED: EditorInfo = { version: "32.2.0", bytes: 48_235_802, url: "https://example.test/draw.war", installed: true, busy: false };
const MISSING: EditorInfo = { ...INSTALLED, installed: false };

let vault: MemoryVault;
let path: string;

async function setup(info: EditorInfo, picture: boolean) {
  vault = new MemoryVault({});
  path = await vault.createDiagram("Login flow", null);
  if (picture) {
    const read = await vault.diagram(path);
    await vault.saveDiagram(path, read.xml, SVG, read.hash);
  }
  setEditorBackend({ status: async () => info, install: async () => "installed", cancel: async () => {}, remove: async () => {} });
  await useWorkspace.getState().connect({ client: vault });
  render(<DiagramEmbedView path={path} />);
}

beforeEach(() => {
  useDiagramHost.setState({ modal: null, queue: [], seen: [], editing: [] });
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

describe("a diagram in a page", () => {
  it("is its picture, an ordinary image, named by the diagram's title", async () => {
    await setup(INSTALLED, true);
    const image = await screen.findByRole("img", { name: "Login flow" });
    expect(image.getAttribute("src")).toMatch(/^blob:picture-/);
    expect(image.getAttribute("draggable")).toBe("false");
    expect(document.querySelector(".kasten-diagram-embed-view svg:not([aria-hidden])")).toBeNull();
  });

  it("opens the editor over the page from the Edit button and from a double click", async () => {
    await setup(INSTALLED, true);
    const image = await screen.findByRole("img", { name: "Login flow" });
    fireEvent.click(screen.getByRole("button", { name: "Edit Login flow" }));
    expect(useDiagramHost.getState().modal).toBe(path);
    act(() => useDiagramHost.getState().closeModal());
    fireEvent.doubleClick(image);
    expect(useDiagramHost.getState().modal).toBe(path);
  });

  it("opens in a tab of its own from the toolbar", async () => {
    await setup(INSTALLED, true);
    await screen.findByRole("img", { name: "Login flow" });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Open Login flow in a tab" })));
    expect(useWorkspace.getState().place).toEqual({ view: "diagrams", path });
  });

  it("offers the picture's ways out in a menu, naming only what a picture can do without the editor", async () => {
    await setup(INSTALLED, true);
    await screen.findByRole("img", { name: "Login flow" });
    fireEvent.click(screen.getByRole("button", { name: "Export or copy Login flow" }));
    expect((await screen.findAllByRole("menuitem")).map((i) => i.textContent)).toEqual(["Copy as image", "Export as SVG", "Export as PNG"]);
  });

  it("reads the picture again when the diagram was saved", async () => {
    await setup(INSTALLED, true);
    const image = await screen.findByRole("img", { name: "Login flow" });
    const was = image.getAttribute("src");
    await act(async () => diagramChanged(path));
    await waitFor(() => expect(screen.getByRole("img", { name: "Login flow" }).getAttribute("src")).not.toBe(was));
  });

  it("says a picture is being drawn while the editor is there to draw it, and asks for it", async () => {
    await setup(INSTALLED, false);
    expect(await screen.findByText("Drawing the picture…")).toBeTruthy();
    expect(useDiagramHost.getState().queue).toEqual([path]);
  });

  it("says the editor is needed to draw a picture when it is not installed, and asks for nothing", async () => {
    await setup(MISSING, false);
    expect(await screen.findByText("No picture yet. Install the diagram editor to draw it.")).toBeTruthy();
    expect(useDiagramHost.getState().queue).toEqual([]);
  });

  it("says a diagram that cannot be read cannot, and does not try to draw it", async () => {
    await setup(INSTALLED, false);
    const broken: DiagramInfo = { path, title: "Login flow", project: null, pages: 0, modified: 0, size: 0, preview: "missing", problem: "Not a well-formed diagram: line 3" };
    act(() => useDiagrams.setState({ list: [broken], loaded: true }));
    useDiagramHost.setState({ queue: [], seen: [] });
    expect(await screen.findByText("This diagram cannot be read: Not a well-formed diagram: line 3")).toBeTruthy();
    expect(useDiagramHost.getState().queue).toEqual([]);
  });
});
