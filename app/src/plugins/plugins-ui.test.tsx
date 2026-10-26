// The Plugins page and the registry's link to the app: the list is read from
// the app, a switch writes once, a download starts at once and tells its
// progress, a failure offers Retry, and the palette turns plugins on and off.

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspace } from "../features/workspace/store";
import { allCommands } from "../features/workspace/overlays/commands";
import { commands } from "./contributions";
import { setPluginsBackend, type PayloadEvent, type PluginInfo, type PluginsBackend } from "./api";
import { PluginsSettings } from "./PluginsSettings";
import { usePlugins } from "./registry";
import { statusOf } from "./status";
import type { CatalogEntry } from "./types";

const ran = vi.fn();
const entry = (id: string): CatalogEntry => ({
  manifest: { id, name: id, summary: "", icon: "plug", version: "1.0.0", defaultOn: false, scope: "vault" },
  load: async () => ({ commands: [{ id: `${id}-hello`, label: `Hello from ${id}`, run: ran }] }),
});
const catalog = [entry("dummy"), entry("drawing")];

const fresh = (): PluginInfo[] => [
  { id: "dummy", name: "Dummy", summary: "A plugin with nothing to download.", version: "1", defaultOn: false, scope: "vault", payload: null, enabled: false },
  { id: "drawing", name: "Drawing", summary: "Draw things.", version: "1", defaultOn: true, scope: "vault", payload: { label: "Editor", version: "1", sizeBytes: 48_000_000 }, enabled: false },
  { id: "web", name: "Web", summary: "Open pages.", version: "1", defaultOn: false, scope: "computer", payload: null, enabled: true },
];
let list = fresh();
const turnedOn = (id: string) => (list.find((p) => p.id === id)!.enabled = true);

let emit: (event: PayloadEvent) => void = () => {};
let backend: PluginsBackend;
let finishInstall: (value: string) => void;
let failInstall: (reason: Error) => void;

beforeEach(() => {
  ran.mockReset();
  list = fresh();
  usePlugins.setState({ enabled: [], loaded: {}, info: [], on: {}, payload: {}, problem: {} });
  backend = {
    list: vi.fn(async () => list.map((p) => ({ ...p }))),
    setEnabled: vi.fn(async () => true),
    status: vi.fn(async (id: string) => ({ id, state: "idle" as const, installed: false, busy: false, version: "1", sizeBytes: 48_000_000 })),
    install: vi.fn(
      () =>
        new Promise<string>((resolve, reject) => {
          finishInstall = resolve;
          failInstall = reject;
        }),
    ),
    cancel: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    onPayload: vi.fn(async (handler) => {
      emit = handler;
      return () => {};
    }),
  };
  setPluginsBackend(backend);
});
afterEach(() => {
  cleanup();
  setPluginsBackend(null);
  usePlugins.setState({ enabled: [], loaded: {}, info: [], on: {}, payload: {}, problem: {} });
});

const open = async () => {
  render(<PluginsSettings catalog={catalog} />);
  await act(async () => {});
  await act(async () => {});
};
const card = (id: string) => within(document.querySelector<HTMLElement>(`[data-plugin="${id}"]`)!);

describe("the list", () => {
  it("is read from the app: a card per plugin, with its status, scope and download size", async () => {
    await open();
    expect(card("dummy").getByRole("status").textContent).toBe("Off");
    expect(card("drawing").getByText(/48 MB download/)).toBeTruthy();
    expect(card("web").getByText(/This computer/)).toBeTruthy();
    expect(card("web").getByRole("status").textContent).toBe("On");
    expect((card("web").getByRole("switch") as HTMLInputElement).checked).toBe(true);
    expect(usePlugins.getState().on).toEqual({ dummy: false, drawing: false, web: true });
  });

  it("says so, with a sentence, when there are no plugins", async () => {
    setPluginsBackend(null);
    render(<PluginsSettings catalog={[]} />);
    expect(screen.getByText(/No plugins yet/)).toBeTruthy();
  });

  it("loads what a plugin that is on contributes", async () => {
    turnedOn("dummy");
    await open();
    expect(commands().map((c) => c.id)).toEqual(["dummy-hello"]);
  });
});

describe("a switch", () => {
  it("is a real switch the keyboard reaches, and writes once", async () => {
    await open();
    const sw = card("dummy").getByRole("switch") as HTMLInputElement;
    expect(sw.tagName).toBe("INPUT");
    expect(sw.type).toBe("checkbox");
    expect(sw.tabIndex).toBeGreaterThanOrEqual(0);
    fireEvent.click(sw);
    await act(async () => {});
    expect(backend.setEnabled).toHaveBeenCalledTimes(1);
    expect(backend.setEnabled).toHaveBeenCalledWith("dummy", true);
    expect(backend.install).not.toHaveBeenCalled();
    expect(card("dummy").getByRole("status").textContent).toBe("On");
    expect(commands().map((c) => c.id)).toEqual(["dummy-hello"]);
  });

  it("turning off keeps the files and says so", async () => {
    await open();
    fireEvent.click(card("web").getByRole("switch"));
    await act(async () => {});
    expect(backend.setEnabled).toHaveBeenCalledWith("web", false);
    expect(card("web").getByRole("status").textContent).toBe("Off");
    expect(card("web").getByText("Your files stay; Web is off.")).toBeTruthy();
    expect(backend.remove).not.toHaveBeenCalled();
  });

  it("stays as it was, with a sentence, when the app refuses", async () => {
    backend.setEnabled = vi.fn(async () => {
      throw new Error("Open a vault first");
    });
    await open();
    fireEvent.click(card("dummy").getByRole("switch"));
    await act(async () => {});
    expect(card("dummy").getByRole("alert").textContent).toBe("Open a vault first");
    expect(card("dummy").getByRole("status").textContent).toBe("Off");
  });
});

describe("a download", () => {
  it("starts at once with the one click that turns the plugin on, tells its progress, and can be cancelled", async () => {
    await open();
    fireEvent.click(card("drawing").getByRole("switch"));
    await act(async () => {});
    expect(backend.setEnabled).toHaveBeenCalledWith("drawing", true);
    expect(backend.install).toHaveBeenCalledTimes(1);
    expect(card("drawing").getByRole("status").textContent).toBe("Downloading 0 %");

    act(() => emit({ id: "drawing", state: "downloading", done: 20_640_000, total: 48_000_000 }));
    expect(card("drawing").getByRole("status").textContent).toBe("Downloading 43 %");
    expect(card("drawing").getByRole("progressbar").getAttribute("aria-valuenow")).toBe("43");
    expect(card("drawing").getByText("21 MB of 48 MB")).toBeTruthy();

    fireEvent.click(card("drawing").getByRole("button", { name: "Cancel" }));
    expect(backend.cancel).toHaveBeenCalledWith("drawing");

    await act(async () => finishInstall("installed"));
    expect(card("drawing").getByRole("status").textContent).toBe("On");
    expect(card("drawing").getByRole("button", { name: "Remove download" })).toBeTruthy();
  });

  it("is cancelled when the plugin is turned off while it runs", async () => {
    await open();
    fireEvent.click(card("drawing").getByRole("switch"));
    await act(async () => {});
    expect(backend.install).toHaveBeenCalledTimes(1);
    fireEvent.click(card("drawing").getByRole("switch"));
    await act(async () => {});
    expect(backend.setEnabled).toHaveBeenLastCalledWith("drawing", false);
    expect(backend.cancel).toHaveBeenCalledWith("drawing");
  });

  it("is not undone by a list the app answers after the click (the old state)", async () => {
    await open();
    let answer: (list: PluginInfo[]) => void = () => {};
    const old = list.map((p) => ({ ...p }));
    backend.list = vi.fn(() => new Promise<PluginInfo[]>((resolve) => (answer = resolve)));
    const syncing = usePlugins.getState().sync(catalog);
    await usePlugins.getState().setEnabled("dummy", true, catalog);
    answer(old);
    await syncing;
    expect(usePlugins.getState().on.dummy).toBe(true);
    expect(usePlugins.getState().enabled).toContain("dummy");
  });

  it("offers Retry when it fails, and the sentence why", async () => {
    await open();
    fireEvent.click(card("drawing").getByRole("switch"));
    await act(async () => {});
    await act(async () => failInstall(new Error("KastenFlow could not reach GitHub")));
    expect(card("drawing").getByRole("status").textContent).toBe("Failed");
    expect(card("drawing").getByRole("alert").textContent).toContain("could not reach GitHub");
    fireEvent.click(card("drawing").getByRole("button", { name: "Retry" }));
    expect(backend.install).toHaveBeenCalledTimes(2);
    await act(async () => finishInstall("installed"));
    expect(card("drawing").getByRole("status").textContent).toBe("On");
  });

  it("a plugin that is on but not downloaded says it needs a download, and Remove forgets one", async () => {
    turnedOn("drawing");
    await open();
    expect(card("drawing").getByRole("status").textContent).toBe("Needs download");
    fireEvent.click(card("drawing").getByRole("button", { name: "Download" }));
    await act(async () => finishInstall("installed"));
    fireEvent.click(card("drawing").getByRole("button", { name: "Remove download" }));
    await act(async () => {});
    expect(backend.remove).toHaveBeenCalledWith("drawing");
    expect(card("drawing").getByRole("status").textContent).toBe("Needs download");
  });
});

describe("statusOf", () => {
  it("names each state", () => {
    expect(statusOf(false, true, undefined).text).toBe("Off");
    expect(statusOf(true, false, undefined).text).toBe("On");
    expect(statusOf(true, true, undefined).text).toBe("Needs download");
    expect(statusOf(true, true, { phase: "downloading", installed: false, done: 1, total: 4 }).text).toBe("Downloading 25 %");
    expect(statusOf(true, true, { phase: "failed", installed: false, done: 0, total: 0 }).text).toBe("Failed");
    expect(statusOf(true, true, { phase: "idle", installed: false, older: true, done: 0, total: 0 }).text).toBe("Update available");
    expect(statusOf(true, true, { phase: "ready", installed: true, older: false, done: 0, total: 0 }).text).toBe("On");
    expect(statusOf(false, true, { phase: "idle", installed: false, older: true, done: 0, total: 0 }).text).toBe("Off");
  });
});

describe("the palette", () => {
  it("offers Plugins: open settings, and Turn on / Turn off for each plugin", async () => {
    await open();
    const labels = () => allCommands().filter((c) => !c.when || c.when()).map((c) => c.label);
    expect(labels()).toContain("Plugins: open settings");
    expect(labels()).toContain("Turn on Dummy");
    expect(labels()).not.toContain("Turn off Dummy");
    expect(labels()).toContain("Turn off Web");

    const on = allCommands().find((c) => c.id === "plugin-on-dummy")!;
    await act(async () => on.run());
    expect(backend.setEnabled).toHaveBeenCalledWith("dummy", true);
    expect(labels()).toContain("Turn off Dummy");
    expect(labels()).not.toContain("Turn on Dummy");

    const off = allCommands().find((c) => c.id === "plugin-off-dummy")!;
    await act(async () => off.run());
    expect(backend.setEnabled).toHaveBeenCalledWith("dummy", false);
    expect(labels()).toContain("Turn on Dummy");
  });

  it("says a download has started when a plugin that needs one is turned on from the palette", async () => {
    await open();
    useWorkspace.setState({ toasts: [] });
    const on = allCommands().find((c) => c.id === "plugin-on-drawing")!;
    await act(async () => on.run());
    expect(useWorkspace.getState().toasts.map((t) => t.text)).toContain("Downloading Drawing…");
    await act(async () => finishInstall("installed"));
    expect(useWorkspace.getState().toasts.map((t) => t.text)).toContain("Drawing is on");
  });

  it("says nothing extra when a plugin without a download is turned on", async () => {
    await open();
    useWorkspace.setState({ toasts: [] });
    await act(async () => allCommands().find((c) => c.id === "plugin-on-dummy")!.run());
    expect(useWorkspace.getState().toasts).toHaveLength(0);
  });
});
