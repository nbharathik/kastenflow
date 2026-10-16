import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NewTabButton } from "../../shell/NewTab";
import { COMMANDS } from "../workspace/overlays/commands";
import { useWorkspace } from "../workspace/store";
import { derive } from "../workspace/store-layout";
import { initialLayout, openTab, type Layout } from "../workspace/tabs";
import { setBrowserBackend } from "./backend";
import { BrowserBar } from "./BrowserBar";
import { BrowserView } from "./BrowserView";
import { openWebTab, takeAddressFocus } from "./commands";
import { useOcclusion } from "./occlusion";
import { resetBrowserPrefs, useBrowserPrefs } from "./prefs";
import type { BrowserBackend } from "./types";
import { useWebTabs } from "./web-state";

/** A backend that can show pages and does nothing when asked. */
const idle: BrowserBackend = {
  available: true,
  enabled: () => Promise.resolve(true),
  setEnabled: (on) => Promise.resolve(on),
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
};

const show =(layout: Layout) => useWorkspace.setState({ ...derive(layout), client: {} as never, notes: [], toasts: [] });
const tabs = () => useWorkspace.getState().layout.panes.flatMap((p) => p.tabs.map((t) => t.place));
const run = (id: string) => COMMANDS.find((c) => c.id === id)!.run();

beforeEach(() => {
  localStorage.clear();
  useOcclusion.setState({ holds: {}, areas: {} });
  useWebTabs.setState({ tabs: {} });
  resetBrowserPrefs();
  useBrowserPrefs.setState({ enabled: true, known: true });
  setBrowserBackend(idle);
  takeAddressFocus();
});

afterEach(() => {
  cleanup();
  setBrowserBackend(null);
  vi.useRealTimers();
});

/** What a pane shows: the place of its tab in front. */
function Harness() {
  const place = useWorkspace((s) => s.place);
  return <BrowserView place={place} />;
}

describe("the browser bar's New web tab button", () => {
  it("is named, and tells the window when it is pressed", () => {
    const onNewTab = vi.fn();
    const props = { url: "https://example.com/", loading: false, live: true, fullScreen: false, address: { current: null }, target: { kind: "inbox" as const }, reading: false };
    render(<BrowserBar {...props} onGo={() => {}} onNav={() => {}} onNewTab={onNewTab} onFull={() => {}} onSystem={() => {}} onCapture={() => {}} onSendTo={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "New web tab" }));
    expect(onNewTab).toHaveBeenCalledTimes(1);
  });

  it("opens a browser tab on its start page and puts the cursor in its address box", async () => {
    show(openTab(initialLayout({ view: "home" }), { view: "web", url: "https://example.com/" }));
    render(<Harness />);
    expect(tabs()).toEqual([{ view: "home" }, { view: "web", url: "https://example.com/" }]);
    fireEvent.click(screen.getByRole("button", { name: "New web tab" }));
    expect(tabs()).toEqual([{ view: "home" }, { view: "web", url: "https://example.com/" }, { view: "web" }]);
    // The start page is in front now, and the address box has the cursor.
    await waitFor(() => expect(screen.getByRole("heading", { name: "Browser" })).toBeTruthy());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Address or search")));
  });
});

describe("Ctrl+T and the tab strip's plus", () => {
  it("make a browser tab beside a browser tab, and a Home tab anywhere else", () => {
    show(openTab(initialLayout({ view: "home" }), { view: "web", url: "https://example.com/" }));
    run("new-tab");
    expect(tabs().at(-1)).toEqual({ view: "web" });
    expect(tabs()).toHaveLength(3);
    show(initialLayout({ view: "page", path: "a.md" }));
    run("new-tab");
    expect(tabs()).toEqual([{ view: "page", path: "a.md" }, { view: "home" }]);
  });

  it("do the same from the plus", () => {
    show(openTab(initialLayout({ view: "home" }), { view: "web", url: "https://example.com/" }));
    render(<NewTabButton />);
    fireEvent.click(screen.getByRole("button", { name: "New tab" }));
    expect(tabs()).toEqual([{ view: "home" }, { view: "web", url: "https://example.com/" }, { view: "web" }]);
    show(initialLayout({ view: "page", path: "a.md" }));
    fireEvent.click(screen.getByRole("button", { name: "New tab" }));
    expect(tabs()).toEqual([{ view: "page", path: "a.md" }, { view: "home" }]);
  });

  it("show the start page that is already in front again rather than make a second, and ask it for the cursor", () => {
    show(openTab(initialLayout({ view: "home" }), { view: "web" }));
    const asked = vi.fn();
    window.addEventListener("kasten:browser", asked);
    run("new-tab");
    window.removeEventListener("kasten:browser", asked);
    expect(tabs()).toEqual([{ view: "home" }, { view: "web" }]);
    expect((asked.mock.calls[0]![0] as CustomEvent).detail).toBe("address");
    // Nothing is left over for a later tab to take.
    expect(takeAddressFocus()).toBe(false);
  });
});

describe("the cursor in a new browser tab", () => {
  it("is asked for once, only by a tab just made, and not later", () => {
    expect(takeAddressFocus()).toBe(false);
    show(openTab(initialLayout({ view: "home" }), { view: "web", url: "https://example.com/" }));
    openWebTab();
    expect(takeAddressFocus()).toBe(true);
    expect(takeAddressFocus()).toBe(false);
    vi.useFakeTimers();
    show(openTab(initialLayout({ view: "home" }), { view: "web", url: "https://example.com/" }));
    openWebTab();
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    // A blank browser tab restored at start must not take the cursor.
    expect(takeAddressFocus()).toBe(false);
  });
});
