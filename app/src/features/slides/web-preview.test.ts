import type { PreviewPlace, WebPreviewEvent, WebPreviewHandle } from "@kasten-slides/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openUrl } from "../../lib/api";
import { useOcclusion } from "../browser/occlusion";
import { holdForShow } from "../browser/show";
import { setPreviewBackend, type PreviewBackend } from "../browser/preview-backend";
import { sendPreviewSignal } from "../browser/preview-events";
import { resetBrowserPrefs, useBrowserPrefs } from "../browser/prefs";
import { useWorkspace } from "../workspace/store";
import { derive } from "../workspace/store-layout";
import { initialLayout } from "../workspace/tabs";
import { webPreviewHost } from "./web-preview";

vi.mock("../../lib/api", async (original) => ({ ...(await original<typeof import("../../lib/api")>()), openUrl: vi.fn(() => Promise.resolve()) }));

const URL = "https://example.com/talk";
const place = (x = 100, y = 50, w = 400, h = 300): PreviewPlace => ({ mode: "side", rect: { x, y, w, h } });

function rig(options: { available?: boolean; openFails?: string } = {}) {
  const calls: unknown[][] = [];
  const log = (...call: unknown[]) => {
    calls.push(call);
    return Promise.resolve();
  };
  const backend: PreviewBackend = {
    available: options.available ?? true,
    open: (url, bounds) => {
      calls.push(["open", url, bounds]);
      return options.openFails ? Promise.reject(new Error(options.openFails)) : Promise.resolve(url);
    },
    bounds: (b) => log("bounds", b),
    nav: (n) => log("nav", n),
    hide: () => log("hide"),
    show: () => log("show"),
    close: () => log("close"),
    childFocus: (on) => log("childFocus", on),
    onChildKey: () => Promise.resolve(() => {}),
  };
  return { backend, calls, of: (name: string) => calls.filter((c) => c[0] === name) };
}

/** Opens a preview and listens to what it says. */
async function opened(r: ReturnType<typeof rig>, at = place()) {
  setPreviewBackend(r.backend);
  const handle = (await webPreviewHost().open(URL, at)) as WebPreviewHandle;
  const heard: WebPreviewEvent[] = [];
  const stop = handle.subscribe((event) => heard.push(event));
  return { handle, heard, stop, last: () => heard.at(-1) };
}

const sleep =(ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, "devicePixelRatio", { value: 1.5, configurable: true });
  resetBrowserPrefs();
  useBrowserPrefs.setState({ enabled: true, known: true });
  useOcclusion.setState({ holds: {}, areas: {} });
  useWorkspace.setState({ ...derive(initialLayout({ view: "home" })), client: {} as never, notes: [], toasts: [] });
  vi.mocked(openUrl).mockClear();
});

afterEach(async () => {
  // Whatever a test left open goes, so the next one starts with none.
  const r = rig();
  setPreviewBackend(r.backend);
  const handle = await webPreviewHost().open(URL, place());
  handle?.close();
  await sleep();
  setPreviewBackend(null);
  vi.restoreAllMocks();
});

describe("when there is a preview", () => {
  it("is not offered where there is no native view, nor with the browser off", async () => {
    setPreviewBackend(rig({ available: false }).backend);
    expect(await webPreviewHost().open(URL, place())).toBeNull();
    const { backend, of } = rig();
    setPreviewBackend(backend);
    useBrowserPrefs.setState({ enabled: false, known: true });
    expect(await webPreviewHost().open(URL, place())).toBeNull();
    expect(of("open")).toEqual([]);
  });

  it("offers to switch the browser on, in Settings", () => {
    const host = webPreviewHost();
    host.turnOn?.();
    expect(useWorkspace.getState().place.view).toBe("settings");
  });
});

describe("opening the preview", () => {
  it("lays the native view over the editor's box, in physical pixels, and says it is loading", async () => {
    const r = rig();
    const { handle, heard } = await opened(r);
    // 100, 50, 400 by 300 CSS pixels at 1.5 physical pixels each.
    expect(r.of("open")).toEqual([["open", URL, { x: 150, y: 75, width: 600, height: 450 }]]);
    expect(heard[0]).toEqual({ type: "state", state: { url: URL, title: null, status: "loading" } });
    // The area the view is over is told to what keeps clear of it.
    expect(useOcclusion.getState().areas["web-preview"]).toEqual({ left: 100, top: 50, right: 500, bottom: 350 });
    handle.close();
  });

  it("follows the page: loaded, titled, moved by a redirect or a link", async () => {
    const r = rig();
    const { handle, last } = await opened(r);
    sendPreviewSignal({ type: "page", event: { id: "preview", kind: "loading", loading: false, url: "https://example.com/talk" } });
    expect(last()).toEqual({ type: "state", state: { url: URL, title: null, status: "ready" } });
    sendPreviewSignal({ type: "page", event: { id: "preview", kind: "title", title: "The talk", url: URL } });
    expect(last()).toMatchObject({ state: { title: "The talk" } });
    sendPreviewSignal({ type: "page", event: { id: "preview", kind: "loading", loading: true, url: "https://example.com/redirected" } });
    expect(last()).toMatchObject({ state: { url: "https://example.com/redirected", status: "loading" } });
    // A page that already said all of it is not told twice.
    const count = vi.fn();
    handle.subscribe(count);
    count.mockClear();
    sendPreviewSignal({ type: "page", event: { id: "preview", kind: "title", title: "Another page" } });
    sendPreviewSignal({ type: "page", event: { id: "preview", kind: "title", title: "Another page" } });
    expect(count).toHaveBeenCalledTimes(1);
    handle.close();
  });

  it("passes a link that wants a new window to the preview itself, as there is only the one", async () => {
    const r = rig();
    const { handle } = await opened(r);
    sendPreviewSignal({ type: "page", event: { id: "preview", kind: "new-tab", url: "https://example.com/other" } });
    await vi.waitFor(() => expect(r.of("nav")).toEqual([["nav", { action: "url", url: "https://example.com/other" }]]));
    handle.close();
  });

  it("hears the Escape its native view had the keyboard for", async () => {
    const r = rig();
    const { handle, heard } = await opened(r);
    sendPreviewSignal({ type: "key", key: "Escape" });
    expect(heard.at(-1)).toEqual({ type: "key", key: "Escape" });
    handle.close();
  });
});

describe("placing the view", () => {
  it("sends the physical rectangle again when only the screen's density changed (the box did not move), so the bounds are never stale", async () => {
    const r = rig();
    const { handle } = await opened(r);
    // The window went to a screen with twice the density: the same CSS box is a larger physical one.
    Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });
    handle.place(place(100, 50, 400, 300));
    await vi.waitFor(() => expect(r.of("bounds")).toEqual([["bounds", { x: 200, y: 100, width: 800, height: 600 }]]));
    handle.close();
  });

  it("sends the new rectangle only when it changed", async () => {
    const r = rig();
    const { handle } = await opened(r);
    handle.place(place(100, 50, 400, 300));
    await sleep();
    expect(r.of("bounds")).toEqual([]);
    handle.place(place(120, 50, 380, 300));
    await vi.waitFor(() => expect(r.of("bounds")).toEqual([["bounds", { x: 180, y: 75, width: 570, height: 450 }]]));
    handle.place(place(120, 50, 380, 300));
    await sleep();
    expect(r.of("bounds")).toHaveLength(1);
    handle.close();
  });

  it("steps aside for a menu or dialog over it, and not for one away from it", async () => {
    const r = rig();
    const { handle } = await opened(r);
    useOcclusion.getState().hold("menu", { left: 900, top: 0, right: 1000, bottom: 50 });
    await sleep();
    expect(r.of("hide")).toEqual([]);
    useOcclusion.getState().hold("dialog", "all");
    await vi.waitFor(() => expect(r.of("hide")).toHaveLength(1));
    // Told to what keeps clear: the view is not over that area now.
    expect(useOcclusion.getState().areas["web-preview"]).toBeUndefined();
    useOcclusion.getState().release("dialog");
    await vi.waitFor(() => expect(r.of("show")).toHaveLength(1));
    expect(useOcclusion.getState().areas["web-preview"]).toBeDefined();
    handle.close();
  });

  it("stays in view while a show holds the window, since the show is what it is the peek of, and still steps aside for a menu", async () => {
    const r = rig();
    const { handle } = await opened(r);
    const done = holdForShow();
    await sleep();
    expect(r.of("hide")).toEqual([]);
    expect(useOcclusion.getState().areas["web-preview"]).toBeDefined();
    useOcclusion.getState().hold("menu", "all");
    await vi.waitFor(() => expect(r.of("hide")).toHaveLength(1));
    useOcclusion.getState().release("menu");
    await vi.waitFor(() => expect(r.of("show")).toHaveLength(1));
    done();
    handle.close();
  });

  it("hides and shows when the editor says so, and stays hidden while something covers it", async () => {
    const r = rig();
    const { handle } = await opened(r);
    handle.hide();
    await vi.waitFor(() => expect(r.of("hide")).toHaveLength(1));
    useOcclusion.getState().hold("menu", "all");
    handle.show();
    await sleep();
    expect(r.of("show")).toEqual([]);
    useOcclusion.getState().release("menu");
    await vi.waitFor(() => expect(r.of("show")).toHaveLength(1));
    handle.close();
  });

  it("takes the box to a new address when asked again, and is the same preview", async () => {
    const r = rig();
    const { handle } = await opened(r);
    setPreviewBackend(r.backend);
    const again = await webPreviewHost().open("https://example.com/second", place(10, 10, 200, 100));
    expect(again).toBe(handle);
    expect(r.of("open").map((c) => c[1])).toEqual([URL, "https://example.com/second"]);
    handle.close();
  });
});

describe("a page that cannot be shown", () => {
  it("says why the app refused the address, and tries nothing again", async () => {
    const r = rig({ openFails: "The browser opens web pages only, never KastenFlow's own or a file" });
    const { handle, heard } = await opened(r);
    expect(heard.at(-1)).toEqual({ type: "state", state: { url: URL, title: null, status: "blocked", message: "The browser opens web pages only, never KastenFlow's own or a file" } });
    await sleep(20);
    expect(r.of("open")).toHaveLength(1);
    expect(r.of("hide")).toEqual([]);
    handle.close();
  });

  it("says when the browser could not start, and Try again makes the view anew", async () => {
    const r = rig({ openFails: "The browser could not start: no room" });
    const { handle, heard } = await opened(r);
    expect(heard.at(-1)).toMatchObject({ state: { status: "failed", message: "The browser could not start: no room" } });
    r.backend.open = (url, bounds) => {
      r.calls.push(["open", url, bounds]);
      return Promise.resolve(url);
    };
    handle.reload();
    await vi.waitFor(() => expect(r.of("open")).toHaveLength(2));
    await vi.waitFor(() => expect(heard.at(-1)).toMatchObject({ state: { status: "loading" } }));
    handle.close();
  });

  it("keeps an address that is not a web page away from the app altogether", async () => {
    const r = rig();
    setPreviewBackend(r.backend);
    const handle = (await webPreviewHost().open("file:///C:/Windows/win.ini", place()))!;
    const heard: WebPreviewEvent[] = [];
    handle.subscribe((e) => heard.push(e));
    expect(r.of("open")).toEqual([]);
    expect(heard.at(-1)).toMatchObject({ state: { status: "blocked" } });
    handle.close();
  });

  it("fails clearly when the browser is switched off while it is open", async () => {
    const r = rig();
    const { handle, heard } = await opened(r);
    useBrowserPrefs.setState({ enabled: false });
    expect(heard.at(-1)).toMatchObject({ state: { status: "failed", message: "Web previews were switched off in Settings." } });
    handle.close();
  });
});

describe("the preview's own buttons", () => {
  it("go back, go forward and reload the page", async () => {
    const r = rig();
    const { handle } = await opened(r);
    handle.back();
    handle.forward();
    handle.reload();
    await vi.waitFor(() => expect(r.of("nav")).toHaveLength(3));
    expect(r.of("nav").map((c) => c[1])).toEqual([{ action: "back" }, { action: "forward" }, { action: "reload" }]);
    handle.close();
  });

  it("opens the page where it is now in the system's browser", async () => {
    const r = rig();
    const { handle } = await opened(r);
    sendPreviewSignal({ type: "page", event: { id: "preview", kind: "url", url: "https://example.com/where-it-went" } });
    handle.openExternal();
    expect(openUrl).toHaveBeenCalledWith("https://example.com/where-it-went");
    handle.close();
  });
});

describe("an idle view the app closed", () => {
  it("comes back, at the address it was at, when it is shown again", async () => {
    const r = rig();
    const { handle } = await opened(r);
    handle.hide();
    await vi.waitFor(() => expect(r.of("hide")).toHaveLength(1));
    sendPreviewSignal({ type: "page", event: { id: "preview", kind: "closed" } });
    await sleep();
    expect(r.of("open")).toHaveLength(1);
    handle.show();
    await vi.waitFor(() => expect(r.of("open")).toHaveLength(2));
    expect(r.of("open")[1]![1]).toBe(URL);
    handle.close();
  });
});

describe("closing the preview", () => {
  it("closes the view, gives the area back, and hears nothing more", async () => {
    const r = rig();
    const { handle, heard } = await opened(r);
    handle.close();
    await vi.waitFor(() => expect(r.of("close")).toHaveLength(1));
    expect(useOcclusion.getState().areas["web-preview"]).toBeUndefined();
    const count = heard.length;
    sendPreviewSignal({ type: "key", key: "Escape" });
    sendPreviewSignal({ type: "page", event: { id: "preview", kind: "title", title: "late" } });
    useOcclusion.getState().hold("dialog", "all");
    await sleep();
    expect(heard).toHaveLength(count);
    expect(r.of("hide")).toEqual([]);
    // Closing twice closes once; opening after is a new preview.
    handle.close();
    await sleep();
    expect(r.of("close")).toHaveLength(1);
    useOcclusion.getState().release("dialog");
    setPreviewBackend(r.backend);
    const next = await webPreviewHost().open(URL, place());
    expect(next).not.toBe(handle);
    next?.close();
  });

  it("sends nothing that was still waiting when it was closed, and closes the view last", async () => {
    const r = rig();
    const { handle } = await opened(r);
    handle.hide();
    handle.place(place(0, 0, 50, 50));
    handle.close();
    await vi.waitFor(() => expect(r.calls.map((c) => c[0])).toEqual(["open", "close"]));
  });
});
