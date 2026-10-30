// With draw.io turned off nothing is hidden or lost: pictures still show, the
// files are still listed, and the one thing missing (the editor) is replaced by
// a sentence and a button that turns it on.

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { newDiagram } from "../../features/diagrams/actions";
import { DiagramEmbedView } from "../../features/diagrams/DiagramEmbedView";
import { setEditorBackend, useDiagramEditor, type EditorInfo } from "../../features/diagrams/editor";
import { editDiagram, editDiagramAndWait, useDiagramHost } from "../../features/diagrams/host-store";
import { diagramChanged, useDiagrams } from "../../features/diagrams/store";
import { GROUP_VIEWS } from "../../features/workspace/views/settings/groups";
import { openKind } from "../../features/workspace/open-kind";
import { MemoryVault } from "../../features/workspace/preview/memory-vault";
import { useWorkspace } from "../../features/workspace/store";
import { FavouritePluginRows, usePluginFavourites, ProjectPluginRows } from "../../shell/PluginRows";
import { ViewOutlet } from "../../shell/ViewOutlet";
import { setPluginsBackend, type PluginsBackend } from "../api";
import { CATALOG } from "../catalog";
import { settingsSections, treeRows } from "../contributions";
import { pluginOff } from "../off";
import { usePlugins } from "../registry";

vi.mock("../../features/diagrams/DiagramView", () => ({ DiagramView: ({ path }: { path: string }) => <p>editor of {path}</p> }));

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="81px" height="41px"><defs/><g/></svg>';
const INSTALLED: EditorInfo = { version: "32.2.0", bytes: 48_235_802, url: "https://example.test/draw.war", installed: true, busy: false };
const SENTENCE = "Turn on the draw.io plugin to open this";

let vault: MemoryVault;

const turnOff = () => usePlugins.setState({ enabled: [], loaded: {}, on: { diagrams: false } });

function backend(over: Partial<PluginsBackend> = {}): PluginsBackend {
  return {
    list: async () => [],
    setEnabled: vi.fn(async () => true),
    status: async () => ({ id: "diagrams", state: "ready", installed: true, busy: false, version: "1", sizeBytes: 1 }),
    install: async () => "installed",
    cancel: async () => {},
    remove: async () => {},
    onPayload: async () => () => {},
    ...over,
  };
}

beforeEach(async () => {
  vault = new MemoryVault({});
  usePlugins.setState({ enabled: [], loaded: {}, on: {}, problem: {}, info: [], payload: {} });
  useDiagramHost.setState({ modal: null, queue: [], seen: [], editing: [] });
  useDiagrams.setState({ list: [], loaded: false, templateFor: null });
  useDiagramEditor.setState({ info: null, progress: null, error: null, installing: false });
  setEditorBackend({ status: async () => INSTALLED, install: async () => "installed", cancel: async () => {}, remove: async () => {} });
  await useWorkspace.getState().connect({ client: vault });
  useWorkspace.setState({ toasts: [] });
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:picture-${++n}`);
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  setEditorBackend(null);
  setPluginsBackend(null);
  usePlugins.setState({ enabled: [], loaded: {}, on: {}, problem: {} });
});

describe("a diagram file opened with draw.io off", () => {
  it("is a row that says what to do and has a button for it, not Home and not the editor", async () => {
    turnOff();
    render(<ViewOutlet place={{ view: "plugin:diagrams", path: "library/Login-flow.drawio" }} />);
    expect(await screen.findByText(SENTENCE)).toBeTruthy();
    expect(screen.getByText("Login flow")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Turn on draw.io" })).toBeTruthy();
    expect(screen.queryByText(/editor of/)).toBeNull();
  });

  it("says the same on the Diagrams page itself", async () => {
    turnOff();
    render(<ViewOutlet place={{ view: "plugin:diagrams" }} />);
    expect(await screen.findByText(SENTENCE)).toBeTruthy();
  });

  it("turns the plugin on from the button and goes on to the editor in the same tab", async () => {
    const b = backend();
    setPluginsBackend(b);
    turnOff();
    render(<ViewOutlet place={{ view: "plugin:diagrams", path: "library/Login-flow.drawio" }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Turn on draw.io" }));
    // The plugin's code and the view's load on demand: the first time is slow on a loaded machine.
    expect(await screen.findByText("editor of library/Login-flow.drawio", {}, { timeout: 60_000 })).toBeTruthy();
    expect(b.setEnabled).toHaveBeenCalledWith("diagrams", true);
    expect(pluginOff("diagrams")).toBe(false);
    expect(screen.queryByText(SENTENCE)).toBeNull();
  });

  it("says why when it could not be turned on, and the button stays", async () => {
    setPluginsBackend(backend({ setEnabled: async () => Promise.reject(new Error("The vault is read-only")) }));
    turnOff();
    render(<ViewOutlet place={{ view: "plugin:diagrams", path: "library/Login-flow.drawio" }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Turn on draw.io" }));
    expect((await screen.findByRole("alert")).textContent).toContain("The vault is read-only");
    expect(screen.getByRole("button", { name: "Turn on draw.io" })).toBeTruthy();
  });

  it("still opens as a diagram tab, never as a page", () => {
    turnOff();
    expect(openKind("library/Flow.drawio")).toBe("plugin:diagrams");
  });

  it("is not mistaken for off before the app has answered", async () => {
    usePlugins.setState({ enabled: [], loaded: {}, on: {} });
    expect(pluginOff("diagrams")).toBe(false);
    render(<ViewOutlet place={{ view: "plugin:diagrams", path: "library/Login-flow.drawio" }} />);
    expect(screen.queryByText(SENTENCE)).toBeNull();
  });
});

describe("a diagram in a page with draw.io off", () => {
  async function embed(picture: boolean) {
    const path = await vault.createDiagram("Login flow", null);
    if (picture) {
      const read = await vault.diagram(path);
      await vault.saveDiagram(path, read.xml, SVG, read.hash);
    }
    turnOff();
    render(<DiagramEmbedView path={path} />);
    return path;
  }

  it("shows its picture and nothing to edit it with", async () => {
    const path = await embed(true);
    const image = await screen.findByRole("img", { name: "Login flow" });
    expect(image.getAttribute("src")).toMatch(/^blob:picture-/);
    expect(screen.queryByRole("button", { name: "Edit Login flow" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open Login flow in a tab" })).toBeNull();
    fireEvent.doubleClick(image);
    expect(useDiagramHost.getState().modal).toBeNull();
    expect(useDiagramHost.getState().queue).toEqual([]);
    expect(path).toMatch(/\.drawio$/);
  });

  it("keeps the ways to copy or export the picture", async () => {
    await embed(true);
    await screen.findByRole("img", { name: "Login flow" });
    fireEvent.click(screen.getByRole("button", { name: "Export or copy Login flow" }));
    expect((await screen.findAllByRole("menuitem")).map((i) => i.textContent)).toEqual(["Copy as image", "Export as SVG", "Export as PNG"]);
  });

  it("with no picture says draw.io draws it, and asks for nothing even if the editor is installed", async () => {
    await embed(false);
    expect(await screen.findByText("No picture yet. Turn on the draw.io plugin to draw it.")).toBeTruthy();
    expect(useDiagramHost.getState().queue).toEqual([]);
  });

  it("shows the new picture when the diagram changes", async () => {
    const path = await embed(true);
    const was = (await screen.findByRole("img", { name: "Login flow" })).getAttribute("src");
    await act(async () => diagramChanged(path));
    await waitFor(() => expect(screen.getByRole("img", { name: "Login flow" }).getAttribute("src")).not.toBe(was));
  });
});

describe("asking for the editor with draw.io off", () => {
  it("opens no editor and offers to turn the plugin on", () => {
    turnOff();
    editDiagram("library/Flow.drawio");
    expect(useDiagramHost.getState().modal).toBeNull();
    const toast = useWorkspace.getState().toasts.at(-1)!;
    expect(toast.text).toBe("Turn on the draw.io plugin to edit this diagram");
    expect(toast.action?.label).toBe("Turn on");
  });

  it("does not leave a caller waiting", async () => {
    turnOff();
    await expect(editDiagramAndWait("library/Flow.drawio")).resolves.toBeUndefined();
    expect(useDiagramHost.getState().modal).toBeNull();
  });

  it("makes no new diagram", async () => {
    turnOff();
    const make = vi.spyOn(vault, "createDiagram");
    expect(await newDiagram()).toBeNull();
    expect(make).not.toHaveBeenCalled();
  });

  it("opens the editor as before when it is on", async () => {
    usePlugins.setState({ on: { diagrams: true } });
    editDiagram("library/Flow.drawio");
    expect(useDiagramHost.getState().modal).toBe("library/Flow.drawio");
  });
});

describe("the rest of the window with draw.io off", () => {
  const flow = { path: "library/Flow.drawio", title: "Flow", project: "p1", pages: 1, modified: 1, size: 1, preview: "fresh" as const, problem: null };

  it("adds nothing from the plugin, but the Diagrams group in Settings says what is off", async () => {
    turnOff();
    expect(settingsSections()).toEqual([]);
    expect(treeRows()).toEqual([]);
    const Group = GROUP_VIEWS.diagrams;
    render(<Group onSwitchVault={() => {}} />);
    expect(screen.getByText(/Diagrams are off/)).toBeTruthy();
    expect(screen.getByText(/pictures still show/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Turn on draw.io" })).toBeTruthy();
    expect(screen.queryByText(/Install/)).toBeNull();
  });

  it("still lists the .drawio files under their project and among the favourites, each opening the row above", () => {
    turnOff();
    act(() => useDiagrams.setState({ list: [flow], loaded: true }));
    const stars = ["library/Flow.drawio", "notes/a.md"];
    const kept: string[][] = [];
    function Tree() {
      const mine = usePluginFavourites(stars);
      kept.push(mine);
      return (
        <ul>
          <ProjectPluginRows project="p1" depth={0} />
          <FavouritePluginRows paths={mine} />
        </ul>
      );
    }
    render(<Tree />);
    expect(kept.at(-1)).toEqual(["library/Flow.drawio"]);
    expect(screen.getAllByRole("button", { name: /^Flow/ })).toHaveLength(2);
  });

  it("lists each file once when it is on", async () => {
    await usePlugins.getState().enable("diagrams", CATALOG);
    usePlugins.setState({ on: { diagrams: true } });
    act(() => useDiagrams.setState({ list: [flow], loaded: true }));
    render(
      <ul>
        <ProjectPluginRows project="p1" depth={0} />
      </ul>,
    );
    expect(screen.getAllByRole("button", { name: /^Flow/ })).toHaveLength(1);
  });

  it("gives everything back when turned off and on again", async () => {
    setPluginsBackend(backend());
    await usePlugins.getState().setEnabled("diagrams", true, CATALOG);
    expect(settingsSections()).toHaveLength(1);
    await usePlugins.getState().setEnabled("diagrams", false, CATALOG);
    expect(pluginOff("diagrams")).toBe(true);
    expect(settingsSections()).toEqual([]);
    await usePlugins.getState().setEnabled("diagrams", true, CATALOG);
    expect(pluginOff("diagrams")).toBe(false);
    expect(settingsSections()).toHaveLength(1);
    expect(treeRows()).toHaveLength(1);
  });
});
