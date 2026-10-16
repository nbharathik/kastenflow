import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { contentHash } from "../workspace/preview/vault-text";
import { MemoryVault } from "../workspace/preview/memory-vault";
import { useWorkspace } from "../workspace/store";
import { DiagramsHome } from "./DiagramsHome";
import { setEditorBackend, useDiagramEditor, type EditorInfo } from "./editor";
import { useDiagramHost } from "./host-store";
import { useDiagrams } from "./store";

const XML = '<mxfile host="test">\n  <diagram id="p1" name="Page-1">\n    <mxGraphModel>\n      <root>\n        <mxCell id="0" />\n        <mxCell id="1" parent="0" />\n      </root>\n    </mxGraphModel>\n  </diagram>\n</mxfile>\n';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="81px" height="41px"><defs/><g/></svg>';
const SEED = { "projects/trip/_project.md": "---\ntitle: Summer trip\ntype: project\n---\nPlans.\n" };

const INSTALLED: EditorInfo = { version: "32.2.0", bytes: 48_235_802, url: "https://github.com/jgraph/drawio/releases/download/v32.2.0/draw.war", installed: true, busy: false };
const MISSING: EditorInfo = { ...INSTALLED, installed: false };
const backend = (info: EditorInfo) => ({ status: async () => info, install: async () => "installed" as const, cancel: async () => {}, remove: async () => {} });

/** A vault with "Login flow" (library, with a picture), "Network" (library, no picture yet) and "Route" (in the trip project). */
async function open(info: EditorInfo = INSTALLED, diagrams = true) {
  const vault = new MemoryVault(SEED);
  if (diagrams) {
    const login = await vault.createDiagram("Login flow", null, XML);
    await vault.saveDiagram(login, XML, SVG, contentHash(XML));
    await vault.createDiagram("Network", null, XML);
    await vault.createDiagram("Route", "trip", XML);
  }
  setEditorBackend(backend(info));
  useWorkspace.setState({ place: { view: "diagrams" }, toasts: [] });
  await useWorkspace.getState().connect({ client: vault });
  render(<DiagramsHome />);
  return vault;
}

beforeEach(() => {
  localStorage.clear();
  useDiagrams.setState({ list: [], loaded: false, templateFor: null });
  useDiagramEditor.setState({ info: null, progress: null, error: null, installing: false });
  useDiagramHost.setState({ modal: null, queue: [], seen: [], editing: [] });
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:picture-${++n}`);
  URL.revokeObjectURL = vi.fn();
  // Every card is "near the screen" at once.
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

describe("Diagrams", () => {
  it("offers to draw the first one while there are none", async () => {
    await open(INSTALLED, false);
    expect(await screen.findByText("No diagrams yet")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Draw your first diagram" })));
    await waitFor(() => expect(useWorkspace.getState().place).toEqual({ view: "diagrams", path: "library/Untitled-diagram.drawio" }));
    expect((await useDiagrams.getState().list).map((d) => d.title)).toEqual(["Untitled diagram"]);
  });

  it("shows every diagram as a card with its pages and a picture where it has one", async () => {
    await open();
    const section = await screen.findByRole("region", { name: "Diagrams" });
    const login = within(section).getByRole("button", { name: "Open Login flow" });
    expect(login.textContent).toContain("1 page");
    expect(within(section).getByRole("button", { name: "Open Network" })).toBeTruthy();
    expect(within(section).getByRole("button", { name: "Open Route" })).toBeTruthy();
    await waitFor(() => expect(login.querySelector("img")?.getAttribute("src")).toMatch(/^blob:picture-/));
    // The picture is only ever an image: never put into the page.
    expect(login.querySelector("svg.kasten-diagram-picture, object, iframe")).toBeNull();
  });

  it("narrows by title and by project, and says when nothing matches", async () => {
    await open();
    await screen.findByRole("button", { name: "Open Network" });
    fireEvent.change(screen.getByRole("searchbox", { name: "Find a diagram" }), { target: { value: "net" } });
    expect(screen.queryByRole("button", { name: "Open Login flow" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open Network" })).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox", { name: "Find a diagram" }), { target: { value: "" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Project" }), { target: { value: "trip" } });
    expect(screen.getAllByRole("button", { name: /^Open / }).map((b) => b.getAttribute("aria-label"))).toEqual(["Open Route"]);
    fireEvent.change(screen.getByRole("combobox", { name: "Project" }), { target: { value: "\u0000none" } });
    expect(screen.queryByRole("button", { name: "Open Route" })).toBeNull();
    fireEvent.change(screen.getByRole("searchbox", { name: "Find a diagram" }), { target: { value: "zzz" } });
    expect(screen.getByText("No diagram matches.")).toBeTruthy();
  });

  it("opens a diagram in a tab of its own", async () => {
    await open();
    await act(async () => fireEvent.click(await screen.findByRole("button", { name: "Open Network" })));
    expect(useWorkspace.getState().place).toEqual({ view: "diagrams", path: "library/Network.drawio" });
  });

  it("remembers the layout", async () => {
    await open();
    await screen.findByRole("button", { name: "Open Network" });
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    expect(localStorage.getItem("kasten.diagrams.layout")).toBe("list");
    expect(screen.getByRole("button", { name: "Open Network" }).textContent).toContain("Library");
  });

  it("renames from a card's menu, the title naming both files", async () => {
    const vault = await open();
    fireEvent.click(await screen.findByRole("button", { name: "More for Network" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Rename/ }));
    const dialog = await screen.findByRole("dialog", { name: "Rename diagram" });
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Office network" } });
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Rename" })));
    await waitFor(async () => expect((await vault.diagrams()).map((d) => d.path)).toContain("library/Office-network.drawio"));
    expect(await screen.findByRole("button", { name: "Open Office network" })).toBeTruthy();
    expect(useWorkspace.getState().toasts.some((t) => t.text.includes("Renamed"))).toBe(true);
  });

  it("refuses a title that cannot name a file in the dialog", async () => {
    await open();
    fireEvent.click(await screen.findByRole("button", { name: "More for Network" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Rename/ }));
    const dialog = await screen.findByRole("dialog", { name: "Rename diagram" });
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "A|B" } });
    expect((within(dialog).getByRole("button", { name: "Rename" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(dialog).getByText(/no \[ \] or \| characters/)).toBeTruthy();
  });

  it("moves to a project and copies, from the same menu", async () => {
    const vault = await open();
    fireEvent.click(await screen.findByRole("button", { name: "More for Network" }));
    await act(async () => fireEvent.click(await screen.findByRole("menuitem", { name: /Move to Summer trip/ })));
    await waitFor(async () => expect((await vault.diagrams()).find((d) => d.title === "Network")?.project).toBe("trip"));
    fireEvent.click(await screen.findByRole("button", { name: "More for Login flow" }));
    await act(async () => fireEvent.click(await screen.findByRole("menuitem", { name: "Duplicate" })));
    await waitFor(async () => expect((await vault.diagrams()).length).toBe(4));
  });

  it("asks for pictures that are missing to be drawn again while the editor is installed", async () => {
    await open();
    await screen.findByRole("button", { name: "Open Network" });
    await waitFor(() => expect(useDiagramHost.getState().queue.sort()).toEqual(["library/Network.drawio", "projects/trip/diagrams/Route.drawio"]));
  });

  it("offers to install the editor and draws nothing until it is, saying where it comes from and what it is", async () => {
    await open(MISSING);
    const notice = await screen.findByRole("region", { name: "Diagram editor" });
    expect(notice.textContent).toContain("The diagram editor is not installed");
    expect(notice.textContent).toContain("48 MB");
    expect(notice.textContent).toContain("github.com");
    expect(notice.textContent).toContain("draw.io (diagrams.net), Apache-2.0");
    // The preview has no desktop app to install with, and says so rather than offering a button that does nothing.
    expect(within(notice).queryByRole("button", { name: /Install/ })).toBeNull();
    // Only the way to Settings, where the editor is installed and removed.
    expect(within(notice).getAllByRole("button").map((b) => b.textContent)).toEqual(["Diagram settings"]);
    expect(notice.textContent).toContain("Installing needs the desktop app");
    expect(useDiagramHost.getState().queue).toEqual([]);
    // Diagrams already there are still listed.
    expect(screen.getByRole("button", { name: "Open Network" })).toBeTruthy();
  });

  it("makes no mention of the editor when it is installed", async () => {
    await open();
    await screen.findByRole("button", { name: "Open Network" });
    expect(screen.queryByRole("region", { name: "Diagram editor" })).toBeNull();
  });

  it("brings in the files dropped on it", async () => {
    const vault = await open(INSTALLED, false);
    await screen.findByText("No diagrams yet");
    const file = new File([XML], "Sketch.drawio", { type: "application/octet-stream" });
    await act(async () => {
      fireEvent.drop(screen.getByRole("heading", { name: "Diagrams" }), { dataTransfer: { files: [file], types: ["Files"] } });
    });
    await waitFor(async () => expect((await vault.diagrams()).map((d) => d.title)).toEqual(["Sketch"]));
  });
});
