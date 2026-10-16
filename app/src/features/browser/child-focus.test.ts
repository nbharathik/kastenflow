import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspace } from "../workspace/store";
import { derive } from "../workspace/store-layout";
import { initialLayout, openTab } from "../workspace/tabs";
import { handleChildKey, startChildFocus } from "./child-focus";
import { BROWSER_EVENT } from "./commands";
import { setPreviewBackend, type PreviewBackend } from "./preview-backend";
import { onPreviewSignal, type PreviewSignal } from "./preview-events";
import { handleEvent } from "./web-state";

function fake(available = true) {
  const calls: unknown[][] = [];
  let hear: ((key: string) => void) | null = null;
  const stops: string[] = [];
  const log = (...call: unknown[]) => {
    calls.push(call);
    return Promise.resolve();
  };
  const backend: PreviewBackend = {
    available,
    open: (url) => log("open", url).then(() => url),
    bounds: (b) => log("bounds", b),
    nav: (n) => log("nav", n),
    hide: () => log("hide"),
    show: () => log("show"),
    close: () => log("close"),
    childFocus: (on) => log("childFocus", on),
    onChildKey: (listener) => {
      hear = listener;
      return Promise.resolve(() => stops.push("stopped"));
    },
  };
  return { backend, calls, stops, press: (key: string) => hear?.(key), of: (name: string) => calls.filter((c) => c[0] === name) };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  useWorkspace.setState({ ...derive(initialLayout({ view: "home" })), client: {} as never, notes: [], toasts: [] });
});

afterEach(() => {
  startChildFocus()();
  setPreviewBackend(null);
  vi.restoreAllMocks();
});

describe("telling the app when a native view has the keyboard", () => {
  it("says so when the window's own page is blurred, and when it has the keyboard back", () => {
    const { backend, of } = fake();
    setPreviewBackend(backend);
    startChildFocus();
    window.dispatchEvent(new Event("blur"));
    expect(of("childFocus")).toEqual([["childFocus", true]]);
    window.dispatchEvent(new Event("focus"));
    expect(of("childFocus")).toEqual([["childFocus", true], ["childFocus", false]]);
  });

  it("starts once however often it is asked, and stops listening when told", () => {
    const { backend, of, stops } = fake();
    setPreviewBackend(backend);
    const stop = startChildFocus();
    expect(startChildFocus()).toBe(stop);
    window.dispatchEvent(new Event("blur"));
    expect(of("childFocus")).toHaveLength(1);
    stop();
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("focus"));
    expect(of("childFocus")).toHaveLength(1);
    return settle().then(() => expect(stops).toEqual(["stopped"]));
  });

  it("does not mistake focus that went into a frame of its own page for a native view's", () => {
    const { backend, of } = fake();
    setPreviewBackend(backend);
    startChildFocus();
    const frame = document.createElement("iframe");
    document.body.append(frame);
    frame.focus();
    expect(document.activeElement).toBe(frame);
    window.dispatchEvent(new Event("blur"));
    expect(of("childFocus")).toEqual([]);
    frame.remove();
    window.dispatchEvent(new Event("blur"));
    expect(of("childFocus")).toEqual([["childFocus", true]]);
  });

  it("does nothing where there are no native views", () => {
    const { backend, of } = fake(false);
    setPreviewBackend(backend);
    startChildFocus();
    window.dispatchEvent(new Event("blur"));
    expect(of("childFocus")).toEqual([]);
  });

  it("acts on a key the app took: the same as the key in the window", async () => {
    const { backend, press } = fake();
    setPreviewBackend(backend);
    startChildFocus();
    await settle();
    const layout = openTab(initialLayout({ view: "page", path: "a.md" }), { view: "web", url: "https://example.com/" });
    useWorkspace.setState(derive(layout));
    const views = () => useWorkspace.getState().layout.panes[0]!.tabs.map((t) => t.place.view);
    // Ctrl+T on a browser tab: another browser tab (the commands load when first needed).
    press("t");
    await vi.waitFor(() => expect(views()).toEqual(["page", "web", "web"]), { timeout: 20_000 });
    // Ctrl+W closes the tab in front.
    press("w");
    await vi.waitFor(() => expect(views()).toEqual(["page", "web"]));
  }, 30_000);
});

describe("what each taken key does", () => {
  it("opens a tab, closes a tab, goes to the address box, and gives Escape to the preview", () => {
    const actions = { newTab: vi.fn(), closeTab: vi.fn(), address: vi.fn() };
    const heard: PreviewSignal[] = [];
    const stop = onPreviewSignal((signal) => heard.push(signal));
    handleChildKey("t", actions);
    handleChildKey("w", actions);
    handleChildKey("l", actions);
    handleChildKey("Escape", actions);
    handleChildKey("x", actions);
    stop();
    expect(actions.newTab).toHaveBeenCalledTimes(1);
    expect(actions.closeTab).toHaveBeenCalledTimes(1);
    expect(actions.address).toHaveBeenCalledTimes(1);
    expect(heard).toEqual([{ type: "key", key: "Escape" }]);
  });

  it("asks the browser tab in front for its address box with Ctrl+L", () => {
    const asked: unknown[] = [];
    const listen = (event: Event) => asked.push((event as CustomEvent).detail);
    window.addEventListener(BROWSER_EVENT, listen);
    handleChildKey("l");
    window.removeEventListener(BROWSER_EVENT, listen);
    expect(asked).toEqual(["address"]);
  });
});

describe("the preview's events", () => {
  it("go to whoever listens for the preview, and change no tab", () => {
    const layout = openTab(initialLayout({ view: "home" }), { view: "web", url: "https://a.example/" });
    useWorkspace.setState(derive(layout));
    const before = useWorkspace.getState().layout;
    const heard: PreviewSignal[] = [];
    const stop = onPreviewSignal((signal) => heard.push(signal));
    handleEvent({ id: "preview", kind: "loading", loading: true, url: "https://elsewhere.example/" });
    handleEvent({ id: "preview", kind: "title", title: "Elsewhere", url: "https://elsewhere.example/" });
    handleEvent({ id: "preview", kind: "closed" });
    stop();
    expect(heard.map((s) => (s.type === "page" ? s.event.kind : s.type))).toEqual(["loading", "title", "closed"]);
    expect(useWorkspace.getState().layout).toBe(before);
    // A tab's event still goes to its tab.
    const id = before.panes[0]!.active;
    handleEvent({ id, kind: "url", url: "https://a.example/next" });
    expect(useWorkspace.getState().place.url).toBe("https://a.example/next");
  });

  it("refuse a download the way a tab's do", () => {
    const toast = vi.spyOn(useWorkspace.getState(), "toast");
    const heard: PreviewSignal[] = [];
    const stop = onPreviewSignal((signal) => heard.push(signal));
    handleEvent({ id: "preview", kind: "download", url: "https://a.example/file.zip" });
    stop();
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0]![1]!.label).toBe("Open in your browser");
    expect(heard).toEqual([]);
  });
});
