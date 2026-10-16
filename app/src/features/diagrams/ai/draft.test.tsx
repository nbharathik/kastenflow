// A diagram whose picture is a draft (the program drew it for an agent's edit): shown like any picture, and drawn again by the
// editor wherever the editor is at hand. Every place that decides whether a picture is current asks "not fresh", so a draft is
// handled like a stale or missing one.

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DiagramPreview, VaultClient } from "../../../lib/vault/types";
import { MemoryVault } from "../../workspace/preview/memory-vault";
import { draftSvg } from "../../workspace/preview/draft-svg";
import { useWorkspace } from "../../workspace/store";
import DiagramHost from "../DiagramHost";
import { DiagramEmbedView } from "../DiagramEmbedView";
import { DiagramsHome } from "../DiagramsHome";
import { setEditorBackend, useDiagramEditor, type EditorInfo } from "../editor";
import { useDiagramHost } from "../host-store";
import { useDiagrams } from "../store";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="81px" height="41px"><defs/><g/></svg>';
const INSTALLED: EditorInfo = { version: "32.2.0", bytes: 48_235_802, url: "https://example.test/draw.war", installed: true, busy: false };
const backend = (info: EditorInfo) => ({ status: async () => info, install: async () => "installed" as const, cancel: async () => {}, remove: async () => {} });

let vault: MemoryVault;
let path: string;

/** The vault, saying the picture of `path` is `preview` (the memory vault knows fresh, stale and missing; the core also knows draft). */
function saying(preview: DiagramPreview): VaultClient {
  const client = Object.create(vault) as MemoryVault;
  client.diagrams = async () => (await vault.diagrams()).map((d) => (d.path === path ? { ...d, preview } : d));
  client.diagram = async (p) => ({ ...(await vault.diagram(p)), preview: p === path ? preview : "fresh" });
  return client;
}

async function setup(preview: DiagramPreview) {
  vault = new MemoryVault({});
  path = await vault.createDiagram("Login flow", null);
  const read = await vault.diagram(path);
  await vault.saveDiagram(path, read.xml, SVG, read.hash);
  setEditorBackend(backend(INSTALLED));
  useDiagramEditor.setState({ info: INSTALLED });
  await useWorkspace.getState().connect({ client: saying(preview) });
}

const queue = () => useDiagramHost.getState().queue;

beforeEach(() => {
  localStorage.clear();
  useDiagrams.setState({ list: [], loaded: false, templateFor: null });
  useDiagramHost.setState({ modal: null, queue: [], seen: [], editing: [] });
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:picture-${++n}`);
  URL.revokeObjectURL = vi.fn();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(private readonly seen: (entries: { isIntersecting: boolean }[]) => void) {}
      observe() {
        this.seen([{ isIntersecting: true }]);
      }
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  setEditorBackend(null);
  vi.unstubAllGlobals();
});

describe("a diagram with a draft picture", () => {
  it("shows the draft in a page like any picture, and has the editor draw the exact one", async () => {
    await setup("draft");
    render(<DiagramEmbedView path={path} />);
    expect((await screen.findByRole("img", { name: "Login flow" })).getAttribute("src")).toMatch(/^blob:picture-/);
    expect(screen.queryByText("Drawing the picture…")).toBeNull();
    await waitFor(() => expect(queue()).toEqual([path]));
  });

  it("is not drawn again when the picture is the editor's own", async () => {
    await setup("fresh");
    render(<DiagramEmbedView path={path} />);
    await screen.findByRole("img", { name: "Login flow" });
    await act(async () => void (await new Promise((done) => setTimeout(done, 30))));
    expect(queue()).toEqual([]);
  });

  it("is drawn again from the Diagrams view, as a stale picture is", async () => {
    await setup("draft");
    render(<DiagramsHome />);
    await waitFor(() => expect(queue()).toEqual([path]));
  });

  it("is drawn again by a hidden editor, and a fresh one is not", async () => {
    await setup("draft");
    const { unmount } = render(<DiagramHost />);
    act(() => useDiagramHost.getState().redraw(path));
    await waitFor(() => expect(document.querySelector(`iframe[title="Drawing ${path} again"]`)).not.toBeNull());
    unmount();
    cleanup();
    useDiagramHost.setState({ queue: [], seen: [] });
    await setup("fresh");
    render(<DiagramHost />);
    act(() => useDiagramHost.getState().redraw(path));
    await waitFor(() => expect(queue()).toEqual([]));
    expect(document.querySelector("iframe")).toBeNull();
  });

});

describe("the preview vault's stand-in for the built-in drawing", () => {
  const XML = (cells: string) => `<mxfile><diagram id="p" name="P"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel></diagram></mxfile>`;
  const box = (id: string, label: string, x: number) => `<mxCell id="${id}" value="${label}" vertex="1" parent="1"><mxGeometry x="${x}" y="0" width="80" height="40" as="geometry"/></mxCell>`;

  it("draws boxes with their words, and the arrows between them, as an image on white", () => {
    const svg = draftSvg(XML(`${box("a", "Web &amp; API", 0)}${box("b", "Orders", 200)}<mxCell id="e" edge="1" source="a" target="b" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell>`))!;
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg).toContain(">Web &amp; API</text>");
    expect(svg.match(/<rect /g)).toHaveLength(3);
    expect(svg).toContain("<line ");
    expect(svg).not.toContain("foreignObject");
  });

  it("cannot draw what is not plain diagram XML or has no boxes", () => {
    expect(draftSvg("not xml")).toBeNull();
    expect(draftSvg(XML(""))).toBeNull();
    expect(draftSvg('<mxfile><diagram id="p">7VhZb9s4EP4r</diagram></mxfile>')).toBeNull();
  });

  it("is what the vault answers for source that is not in it", async () => {
    const memory = new MemoryVault({});
    expect(await memory.diagramDraftSvg(XML(box("a", "One", 0)))).toContain(">One</text>");
    expect(await memory.diagramDraftSvg("nope")).toBeNull();
  });
});
