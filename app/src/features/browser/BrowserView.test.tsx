import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspace } from "../workspace/store";
import { derive } from "../workspace/store-layout";
import { initialLayout, openTab } from "../workspace/tabs";
import { setBrowserBackend } from "./backend";
import { BrowserView } from "./BrowserView";
import { useOcclusion } from "./occlusion";
import { resetBrowserPrefs, useBrowserPrefs } from "./prefs";
import { useWebTabs } from "./web-state";
import type { BrowserBackend, Previewed } from "./types";

const URL = "https://example.com/guide";
const PREVIEW: Previewed = { token: "tok-1", kind: "selection", url: URL, title: "Slip-box basics", site: "example.com", excerpt: "One idea per note.", bytes: 20 };

function rig() {
  const calls: unknown[][] = [];
  const log = (...call: unknown[]) => {
    calls.push(call);
    return Promise.resolve();
  };
  const backend: BrowserBackend = {
    available: true,
    enabled: () => Promise.resolve(true),
    setEnabled: (on) => Promise.resolve(on),
    open: (id, url, bounds) => log("open", id, url, bounds).then(() => url),
    bounds: (id, bounds) => log("bounds", id, bounds),
    hide: (id) => log("hide", id),
    show: (id) => log("show", id),
    close: (id) => log("close", id),
    nav: (id, nav) => log("nav", id, nav),
    capture: (id, kind) => log("capture", id, kind).then(() => PREVIEW),
    confirm: (token, where, title) => log("confirm", token, where, title).then(() => ({ path: "inbox/slip-box-basics.md", title: "Slip-box basics", place: "Inbox" })),
    discard: (token) => log("discard", token),
    clearData: () => log("clear"),
    onEvent: () => Promise.resolve(() => {}),
  };
  return { backend, calls, of: (name: string) => calls.filter((c) => c[0] === name) };
}

function stage(left = 10, top = 100, right = 810, bottom = 600) {
  const zero = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) };
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("kasten-browser-stage") ? { ...zero, left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top } : zero;
  });
}

function show(url?: string) {
  const layout = openTab(initialLayout({ view: "home" }), url ? { view: "web", url } : { view: "web" });
  useWorkspace.setState({ ...derive(layout), client: {} as never, notes: [], toasts: [] });
  return layout.panes[0]!.active;
}

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, "devicePixelRatio", { value: 1.5, configurable: true });
  useOcclusion.setState({ holds: {}, areas: {} });
  useWebTabs.setState({ tabs: {} });
  resetBrowserPrefs();
  useBrowserPrefs.setState({ enabled: true, known: true });
});

afterEach(() => {
  cleanup();
  setBrowserBackend(null);
  vi.restoreAllMocks();
});

describe("the browser tab", () => {
  it("shows its page by laying the native view over the stage, in physical pixels, once the stage is measured", async () => {
    const { backend, of } = rig();
    setBrowserBackend(backend);
    stage();
    const id = show(URL);
    render(<BrowserView place={{ view: "web", url: URL }} />);
    await waitFor(() => expect(of("open")).toHaveLength(1));
    // 10..810 by 100..600 CSS pixels at 1.5 physical pixels each.
    expect(of("open")[0]).toEqual(["open", id, URL, { x: 15, y: 150, width: 1200, height: 750 }]);
    await waitFor(() => expect(useWebTabs.getState().tabs[id]?.live).toBe(true));
  });

  it("hides the page while something is open over it, and shows it again after", async () => {
    const { backend, of } = rig();
    setBrowserBackend(backend);
    stage();
    const id = show(URL);
    render(<BrowserView place={{ view: "web", url: URL }} />);
    await waitFor(() => expect(useWebTabs.getState().tabs[id]?.live).toBe(true));
    // A menu away from the page changes nothing.
    act(() => useOcclusion.getState().hold("menu", { left: 900, top: 0, right: 1000, bottom: 50 }));
    expect(of("hide")).toHaveLength(0);
    // One over it hides the view, and the stage says why.
    act(() => useOcclusion.getState().hold("dialog", "all"));
    await waitFor(() => expect(of("hide")).toEqual([["hide", id]]));
    expect(screen.getByText("Hidden while something is open over it.")).toBeTruthy();
    act(() => useOcclusion.getState().release("dialog"));
    await waitFor(() => expect(of("open")).toHaveLength(2));
    expect(screen.queryByText("Hidden while something is open over it.")).toBeNull();
    // The view is only hidden when the tab is shown no more, never closed here.
    cleanup();
    await waitFor(() => expect(of("hide")).toHaveLength(2));
    expect(of("close").filter((c) => c[1] === id)).toHaveLength(0);
    // It closes with its tab: once the tab is gone from the layout.
    useWorkspace.getState().closeTab();
    await waitFor(() => expect(of("close").filter((c) => c[1] === id)).toHaveLength(1));
  });

  it("goes where the address box says, or searches, and refuses what the app would", async () => {
    const { backend, of } = rig();
    setBrowserBackend(backend);
    stage();
    const id = show(URL);
    render(<BrowserView place={{ view: "web", url: URL }} />);
    await waitFor(() => expect(useWebTabs.getState().tabs[id]?.live).toBe(true));
    const box = screen.getByLabelText("Address or search");
    fireEvent.change(box, { target: { value: "smart notes" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(of("nav")).toHaveLength(1));
    expect(of("nav")[0]).toEqual(["nav", id, { action: "url", url: "https://www.google.com/search?q=smart%20notes" }]);
    fireEvent.change(box, { target: { value: "file:///C:/Windows/win.ini" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(screen.getByRole("alert").textContent).toBe("The browser opens web pages only");
    expect(of("nav")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    await waitFor(() => expect(of("nav")).toHaveLength(3));
    expect(of("nav").slice(1).map((c) => c[2])).toEqual([{ action: "back" }, { action: "reload" }]);
  });

  it("holds a capture for the person to see, writes it only on Save, and says where it went", async () => {
    const { backend, of } = rig();
    setBrowserBackend(backend);
    stage();
    const id = show(URL);
    render(<BrowserView place={{ view: "web", url: URL }} />);
    await waitFor(() => expect(useWebTabs.getState().tabs[id]?.live).toBe(true));
    // The two captures are icons: the words are their names and tooltips.
    for (const name of ["Capture page", "Capture selection"]) {
      const button = screen.getByRole("button", { name });
      expect(button.textContent, name).toBe("");
      expect(button.title, name).toContain(name);
    }
    fireEvent.click(screen.getByRole("button", { name: "Capture selection" }));
    const panel = await screen.findByRole("region", { name: "Capture" });
    expect(of("capture")).toEqual([["capture", id, "selection"]]);
    expect(within(panel).getByText("One idea per note.")).toBeTruthy();
    expect(within(panel).getByText(/Selection from example\.com/)).toBeTruthy();
    // Nothing is written yet.
    expect(of("confirm")).toHaveLength(0);
    fireEvent.change(within(panel).getByLabelText("Title"), { target: { value: "My title" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(of("confirm")).toHaveLength(1));
    expect(of("confirm")[0]).toEqual(["confirm", "tok-1", { kind: "inbox" }, "My title"]);
    await waitFor(() => expect(screen.queryByRole("region", { name: "Capture" })).toBeNull());
    expect(useWorkspace.getState().toasts.map((t) => t.text)).toEqual(["Kept in Inbox"]);
    expect(of("discard")).toHaveLength(0);
    expect(localStorage.getItem("kasten.capture.recent")).toContain("inbox");
  });

  it("lets go of a capture that is discarded, and shows why one could not be made", async () => {
    const { backend, of } = rig();
    setBrowserBackend(backend);
    stage();
    const id = show(URL);
    render(<BrowserView place={{ view: "web", url: URL }} />);
    await waitFor(() => expect(useWebTabs.getState().tabs[id]?.live).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Capture page" }));
    const panel = await screen.findByRole("region", { name: "Capture" });
    fireEvent.click(await within(panel).findByRole("button", { name: "Discard" }));
    expect(of("discard")).toEqual([["discard", "tok-1"]]);
    expect(screen.queryByRole("region", { name: "Capture" })).toBeNull();
    backend.capture = () => Promise.reject(new Error("Select some text on the page first"));
    fireEvent.click(screen.getByRole("button", { name: "Capture selection" }));
    expect((await screen.findByText("Select some text on the page first")).getAttribute("role")).toBe("alert");
  });

  it("offers where a capture goes with the capture window's picker, and keeps the choice", async () => {
    const { backend, of } = rig();
    setBrowserBackend(backend);
    stage();
    const id = show(URL);
    useWorkspace.setState({ notes: [{ path: "projects/trip/_project.md", kind: "project", project: "trip", title: "Trip plan", tags: [], modified: 1 } as never] });
    render(<BrowserView place={{ view: "web", url: URL }} />);
    await waitFor(() => expect(useWebTabs.getState().tabs[id]?.live).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Capture selection" }));
    const panel = await screen.findByRole("region", { name: "Capture" });
    fireEvent.click(within(panel).getByRole("button", { name: /Send to: Inbox/ }));
    fireEvent.click(await screen.findByRole("option", { name: /Trip plan/ }));
    fireEvent.click(within(panel).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(of("confirm")).toHaveLength(1));
    expect(of("confirm")[0]![2]).toEqual({ kind: "project", project: "trip" });
  });

  describe("a page that is already saved", () => {
    const SAVED = { path: "inbox/slip-box-basics.md", title: "Slip-box basics", captured: "2026-09-01" };
    const again = async () => {
      const { backend } = rig();
      const confirmed: unknown[][] = [];
      backend.capture = () => Promise.resolve({ ...PREVIEW, kind: "page", existing: [SAVED] });
      backend.confirm = (token, where, title, snapshot) => {
        confirmed.push([token, where, title, snapshot]);
        return Promise.resolve({ path: "inbox/slip-box-basics-2.md", title: "Slip-box basics", place: "Inbox" });
      };
      setBrowserBackend(backend);
      stage();
      const id = show(URL);
      render(<BrowserView place={{ view: "web", url: URL }} />);
      await waitFor(() => expect(useWebTabs.getState().tabs[id]?.live).toBe(true));
      fireEvent.click(screen.getByRole("button", { name: "Capture page" }));
      return { panel: await screen.findByRole("region", { name: "Capture" }), confirmed };
    };

    it("says so with the day, opens the first card, and writes a snapshot only on request", async () => {
      const { panel, confirmed } = await again();
      const saved = within(panel).getByRole("status", { name: "Already saved" });
      expect(saved.textContent).toBe("Already saved on 2026-09-01·Open·Save another snapshot");
      // A plain Save would make a second copy, so it is not offered; Ctrl+Enter does nothing either.
      expect(within(panel).queryByRole("button", { name: "Save" })).toBeNull();
      fireEvent.keyDown(within(panel).getByLabelText("Title"), { key: "Enter", ctrlKey: true });
      const openPath = vi.fn();
      useWorkspace.setState({ openPath });
      fireEvent.click(within(saved).getByRole("button", { name: "Open" }));
      expect(openPath).toHaveBeenCalledWith("inbox/slip-box-basics.md", "tab");
      expect(confirmed).toEqual([]);
      fireEvent.click(within(saved).getByRole("button", { name: "Save another snapshot" }));
      await waitFor(() => expect(confirmed).toHaveLength(1));
      expect(confirmed[0]).toEqual(["tok-1", { kind: "inbox" }, "Slip-box basics", true]);
      await waitFor(() => expect(screen.queryByRole("region", { name: "Capture" })).toBeNull());
    });

    it("holds nothing back from a quote added to a page", async () => {
      const { panel, confirmed } = await again();
      act(() => useWorkspace.setState({ notes: [{ path: "library/essay.md", kind: "page", title: "Essay", tags: [], modified: 1 } as never] }));
      fireEvent.click(within(panel).getByRole("button", { name: /Send to: Inbox/ }));
      // Pages are found by typing part of a title.
      fireEvent.change(await within(panel).findByRole("combobox"), { target: { value: "Ess" } });
      fireEvent.click(await screen.findByRole("option", { name: /Essay/ }));
      expect(within(panel).queryByRole("status", { name: "Already saved" })).toBeNull();
      fireEvent.click(within(panel).getByRole("button", { name: "Save" }));
      await waitFor(() => expect(confirmed).toHaveLength(1));
      expect(confirmed[0]).toEqual(["tok-1", { kind: "page", path: "library/essay.md" }, "Slip-box basics", false]);
    });
  });

  it("says it is off, with a way to Settings, and shows no page", () => {
    const { backend, of } = rig();
    setBrowserBackend(backend);
    stage();
    show(URL);
    useBrowserPrefs.setState({ enabled: false, known: true });
    render(<BrowserView place={{ view: "web", url: URL }} />);
    expect(screen.getByText("The browser is off")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Browser settings" })).toBeTruthy();
    expect(of("open")).toHaveLength(0);
  });

  it("starts at a page of favourites, and goes to one on a click", () => {
    const { backend, of } = rig();
    setBrowserBackend(backend);
    stage();
    show();
    useBrowserPrefs.setState({ favourites: [{ title: "Rust docs", url: "https://doc.rust-lang.org/" }] });
    render(<BrowserView place={{ view: "web" }} />);
    expect(of("open")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Rust docs" }));
    expect(useWorkspace.getState().place.url).toBe("https://doc.rust-lang.org/");
  });

  it("needs the desktop app where there is no native view", () => {
    stage();
    show(URL);
    render(<BrowserView place={{ view: "web", url: URL }} />);
    expect(screen.getByText("The browser needs the desktop app")).toBeTruthy();
  });
});
