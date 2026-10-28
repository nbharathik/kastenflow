// Smart pages are a plugin that is off until a person turns it on, for each
// vault, with a choice of each project. These are the window's side of it: the
// switch's default, what a page asks, the project's choice and the plugin's
// card in Settings → Plugins. (The app enforces the same on every frame.)

import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CATALOG } from "../../plugins/catalog";
import { setPluginsBackend, type PluginInfo, type PluginsBackend } from "../../plugins/api";
import { PluginsSettings } from "../../plugins/PluginsSettings";
import { usePlugins } from "../../plugins/registry";
import { smartProjectItems } from "../projects/home-menu";
import type { MenuEntry } from "../../shell/menu-types";
import type { NoteMeta } from "../../lib/vault/types";
import { forgetProjectSmart, projectChoice, projectOfPath, setProjectSmart, smartAvailable, useProjectSmart, useSmartAvailable } from "./availability";
import { tauriSmartBackend } from "./backend";
import { forgetRunSwitch, loadRunSwitch, setRunSwitch, useRunSwitch, useSmartRunning } from "./run-switch";
import { SmartOffLine } from "./SmartTabs";
import { FakeBackend } from "./test-support/fake-frame";

beforeEach(() => {
  forgetRunSwitch();
  forgetProjectSmart();
  usePlugins.setState({ enabled: [], loaded: {}, info: [], on: {}, payload: {}, problem: {} });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setPluginsBackend(null);
  delete (globalThis as unknown as { isTauri?: boolean }).isTauri;
});

describe("the switch", () => {
  it("is off until the app says otherwise, and for a page the app has not answered about", () => {
    expect(useRunSwitch.getState()).toMatchObject({ on: false, known: false, pages: {} });
    expect(smartAvailable()).toBe(false);
    expect(smartAvailable("trip")).toBe(false);
  });

  it("stays off when the app cannot be asked", async () => {
    const backend = new FakeBackend();
    backend.runEnabled = async () => {
      throw new Error("no app");
    };
    await loadRunSwitch(backend);
    expect(useRunSwitch.getState()).toMatchObject({ on: false, known: true });
    await loadRunSwitch(backend, "library/a.md");
    expect(useRunSwitch.getState().pages).toEqual({ "library/a.md": false });
  });

  it("asks the app once for the vault and once for each page, and a page is its own answer", async () => {
    const backend = new FakeBackend();
    backend.running = false;
    const asked = vi.spyOn(backend, "runEnabled");
    const { result, rerender } = renderHook(({ page }) => useSmartRunning(backend, true, page), { initialProps: { page: "library/a.md" } });
    await waitFor(() => expect(result.current).toEqual({ on: false, known: true }));
    backend.running = true;
    rerender({ page: "projects/trip/b.md" });
    await waitFor(() => expect(result.current).toEqual({ on: true, known: true }));
    rerender({ page: "library/a.md" });
    expect(result.current).toEqual({ on: false, known: true });
    expect(asked.mock.calls.map((c) => c[0])).toEqual(["library/a.md", "projects/trip/b.md"]);
  });

  it("turning the plugin on tells Settings and the menus, and every page asks again", async () => {
    const backend = new FakeBackend();
    backend.running = false;
    await loadRunSwitch(backend, "library/a.md");
    expect(useRunSwitch.getState().pages["library/a.md"]).toBe(false);
    expect(await setRunSwitch(true, backend)).toBe(true);
    expect(backend.running).toBe(true);
    expect(usePlugins.getState().on.smart).toBe(true);
    expect(smartAvailable()).toBe(true);
    expect(useRunSwitch.getState().pages).toEqual({});
  });

  it("stays as it was when the app refuses", async () => {
    const backend = new FakeBackend();
    backend.setRunEnabled = async () => {
      throw new Error("no");
    };
    expect(await setRunSwitch(true, backend)).toBe(false);
    expect(usePlugins.getState().on.smart).toBeUndefined();
    expect(useRunSwitch.getState().on).toBe(false);
  });
});

describe("a project's choice", () => {
  it("beats the vault's plugin either way, and a page outside any project follows the vault", () => {
    useProjectSmart.setState({ projects: { trip: "on", thesis: "off" }, known: true });
    expect(smartAvailable("trip")).toBe(true);
    expect(smartAvailable("thesis")).toBe(false);
    expect(smartAvailable("other")).toBe(false);
    expect(smartAvailable(null)).toBe(false);
    usePlugins.setState({ on: { smart: true } });
    expect(smartAvailable("trip")).toBe(true);
    expect(smartAvailable("thesis")).toBe(false);
    expect(smartAvailable("other")).toBe(true);
    expect(smartAvailable(null)).toBe(true);
  });

  it("is read from the app once, and drawn again when it changes", async () => {
    (globalThis as unknown as { isTauri: boolean }).isTauri = true;
    vi.spyOn(tauriSmartBackend, "projectSettings").mockResolvedValue({ trip: "on" });
    const { result } = renderHook(() => useSmartAvailable("trip"));
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true));
    act(() => useProjectSmart.setState({ projects: {}, known: true }));
    expect(result.current).toBe(false);
  });

  it("is set through the app, remembered, and makes each page ask again", async () => {
    const backend = new FakeBackend();
    useRunSwitch.setState({ pages: { "projects/trip/a.md": true } });
    expect(await setProjectSmart("trip", "off", backend)).toBe(true);
    expect(backend.projectSet).toEqual([["trip", "off"]]);
    expect(projectChoice("trip")).toBe("off");
    expect(useRunSwitch.getState().pages).toEqual({});
    expect(await setProjectSmart("trip", "vault", backend)).toBe(true);
    expect(projectChoice("trip")).toBe("vault");
    backend.setProjectSetting = async () => {
      throw new Error("no");
    };
    expect(await setProjectSmart("trip", "on", backend)).toBe(false);
    expect(projectChoice("trip")).toBe("vault");
  });

  it("finds the project of a page by its path", () => {
    expect(projectOfPath("projects/trip/pages/a.md")).toBe("trip");
    expect(projectOfPath("library/a.md")).toBeNull();
  });
});

describe("the line over a page's notes while smart pages are off", () => {
  it("turns the plugin on for the vault from a page in the library", async () => {
    const backend = new FakeBackend();
    backend.running = false;
    render(<SmartOffLine backend={backend} page="library/a.md" />);
    expect(screen.getByRole("status").textContent).toBe("Smart pages are off — Turn on");
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(backend.running).toBe(true));
  });

  it("turns them on for the project when it is the project that says off", async () => {
    const backend = new FakeBackend();
    backend.projects = { trip: "off" };
    render(<SmartOffLine backend={backend} page="projects/trip/a.md" />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Smart pages are off in this project — Turn on"));
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(backend.projectSet).toEqual([["trip", "on"]]));
    expect(backend.running).toBe(true);
  });
});

describe("a project's menu", () => {
  const project = { path: "projects/trip/_project.md", id: "p", title: "Trip", kind: "project", project: "trip", locked: false, tags: [], props: {} } as unknown as NoteMeta;
  const rows = (): { label: string; checked?: boolean; onSelect(): void }[] => {
    const [item] = smartProjectItems(project);
    return ((item as Extract<MenuEntry, { submenu: MenuEntry[] }>).submenu as { label: string; checked?: boolean; onSelect(): void }[]);
  };

  it("has nothing in the browser preview, where there is no project file to change", () => {
    expect(smartProjectItems(project)).toEqual([]);
  });

  it("offers the vault's choice, on and off, with the current one ticked, and sets it", async () => {
    (globalThis as unknown as { isTauri: boolean }).isTauri = true;
    useProjectSmart.setState({ projects: { trip: "off" }, known: true });
    expect(rows().map((r) => [r.label, r.checked])).toEqual([
      ["Use the vault's choice", false],
      ["On in this project", false],
      ["Off in this project", true],
    ]);
    const set = vi.spyOn(tauriSmartBackend, "setProjectSetting").mockResolvedValue();
    await act(async () => rows()[1]!.onSelect());
    expect(set).toHaveBeenCalledWith("trip", "on");
    expect(projectChoice("trip")).toBe("on");
  });
});

describe("Settings → Plugins", () => {
  const info: PluginInfo[] = [{ id: "smart", name: "Smart pages", summary: "Pages with a small app of their own.", version: "1", defaultOn: false, scope: "vault", payload: null, enabled: false }];
  const backend = (): PluginsBackend => ({
    list: vi.fn(async () => info.map((p) => ({ ...p }))),
    setEnabled: vi.fn(async () => true),
    status: vi.fn(),
    install: vi.fn(),
    cancel: vi.fn(),
    remove: vi.fn(),
    onPayload: vi.fn(async () => () => {}),
  });

  it("lists Smart pages in the catalogue, off by default, with nothing to download", () => {
    const entry = CATALOG.find((e) => e.manifest.id === "smart")!;
    expect(entry.manifest).toMatchObject({ name: "Smart pages", defaultOn: false, scope: "vault" });
    expect(entry.manifest.payload).toBeUndefined();
  });

  it("shows an Off card and one switch turns it on for the vault", async () => {
    const plugins = backend();
    setPluginsBackend(plugins);
    render(<PluginsSettings />);
    await act(async () => {});
    await act(async () => {});
    const card = within(document.querySelector<HTMLElement>('[data-plugin="smart"]')!);
    expect(card.getByRole("status").textContent).toBe("Off");
    expect(smartAvailable()).toBe(false);
    fireEvent.click(card.getByRole("switch"));
    await act(async () => {});
    expect(plugins.setEnabled).toHaveBeenCalledWith("smart", true);
    expect(card.getByRole("status").textContent).toBe("On");
    expect(smartAvailable()).toBe(true);
  });
});
