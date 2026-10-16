// A diagram in the editor: the frame while the editor is installed, the
// picture and the offer while it is not, and how the diagram stands beside its
// title.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { contentHash } from "../workspace/preview/vault-text";
import { MemoryVault } from "../workspace/preview/memory-vault";
import { useWorkspace } from "../workspace/store";
import { DiagramEditor, statusWords } from "./DiagramEditor";
import { setEditorBackend, useDiagramEditor, type EditorInfo } from "./editor";
import { useDiagramHost } from "./host-store";
import { showTemplates, encode } from "./protocol";
import { useDiagrams } from "./store";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="81px" height="41px"><defs/><g/></svg>';
const INSTALLED: EditorInfo = { version: "32.2.0", bytes: 48_235_802, url: "https://example.test/draw.war", installed: true, busy: false };
const MISSING: EditorInfo = { ...INSTALLED, installed: false };
const withBox = (xml: string, label = "Box") => xml.replace("</root>", `<mxCell id="2" value="${label}" vertex="1" parent="1"><mxGeometry x="10" y="10" width="80" height="40" as="geometry"/></mxCell></root>`);

let vault: MemoryVault;
let path: string;

async function setup(info: EditorInfo, picture = false) {
  vault = new MemoryVault({});
  path = await vault.createDiagram("Flow", null);
  if (picture) {
    const read = await vault.diagram(path);
    await vault.saveDiagram(path, read.xml, SVG, read.hash);
  }
  setEditorBackend({ status: async () => info, install: async () => "installed", cancel: async () => {}, remove: async () => {} });
  useDiagramEditor.setState({ info });
  await useWorkspace.getState().connect({ client: vault });
}

/** The editor and the window of its frame, once the diagram is read, with what is posted to it recorded. */
async function mount(props: Partial<Parameters<typeof DiagramEditor>[0]> = {}) {
  const view = render(<DiagramEditor path={path} {...props} />);
  const frame = await waitFor(() => {
    const found = view.container.querySelector("iframe");
    if (!found) throw new Error("no frame yet");
    return found;
  });
  const sent: string[] = [];
  vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(((message: unknown) => void sent.push(String(message))) as Window["postMessage"]);
  // The frame's session starts listening in an effect, which has to have run before the editor can be spoken for.
  await act(async () => {});
  return { ...view, frame, win: frame.contentWindow!, sent };
}

function say(data: unknown, source: unknown) {
  const event = new MessageEvent("message", { data: JSON.stringify(data), origin: window.location.origin });
  Object.defineProperty(event, "source", { value: source });
  act(() => void window.dispatchEvent(event));
}

beforeEach(() => {
  useDiagramHost.setState({ modal: null, queue: [], seen: [], editing: [] });
  useDiagrams.setState({ list: [], loaded: false, templateFor: null });
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:picture-${++n}`);
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  setEditorBackend(null);
  vi.restoreAllMocks();
});

describe("how the diagram stands", () => {
  it("is told in a few words", () => {
    expect(statusWords(null)).toBe("");
    expect(statusWords({ kind: "ready" })).toBe("");
    expect(statusWords({ kind: "loading" })).toBe("Starting the editor…");
    expect(statusWords({ kind: "unsaved" })).toBe("Unsaved changes");
    expect(statusWords({ kind: "saving" })).toBe("Saving…");
    expect(statusWords({ kind: "saved" })).toBe("Saved");
    expect(statusWords({ kind: "copy", path: "library/Flow (conflict 2026-01-02 10-30).drawio" })).toBe("Saved as a copy: Flow (conflict 2026 01 02 10 30)");
    expect(statusWords({ kind: "error", message: "Disk full" })).toBe("Not saved: Disk full");
  });
});

describe("with the editor installed", () => {
  it("opens the frame on the diagram, under its title", async () => {
    await setup(INSTALLED);
    const { frame } = await mount();
    expect(screen.getByRole("heading", { name: "Flow" })).toBeTruthy();
    expect(frame.getAttribute("title")).toBe("Flow: diagram editor");
    expect(screen.queryByRole("region", { name: "Diagram editor" })).toBeNull();
  });

  it("shows each stage of the work beside the title and saves what is drawn", async () => {
    await setup(INSTALLED);
    const { win } = await mount();
    const status = screen.getByRole("status");
    say({ event: "init" }, win);
    expect(status.textContent).toBe("Starting the editor…");
    say({ event: "load" }, win);
    expect(status.textContent).toBe("");
    const read = await vault.diagram(path);
    say({ event: "save", xml: withBox(read.xml), exit: false }, win);
    expect(status.textContent).toBe("Unsaved changes");
    await waitFor(() => expect(status.textContent).not.toBe("Unsaved changes"));
    expect((await vault.diagram(path)).xml).toContain('value="Box"');
  });

  it("goes on with a copy when the file changed elsewhere, and tells the tab", async () => {
    await setup(INSTALLED);
    const onMoved = vi.fn();
    const { win } = await mount({ onMoved });
    const read = await vault.diagram(path);
    say({ event: "init" }, win);
    // Another app wrote the file after it was opened here.
    await vault.saveDiagram(path, withBox(read.xml, "Theirs"), null, contentHash(read.xml));
    say({ event: "save", xml: withBox(read.xml, "Mine"), exit: false }, win);
    await waitFor(() => expect(onMoved).toHaveBeenCalledTimes(1));
    expect(onMoved.mock.calls[0]![0]).toMatch(/^library\/Flow \(conflict .*\)\.drawio$/);
    expect(screen.getByRole("status").textContent).toMatch(/^Saved as a copy: Flow \(conflict /);
    // What the other app wrote is still there.
    expect((await vault.diagram(path)).xml).toContain('value="Theirs"');
    expect((await vault.diagram(onMoved.mock.calls[0]![0])).xml).toContain('value="Mine"');
  });

  it("shows the editor's template dialog for a diagram made from a template, once the editor is ready, and only once", async () => {
    await setup(INSTALLED);
    useDiagrams.setState({ templateFor: path });
    const { win, sent } = await mount();
    say({ event: "init" }, win);
    expect(sent.filter((m) => m === encode(showTemplates()))).toHaveLength(0);
    say({ event: "load" }, win);
    await waitFor(() => expect(sent).toContain(encode(showTemplates())), { timeout: 4000 });
    expect(useDiagrams.getState().templateFor).toBeNull();
    say({ event: "load" }, win);
    expect(sent.filter((m) => m === encode(showTemplates()))).toHaveLength(1);
  });

  it("offers PNG and copying as an image, which only the editor can draw", async () => {
    await setup(INSTALLED);
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Export or copy Flow" }));
    const items = (await screen.findAllByRole("menuitem")).map((i) => i.textContent);
    expect(items).toEqual(expect.arrayContaining(["Export as SVG", "Export as PNG", "Copy as image"]));
  });

  it("closes, or opens in a tab, from a modal", async () => {
    await setup(INSTALLED);
    const onClose = vi.fn();
    const onOpenInTab = vi.fn();
    await mount({ onClose, onOpenInTab });
    fireEvent.click(screen.getByRole("button", { name: "Open in a tab" }));
    expect(onOpenInTab).toHaveBeenCalledWith(path);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("without the editor", () => {
  it("shows the picture beside the offer to install, and has no frame", async () => {
    await setup(MISSING, true);
    const { container } = render(<DiagramEditor path={path} />);
    const notice = await screen.findByRole("region", { name: "Diagram editor" });
    expect(notice.textContent).toContain("The diagram editor is not installed");
    const image = await waitFor(() => {
      const found = container.querySelector("img.kasten-diagram-picture");
      if (!found) throw new Error("no picture yet");
      return found;
    });
    expect(image.getAttribute("alt")).toBe("Flow");
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("says so when there is no picture to show either", async () => {
    await setup(MISSING);
    render(<DiagramEditor path={path} />);
    expect(await screen.findByText("This diagram has no picture yet. Install the editor to draw it.")).toBeTruthy();
  });

  it("exports the picture that is there, and offers nothing that needs the editor", async () => {
    await setup(MISSING, true);
    render(<DiagramEditor path={path} />);
    await screen.findByRole("region", { name: "Diagram editor" });
    fireEvent.click(screen.getByRole("button", { name: "Export or copy Flow" }));
    const menu = await screen.findByRole("menu");
    const items = within(menu)
      .getAllByRole("menuitem")
      .map((i) => i.textContent);
    expect(items).toContain("Export as SVG");
    expect(items).not.toContain("Export as PNG");
    expect(items).not.toContain("Copy as image");
  });
});

describe("a diagram that cannot be opened", () => {
  it("says why, with no frame", async () => {
    await setup(INSTALLED);
    const { container } = render(<DiagramEditor path="library/Gone.drawio" />);
    expect((await screen.findByRole("alert")).textContent).toContain("This diagram cannot be opened");
    expect(container.querySelector("iframe")).toBeNull();
  });
});
