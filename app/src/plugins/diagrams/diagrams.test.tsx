// What draw.io adds to the window, as the diagrams plugin gives it. The
// expected lists below are the ones the shell hard-coded before the move
// (palette, slash menu, "New" menus, sidebar), copied from those lists, so a
// plugin that is on leaves the lists as they were.

import type { Ctx } from "@milkdown/kit/ctx";
import type { EditorState } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { newActions, slashActions } from "../../features/home/actions";
import { matchChoices, slashChoices } from "../../features/pages/editor/menus/catalog";
import { startDiagramPick } from "../../features/pages/editor/menus/diagram-pick";
import { choiceCommand } from "../../features/pages/editor/menus/slash";
import { MemoryVault } from "../../features/workspace/preview/memory-vault";
import { openKind } from "../../features/workspace/open-kind";
import { allCommands } from "../../features/workspace/overlays/commands";
import { readSets } from "../../features/workspace/tab-sets";
import { useWorkspace } from "../../features/workspace/store";
import { availableNav, findNav, groupedNav, pinnedIds } from "../../shell/nav";
import { newTabItems } from "../../shell/NewTab";
import { tabFace } from "../../shell/TabStrip";
import { fileHandlerFor, settingsSections, sidebarRows, treeRows, viewById, views } from "../contributions";
import { usePlugins } from "../registry";
import { CATALOG } from "../catalog";

vi.mock("../../features/pages/editor/menus/diagram-pick", () => ({ startDiagramPick: vi.fn() }));

/** The palette entries as `overlays/commands.ts` listed them. */
const PALETTE = [
  { id: "diagrams", label: "Go to Diagrams", words: "draw drawio flowchart architecture sketch uml" },
  { id: "new-diagram", label: "New diagram", words: "draw drawio flowchart architecture sketch uml create" },
];

/** The slash choice as `menus/catalog.ts` listed it (its action ran the diagram menu). */
const SLASH = {
  key: "diagram",
  label: "Diagram",
  icon: "icon:diagram",
  description: "Show a diagram in the page, or draw a new one.",
  keywords: ["diagram", "drawio", "flowchart", "flow", "chart", "architecture", "uml", "sketch", "draw"],
  section: "Advanced",
};

/** The "+ New" entry as `home/actions.ts` listed it. */
const NEW = { id: "diagram", label: "New diagram", icon: "diagram", words: "draw flowchart drawio" };

/** The sidebar row as `shell/nav.ts` listed it (under Think, between the whiteboards and the slides). */
const ROW = { id: "plugin:diagrams", label: "Diagrams", icon: "diagram", group: "think" };

const on = () => usePlugins.getState().enable("diagrams", CATALOG);

beforeEach(async () => {
  usePlugins.setState({ enabled: [], loaded: {} });
  await useWorkspace.getState().connect({ client: new MemoryVault({}) });
});
afterEach(() => {
  cleanup();
  usePlugins.setState({ enabled: [], loaded: {} });
  vi.clearAllMocks();
});

describe("with the plugin off", () => {
  it("adds nothing to the shell's lists", () => {
    expect(allCommands().some((c) => c.id === "diagrams" || c.id === "new-diagram")).toBe(false);
    expect(slashChoices().some((c) => c.key === "diagram")).toBe(false);
    expect(newActions().some((a) => a.id === "diagram")).toBe(false);
    expect(availableNav().some((n) => n.id === "plugin:diagrams")).toBe(false);
    expect([views(), sidebarRows(), settingsSections(), treeRows()].map((l) => l.length)).toEqual([0, 0, 0, 0]);
  });
});

describe("with the plugin on", () => {
  it("is in the catalogue, on for a vault that has not chosen", () => {
    const entry = CATALOG.find((e) => e.manifest.id === "diagrams");
    expect(entry?.manifest).toMatchObject({ id: "diagrams", name: "Diagrams", icon: "diagram", defaultOn: true, scope: "vault" });
  });

  it("puts the same two entries in the palette", async () => {
    expect(await on()).toBe(true);
    const mine = allCommands().filter((c) => c.id === "diagrams" || c.id === "new-diagram");
    expect(mine.map(({ id, label, words }) => ({ id, label, words }))).toEqual(PALETTE);
  });

  it("the palette's Go to Diagrams opens the plugin's view", async () => {
    await on();
    allCommands().find((c) => c.id === "diagrams")!.run();
    expect(useWorkspace.getState().place).toEqual({ view: "plugin:diagrams" });
  });

  it("puts the same slash choice in the same place: ahead of the whiteboard, found first by diagram and draw", async () => {
    await on();
    const choices = slashChoices();
    const at = choices.findIndex((c) => c.key === "diagram");
    const { action: _action, before, ...rest } = choices[at]!;
    expect(before).toBe("board");
    expect(rest).toEqual(SLASH);
    expect(choices[at + 1]!.key).toBe("board");
    for (const word of ["diagram", "drawio", "flowchart", "architecture", "draw"]) expect(matchChoices(choices, word)[0]!.key, word).toBe("diagram");
  });

  it("the slash choice opens the page's diagram menu where the caret is", async () => {
    await on();
    const choice = slashChoices().find((c) => c.key === "diagram")!;
    const view = {} as EditorView;
    const ctx = {} as Ctx;
    const ran = choiceCommand(choice, ctx)({ selection: { from: 7 } } as EditorState, undefined, view);
    expect(ran).toBe(true);
    // The picker is part of the editor's code: it is fetched when the choice is picked.
    await vi.waitFor(() => expect(startDiagramPick).toHaveBeenCalledWith(view, ctx, 7));
  });

  it("puts the same item in Home's New menu and the capture field, and adds it to the tab + menu", async () => {
    await on();
    const item = newActions().find((a) => a.id === "diagram")!;
    expect({ id: item.id, label: item.label, icon: item.icon, words: item.words }).toEqual(NEW);
    expect(newActions().map((a) => a.id).slice(-1)).toEqual(["diagram"]);
    expect(slashActions().some((a) => a.id === "diagram")).toBe(true);
    expect(newTabItems().some((i) => i !== "divider" && "label" in i && i.label === "New diagram")).toBe(true);
  });

  it("lists the sidebar row under Think between the whiteboards and the slides", async () => {
    await on();
    const row = sidebarRows()[0]!;
    expect({ id: row.id, label: row.label, icon: row.icon, group: row.group }).toEqual(ROW);
    const think = groupedNav(availableNav()).find((g) => g.id === "think")!;
    expect(think.items.map((i) => i.id)).toEqual(["boards", "plugin:diagrams", "slides", "graph"]);
    expect(findNav("plugin:diagrams")).toMatchObject({ label: "Diagrams", group: "think" });
    // It is not pinned until the person pins it; a pin saved before the move still finds it.
    expect(pinnedIds(["inbox", "diagrams"])).toEqual(["inbox", "plugin:diagrams"]);
  });

  it("opens .drawio files in the plugin's view", async () => {
    await on();
    expect(openKind("library/Flow.drawio")).toBe("plugin:diagrams");
    expect(fileHandlerFor("library/Flow.drawio")).toBe("plugin:diagrams");
    expect(fileHandlerFor("library/Flow.DRAWIO")).toBe("plugin:diagrams");
    expect(viewById("plugin:diagrams")).toMatchObject({ title: "Diagrams", icon: "diagram" });
  });

  it("names a diagram's tab by its title", async () => {
    await on();
    expect(tabFace({ view: "plugin:diagrams", path: "library/Login-flow.drawio" }, [])).toMatchObject({ title: "Login flow" });
    expect(tabFace({ view: "plugin:diagrams" }, [])).toMatchObject({ title: "Diagrams" });
  });

  it("adds a Settings section, and the sidebar's project and favourite rows", async () => {
    await on();
    expect(settingsSections().map((s) => [s.plugin, s.title])).toEqual([["diagrams", "Diagrams"]]);
    expect(treeRows()).toHaveLength(1);
    expect(treeRows()[0]!.owns("library/Flow.drawio")).toBe(true);
    expect(treeRows()[0]!.owns("library/Flow.canvas")).toBe(false);
  });

  it("reads a tab set saved before the move, and keeps any plugin's view", () => {
    const saved = [{ name: "Work", tabs: [{ place: { view: "diagrams", path: "library/Flow.drawio" }, pinned: false }, { place: { view: "plugin:other", path: "a.x" }, pinned: true }, { place: { view: "nope" }, pinned: false }] }];
    expect(readSets(saved)[0]!.tabs.map((t) => t.place)).toEqual([{ view: "plugin:diagrams", path: "library/Flow.drawio" }, { view: "plugin:other", path: "a.x" }]);
  });

  it("takes everything away when turned off", async () => {
    await on();
    usePlugins.getState().disable("diagrams");
    expect(allCommands().some((c) => c.id === "new-diagram")).toBe(false);
    expect(slashChoices().some((c) => c.key === "diagram")).toBe(false);
    expect(newActions().some((a) => a.id === "diagram")).toBe(false);
    expect(availableNav().some((n) => n.id === "plugin:diagrams")).toBe(false);
    expect(settingsSections()).toEqual([]);
    expect(treeRows()).toEqual([]);
  });
});
