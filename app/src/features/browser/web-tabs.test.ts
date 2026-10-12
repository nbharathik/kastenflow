import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { tabFace } from "../../shell/TabStrip";
import { useWorkspace } from "../workspace/store";
import { derive } from "../workspace/store-layout";
import { currentTab, initialLayout, opensOwnTab, openTab, samePlace, setWebUrl, split, type Layout, type Place } from "../workspace/tabs";
import { setBrowserBackend } from "./backend";
import { openInBrowserTab } from "./open";
import { useWebTitles, webTitle } from "./titles";
import type { BrowserBackend } from "./types";
import { handleEvent, urlOf, useWebTabs, webTabIds } from "./web-state";

const web = (url?: string): Place => (url ? { view: "web", url } : { view: "web" });

function show(layout: Layout) {
  useWorkspace.setState(derive(layout));
}

beforeEach(() => {
  localStorage.clear();
  show(initialLayout({ view: "home" }));
  useWebTabs.setState({ tabs: {} });
  useWebTitles.setState({ titles: {} });
});

afterEach(() => {
  setBrowserBackend(null);
  vi.restoreAllMocks();
});

describe("a web place in the tabs", () => {
  it("is told apart by its address, so two pages in two tabs are two places", () => {
    expect(samePlace(web("https://a.example/"), web("https://a.example/"))).toBe(true);
    expect(samePlace(web("https://a.example/"), web("https://b.example/"))).toBe(false);
    expect(samePlace(web(), web())).toBe(true);
    expect(samePlace(web(), { view: "home" })).toBe(false);
    // Going to a web page from a page opens in the tab already there, a start page does not need a tab of its own.
    expect(opensOwnTab({ view: "page", path: "a.md" }, web("https://a.example/"))).toBe(true);
    expect(opensOwnTab({ view: "home" }, web())).toBe(false);
  });

  it("follows a page that moved without a step in the tab's way back", () => {
    const layout = openTab(initialLayout({ view: "home" }), web("https://a.example/"));
    const tab = currentTab(layout);
    const moved = setWebUrl(layout, tab.id, "https://a.example/next");
    expect(currentTab(moved).place).toEqual(web("https://a.example/next"));
    expect(currentTab(moved).back).toEqual(currentTab(layout).back);
    // The same address, a tab that is not a browser tab, and a tab that is not there change nothing.
    expect(setWebUrl(moved, tab.id, "https://a.example/next")).toBe(moved);
    const plain = initialLayout({ view: "home" });
    expect(setWebUrl(plain, currentTab(plain).id, "https://x.example/")).toBe(plain);
    expect(setWebUrl(moved, "nope", "https://x.example/")).toBe(moved);
  });

  it("is kept by the workspace store and saved with the layout", () => {
    show(openTab(initialLayout({ view: "home" }), web("https://a.example/")));
    const id = useWorkspace.getState().layout.panes[0]!.active;
    useWorkspace.getState().setWebUrl(id, "https://a.example/two");
    expect(useWorkspace.getState().place).toEqual(web("https://a.example/two"));
    expect(JSON.parse(localStorage.getItem("kasten.layout")!).layout.panes[0].tabs.at(-1).place.url).toBe("https://a.example/two");
    expect(urlOf(id)).toBe("https://a.example/two");
    expect(webTabIds().has(id)).toBe(true);
    expect(urlOf("nope")).toBeUndefined();
  });
});

describe("a browser tab's face", () => {
  it("is named by its page, else its site, else Browser", () => {
    expect(tabFace(web(), [])).toMatchObject({ icon: "icon:globe", title: "Browser" });
    expect(tabFace(web("https://www.example.com/a"), []).title).toBe("example.com");
    useWebTitles.getState().keep("https://www.example.com/a", "  How   smart notes\nwork ");
    expect(tabFace(web("https://www.example.com/a"), [])).toEqual({ icon: "icon:globe", title: "How smart notes work", where: "https://www.example.com/a" });
    expect(webTitle("https://other.example/", {})).toBe("other.example");
  });

  it("keeps the latest titles only, once each", () => {
    for (let n = 0; n < 230; n++) useWebTitles.getState().keep(`https://e.example/${n}`, `T${n}`);
    const titles = useWebTitles.getState().titles;
    expect(Object.keys(titles)).toHaveLength(200);
    expect(titles["https://e.example/0"]).toBeUndefined();
    expect(titles["https://e.example/229"]).toBe("T229");
    useWebTitles.getState().keep("https://e.example/229", "T229");
    useWebTitles.getState().keep("", "nothing");
    useWebTitles.getState().keep("https://e.example/x", "   ");
    expect(Object.keys(useWebTitles.getState().titles)).toHaveLength(200);
  });
});

describe("what a page does", () => {
  it("moves its tab's address, names the tab and shows loading", () => {
    show(openTab(initialLayout({ view: "home" }), web("https://a.example/")));
    const id = useWorkspace.getState().layout.panes[0]!.active;
    handleEvent({ id, kind: "loading", loading: true, url: "https://a.example/start" });
    expect(useWebTabs.getState().tabs[id]).toEqual({ loading: true, live: false });
    expect(useWorkspace.getState().place.url).toBe("https://a.example/start");
    handleEvent({ id, kind: "title", title: "A page", url: "https://a.example/start" });
    expect(useWebTitles.getState().titles["https://a.example/start"]).toBe("A page");
    // A title with no address belongs to the address the tab is at.
    handleEvent({ id, kind: "title", title: "Later title" });
    expect(useWebTitles.getState().titles["https://a.example/start"]).toBe("Later title");
    handleEvent({ id, kind: "loading", loading: false });
    expect(useWebTabs.getState().tabs[id]!.loading).toBe(false);
    useWebTabs.getState().patch(id, { live: true });
    handleEvent({ id, kind: "closed" });
    expect(useWebTabs.getState().tabs[id]).toEqual({ loading: false, live: false });
  });

  it("offers the system's browser for a download it refused", () => {
    const toast = vi.spyOn(useWorkspace.getState(), "toast");
    handleEvent({ id: "t1", kind: "download", url: "https://a.example/file.zip" });
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0]![1]!.label).toBe("Open in your browser");
  });
});

describe("opening an address in a browser tab to the right", () => {
  const fake = (): BrowserBackend & { navs: unknown[] } => {
    const navs: unknown[] = [];
    const none = () => Promise.resolve();
    return {
      available: true,
      navs,
      enabled: () => Promise.resolve(true),
      setEnabled: () => Promise.resolve(true),
      open: () => Promise.resolve(""),
      bounds: none,
      hide: none,
      show: none,
      close: none,
      nav: (id, nav) => {
        navs.push([id, nav]);
        return Promise.resolve();
      },
      capture: () => Promise.reject(new Error("no")),
      confirm: () => Promise.reject(new Error("no")),
      discard: none,
      clearData: none,
      onEvent: () => Promise.resolve(() => {}),
    };
  };

  it("splits when there is no pane to the right", () => {
    show(initialLayout({ view: "page", path: "a.md" }));
    openInBrowserTab("https://a.example/");
    const { panes, focus } = useWorkspace.getState().layout;
    expect(panes).toHaveLength(2);
    expect(panes[1]!.tabs[0]!.place).toEqual(web("https://a.example/"));
    expect(focus).toBe(panes[1]!.id);
    expect(panes[0]!.tabs[0]!.place).toEqual({ view: "page", path: "a.md" });
  });

  it("goes into the browser tab already to the right: its view navigates when it is alive, else its place does", () => {
    const backend = fake();
    setBrowserBackend(backend);
    const base = split(initialLayout({ view: "page", path: "a.md" }), web("https://one.example/"));
    show({ ...base, focus: base.panes[0]!.id });
    const tab = base.panes[1]!.tabs[0]!;
    openInBrowserTab("https://two.example/");
    expect(useWorkspace.getState().place.url).toBe("https://two.example/");
    expect(backend.navs).toEqual([]);
    show({ ...useWorkspace.getState().layout, focus: base.panes[0]!.id });
    useWebTabs.getState().patch(tab.id, { live: true });
    openInBrowserTab("https://three.example/");
    expect(backend.navs).toEqual([[tab.id, { action: "url", url: "https://three.example/" }]]);
    expect(useWorkspace.getState().layout.panes).toHaveLength(2);
  });

  it("makes a new tab in a pane to the right that shows something else, and leaves its page alone", () => {
    const base = split(initialLayout({ view: "page", path: "a.md" }), { view: "page", path: "b.md" });
    show({ ...base, focus: base.panes[0]!.id });
    openInBrowserTab("https://a.example/");
    const right = useWorkspace.getState().layout.panes[1]!;
    expect(right.tabs.map((t) => t.place)).toEqual([{ view: "page", path: "b.md" }, web("https://a.example/")]);
    expect(useWorkspace.getState().layout.focus).toBe(right.id);
  });
});
