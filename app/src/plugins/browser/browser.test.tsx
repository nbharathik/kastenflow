// What the Browser adds to the window, as the browser plugin gives it. The
// expected lists are the ones the shell hard-coded before the move (palette,
// sidebar row, Ctrl+T), so a browser that is on leaves them as they were. The
// switch stays the computer's: nothing here writes the vault's settings.

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setBrowserBackend } from "../../features/browser/backend";
import { browserOn, onBrowserTab } from "../../features/browser/commands";
import { resetBrowserPrefs, useBrowserPrefs } from "../../features/browser/prefs";
import type { BrowserBackend } from "../../features/browser/types";
import { MemoryVault } from "../../features/workspace/preview/memory-vault";
import { allCommands, COMMANDS } from "../../features/workspace/overlays/commands";
import { useWorkspace } from "../../features/workspace/store";
import { availableNav, placeOfNav } from "../../shell/nav";
import { setPreviewBackend } from "../../features/browser/preview-backend";
import { webPreviewHost } from "../../features/slides/web-preview";
import { setPluginsBackend, type PluginInfo, type PluginsBackend } from "../api";
import { CATALOG } from "../catalog";
import { settingsSections } from "../contributions";
import { PluginCard } from "../PluginCard";
import { usePlugins } from "../registry";

/** The palette entries as `overlays/commands.ts` listed them. */
const PALETTE = [
  { id: "browser", label: "Open browser", words: "web internet site page search google capture clip" },
  { id: "browser-address", label: "Browser: go to the address box", words: "web url search location bar" },
  { id: "browser-capture-page", label: "Browser: capture the page", words: "web clip save keep bookmark" },
  { id: "browser-capture-selection", label: "Browser: capture the selection", words: "web clip save keep quote highlight" },
  { id: "browser-save-paper", label: "Browser: save the page as a paper", words: "web reference bibliography citation article doi arxiv journal cite" },
];
const IDS = PALETTE.map((p) => p.id);

/** What the palette shows now: the commands that apply here. */
const shown = () => allCommands().filter((c) => IDS.includes(c.id) && (c.when?.() ?? true));

const idle = (computer: { on: boolean }): BrowserBackend => ({
  available: true,
  enabled: () => Promise.resolve(computer.on),
  setEnabled: (on) => {
    computer.on = on;
    return Promise.resolve(on);
  },
  open: (_id, url) => Promise.resolve(url),
  bounds: () => Promise.resolve(),
  hide: () => Promise.resolve(),
  show: () => Promise.resolve(),
  close: () => Promise.resolve(),
  nav: () => Promise.resolve(),
  capture: () => Promise.reject(new Error("no")),
  confirm: () => Promise.reject(new Error("no")),
  discard: () => Promise.resolve(),
  clearData: () => Promise.resolve(),
  onEvent: () => Promise.resolve(() => {}),
});

/** What the app answers: the computer's switch, as `plugins_list` reads it from the app's settings. */
function app(computer: { on: boolean }) {
  const info = (): PluginInfo[] => [
    { id: "diagrams", name: "Diagrams", summary: "d", version: "1", defaultOn: true, scope: "vault", payload: null, enabled: false },
    { id: "browser", name: "Browser", summary: "Open web pages in a tab of their own.", version: "1", defaultOn: false, scope: "computer", payload: null, enabled: computer.on },
  ];
  const setEnabled = vi.fn((id: string, on: boolean) => {
    if (id === "browser") computer.on = on;
    return Promise.resolve(true);
  });
  const backend: PluginsBackend = {
    list: () => Promise.resolve(info()),
    setEnabled,
    status: (id) => Promise.resolve({ id, state: "idle", installed: false, busy: false, version: null, sizeBytes: 0 }),
    install: () => Promise.resolve("installed"),
    cancel: () => Promise.resolve(),
    remove: () => Promise.resolve(),
    onPayload: () => Promise.resolve(() => {}),
  };
  return { backend, setEnabled };
}

beforeEach(async () => {
  localStorage.clear();
  resetBrowserPrefs();
  usePlugins.setState({ enabled: [], loaded: {}, info: [], on: {}, payload: {}, problem: {} });
  await useWorkspace.getState().connect({ client: new MemoryVault({}) });
});
afterEach(() => {
  cleanup();
  setBrowserBackend(null);
  setPluginsBackend(null);
  usePlugins.setState({ enabled: [], loaded: {}, info: [], on: {}, payload: {}, problem: {} });
  resetBrowserPrefs();
});

describe("the browser before it is turned on", () => {
  it("adds nothing: no palette entry, no sidebar row, no section", () => {
    expect(shown()).toEqual([]);
    expect(browserOn()).toBe(false);
    expect(availableNav().some((n) => n.id === "browser")).toBe(false);
    expect(settingsSections().some((s) => s.plugin === "browser")).toBe(false);
  });

  it("is in the catalogue as this computer's, off for a computer that has not chosen", () => {
    const entry = CATALOG.find((e) => e.manifest.id === "browser");
    expect(entry?.manifest).toMatchObject({ id: "browser", name: "Browser", icon: "globe", defaultOn: false, scope: "computer" });
    expect(entry?.manifest.payload).toBeUndefined();
  });
});

describe("the browser once it is on", () => {
  const turnOn = async () => {
    useBrowserPrefs.setState({ enabled: true, known: true });
    await usePlugins.getState().enable("browser", CATALOG);
  };

  it("puts the same five entries in the palette", async () => {
    await turnOn();
    expect(shown().map(({ id, label, words }) => ({ id, label, words })).filter((c) => c.id === "browser")).toEqual([PALETTE[0]]);
    // The four that act on a browser tab apply while one is in front.
    useWorkspace.getState().go({ view: "web" });
    expect(onBrowserTab()).toBe(true);
    expect(shown().map(({ id, label, words }) => ({ id, label, words }))).toEqual(PALETTE);
  });

  it("lists the Browser in the sidebar's views, under Tools, opening a browser tab", async () => {
    await turnOn();
    const row = availableNav().find((n) => n.id === "browser");
    expect(row).toMatchObject({ label: "Browser", icon: "globe", group: "tools" });
    expect(placeOfNav("browser")).toEqual({ view: "web" });
  });

  it("Ctrl+T stays the app's own command and makes a browser tab beside a browser tab", async () => {
    await turnOn();
    useWorkspace.getState().go({ view: "web", url: "https://example.com/" });
    COMMANDS.find((c) => c.id === "new-tab")!.run();
    const tabs = useWorkspace.getState().layout.panes.flatMap((p) => p.tabs.map((t) => t.place));
    expect(tabs.at(-1)).toEqual({ view: "web" });
  });

  it("draws the Browser settings while it is on", async () => {
    await turnOn();
    expect(settingsSections().map((s) => [s.plugin, s.title])).toEqual([["browser", "Browser"]]);
  });
});

describe("the browser's switch is the computer's", () => {
  it("follows what the app says on start, and never writes the vault", async () => {
    const computer = { on: true };
    const { backend, setEnabled } = app(computer);
    setPluginsBackend(backend);
    await usePlugins.getState().sync(CATALOG);
    expect(usePlugins.getState().on.browser).toBe(true);
    expect(usePlugins.getState().enabled).toContain("browser");
    expect(useBrowserPrefs.getState().enabled).toBe(true);
    expect(setEnabled).not.toHaveBeenCalled();
    expect(useWorkspace.getState().client).not.toBeNull();
  });

  it("stays off when the computer never turned it on", async () => {
    const { backend } = app({ on: false });
    setPluginsBackend(backend);
    await usePlugins.getState().sync(CATALOG);
    expect(usePlugins.getState().on.browser).toBe(false);
    expect(useBrowserPrefs.getState().enabled).toBe(false);
    expect(shown()).toEqual([]);
  });

  it("turning it on from the Plugins page asks the app, which sets the computer's switch, and the window follows", async () => {
    const computer = { on: false };
    const { backend, setEnabled } = app(computer);
    setPluginsBackend(backend);
    await usePlugins.getState().sync(CATALOG);
    await usePlugins.getState().setEnabled("browser", true, CATALOG);
    expect(setEnabled).toHaveBeenCalledWith("browser", true);
    expect(computer.on).toBe(true);
    await waitFor(() => expect(useBrowserPrefs.getState().enabled).toBe(true));
    expect(browserOn()).toBe(true);
    expect(availableNav().some((n) => n.id === "browser")).toBe(true);
    await usePlugins.getState().setEnabled("browser", false, CATALOG);
    expect(computer.on).toBe(false);
    expect(useBrowserPrefs.getState().enabled).toBe(false);
    expect(availableNav().some((n) => n.id === "browser")).toBe(false);
    expect(shown()).toEqual([]);
    expect(settingsSections().some((s) => s.plugin === "browser")).toBe(false);
  });

  it("the switch in Settings → Browser moves the plugin's state with it", async () => {
    const computer = { on: false };
    setBrowserBackend(idle(computer));
    const { backend } = app(computer);
    setPluginsBackend(backend);
    await usePlugins.getState().sync(CATALOG);
    await useBrowserPrefs.getState().turn(true);
    const { reflectBrowser } = await import("./link");
    await reflectBrowser(true);
    expect(usePlugins.getState().on.browser).toBe(true);
    expect(usePlugins.getState().enabled).toContain("browser");
  });
});

describe("the Plugins page card", () => {
  it("says it is for this computer", () => {
    const data = { id: "browser", name: "Browser", summary: "Open web pages in a tab of their own.", icon: "globe" as const, scope: "computer" as const, bytes: null };
    render(<PluginCard data={data} catalog={CATALOG} />);
    expect(screen.getByText(/This computer/)).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Browser" })).toBeTruthy();
  });
});

describe("the Slides web preview card", () => {
  it("opens no native view while the plugin is off, so the editor shows its card", async () => {
    const open = vi.fn(() => Promise.resolve("https://example.com/"));
    setPreviewBackend({ available: true, open, bounds: () => Promise.resolve(), nav: () => Promise.resolve(), hide: () => Promise.resolve(), show: () => Promise.resolve(), close: () => Promise.resolve(), childFocus: () => Promise.resolve(), onChildKey: () => Promise.resolve(() => {}) });
    setBrowserBackend(idle({ on: false }));
    const { backend } = app({ on: false });
    setPluginsBackend(backend);
    await usePlugins.getState().sync(CATALOG);
    expect(await webPreviewHost().open("https://example.com/", { kind: "beside" } as never)).toBeNull();
    expect(open).not.toHaveBeenCalled();
    setPreviewBackend(null);
  });
});
