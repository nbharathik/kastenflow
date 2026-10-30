// A dummy plugin shows that what a plugin contributes appears when it is
// turned on and goes when it is turned off, and that with none on the window
// is what it was.

import { act, cleanup, render, screen } from "@testing-library/react";
import { lazy } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { newActions, slashActions } from "../features/home/actions";
import { matchChoices, slashChoices, SLASH_CHOICES } from "../features/pages/editor/menus/catalog";
import { MemoryVault } from "../features/workspace/preview/memory-vault";
import { allCommands, COMMANDS } from "../features/workspace/overlays/commands";
import { openKind } from "../features/workspace/open-kind";
import { runFor } from "../features/workspace/shortcuts";
import { useWorkspace } from "../features/workspace/store";
import { availableNav, findNav } from "../shell/nav";
import { newTabItems } from "../shell/NewTab";
import { ViewOutlet } from "../shell/ViewOutlet";
import { commands, fileHandlerFor, newItems, pageMenuItems, settingsSections, sidebarRows, slashItems, viewById, views } from "./contributions";
import { usePlugins } from "./registry";
import type { CatalogEntry, PluginContributions } from "./types";

const ran = vi.fn();
const Dummy = lazy(async () => ({ default: ({ place }: { place: { path?: string } }) => <p>Dummy view {place.path}</p> }));

const dummy: PluginContributions = {
  views: [{ id: "plugin:dummy", title: "Dummy", icon: "plug", lazy: Dummy }],
  fileHandlers: [{ ext: ["dummy", ".dummy.svg"], view: "plugin:dummy" }],
  commands: [{ id: "dummy-hello", label: "Say hello from Dummy", run: ran }],
  slash: [{ key: "dummy-block", label: "Dummy block", icon: "icon:text", description: "A block from Dummy.", keywords: ["dummyword"], section: "Dummy", action: { type: "plugin", run: ran } }],
  newItems: [{ id: "dummy-new", label: "New dummy", icon: "compose", run: ran }],
  sidebar: [{ id: "plugin:dummy", label: "Dummy", icon: "plug", group: "tools" }],
  pageMenu: [{ label: "Dummy action", onSelect: ran }],
  settingsSection: { title: "Dummy", render: () => null },
};

const entry: CatalogEntry = {
  manifest: { id: "dummy", name: "Dummy", summary: "A test plugin.", icon: "plug", version: "1.0.0", defaultOn: false, scope: "vault" },
  load: async () => dummy,
};

beforeEach(() => {
  ran.mockReset();
  usePlugins.setState({ enabled: [], loaded: {} });
});
afterEach(() => {
  cleanup();
  usePlugins.setState({ enabled: [], loaded: {} });
});

describe("with no plugin on", () => {
  it("contributes nothing, and the window's lists are the app's own", () => {
    expect([views(), commands(), slashItems(), newItems(), sidebarRows(), pageMenuItems(), settingsSections()]).toEqual([[], [], [], [], [], [], []]);
    // Besides the commands that turn the catalogue's plugins on and off.
    // The table and timeline commands are the open database's own, added by its view bar.
    expect(allCommands().filter((c) => !/^(plugin|table-|timeline-)/.test(c.id))).toEqual(COMMANDS);
    expect(slashChoices()).toEqual(SLASH_CHOICES);
    expect(fileHandlerFor("a.dummy")).toBeUndefined();
    expect(availableNav().some((n) => n.id.startsWith("plugin:"))).toBe(false);
  });

  it("opens files by extension as it always did", () => {
    expect(openKind("a.canvas")).toBe("boards");
    expect(openKind("a.deck")).toBe("slides");
    expect(openKind("a.drawio")).toBe("plugin:diagrams");
    expect(openKind("papers/A.PDF")).toBe("highlights");
    expect(openKind("notes/a.md")).toBe("page");
    expect(openKind("journal/2026/2026-10-20.md")).toBe("page");
  });
});

describe("a plugin turned on", () => {
  it("is loaded from the catalogue, and an unknown one is refused", async () => {
    expect(await usePlugins.getState().enable("nothing", [entry])).toBe(false);
    expect(await usePlugins.getState().enable("dummy", [entry])).toBe(true);
    expect(usePlugins.getState().enabled).toEqual(["dummy"]);
    const failing: CatalogEntry = { ...entry, load: () => Promise.reject(new Error("no")) };
    usePlugins.setState({ enabled: [], loaded: {} });
    expect(await usePlugins.getState().enable("dummy", [failing])).toBe(false);
    expect(usePlugins.getState().enabled).toEqual([]);
  });

  it("starts the ones the catalogue says are on", async () => {
    await usePlugins.getState().enableDefaults([entry, { ...entry, manifest: { ...entry.manifest, id: "other", defaultOn: true }, load: async () => ({ commands: [{ id: "o", label: "O", run: ran }] }) }]);
    expect(usePlugins.getState().enabled).toEqual(["other"]);
  });

  it("shows its view, command, slash block, new item, sidebar row and menu item, and takes them away when off", async () => {
    await usePlugins.getState().enable("dummy", [entry]);

    expect(viewById("plugin:dummy")?.title).toBe("Dummy");
    expect(allCommands().map((c) => c.id)).toContain("dummy-hello");
    expect(matchChoices(slashChoices(), "dummyword").map((c) => c.key)).toEqual(["dummy-block"]);
    expect(newActions().map((a) => a.id)).toContain("dummy-new");
    expect(slashActions().map((a) => a.id)).toContain("dummy-new");
    expect(newTabItems().some((i) => i !== "divider" && "label" in i && i.label === "New dummy")).toBe(true);
    expect(availableNav().map((n) => n.id)).toContain("plugin:dummy");
    expect(findNav("plugin:dummy")?.label).toBe("Dummy");
    expect(pageMenuItems().map((m) => ("label" in m ? m.label : ""))).toEqual(["Dummy action"]);
    expect(settingsSections().map((s) => s.plugin)).toEqual(["dummy"]);

    // Its key runs its command.
    runFor("dummy-hello")?.();
    expect(ran).toHaveBeenCalledTimes(1);

    usePlugins.getState().disable("dummy");

    expect(viewById("plugin:dummy")).toBeUndefined();
    expect(allCommands().map((c) => c.id)).not.toContain("dummy-hello");
    expect(matchChoices(slashChoices(), "dummyword")).toEqual([]);
    expect(newActions().map((a) => a.id)).not.toContain("dummy-new");
    expect(availableNav().map((n) => n.id)).not.toContain("plugin:dummy");
    expect(findNav("plugin:dummy")).toBeUndefined();
    expect(runFor("dummy-hello")).toBeNull();
  });

  it("opens the files it handles, longest extension first", async () => {
    usePlugins.getState().register("dummy", dummy);
    usePlugins.getState().register("svg", { fileHandlers: [{ ext: [".svg"], view: "plugin:svg" }] });
    expect(fileHandlerFor("a/B.DUMMY")).toBe("plugin:dummy");
    expect(fileHandlerFor("a/b.dummy.svg")).toBe("plugin:dummy");
    expect(fileHandlerFor("a/b.svg")).toBe("plugin:svg");
    expect(openKind("a/b.dummy")).toBe("plugin:dummy");
    expect(openKind("a/b.canvas")).toBe("boards");
  });

  it("draws its view in a tab, and Home when it is off", async () => {
    await useWorkspace.getState().connect({ client: new MemoryVault({}) });
    usePlugins.getState().register("dummy", dummy);
    render(<ViewOutlet place={{ view: "plugin:dummy", path: "a.dummy" }} />);
    expect(await screen.findByText("Dummy view a.dummy")).toBeTruthy();
    act(() => usePlugins.getState().disable("dummy"));
    expect(screen.queryByText("Dummy view a.dummy")).toBeNull();
  });
});
