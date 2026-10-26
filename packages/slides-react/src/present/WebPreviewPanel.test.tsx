// The web page preview: a window over the dimmed slide (beside the slide in the editor), a header of named buttons that stays in the page,
// a skeleton until the page has loaded (the host's view is shown only then), a card for a page that cannot be shown, the order of the
// Escape key, the right-click menu, and the view handed to the host being placed, hidden and closed as the panel moves.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { holdCover } from "../editor/ui/covers.ts";
import type { WebPreviewEvent, WebPreviewHandle, WebPreviewHost, WebPreviewState } from "../editor/web-preview-host.ts";
import { WEB_PREVIEW_WIDTH_KEY } from "../editor/ui-prefs.ts";
import { WebPreviewPanel, type WebPreviewPanelProps } from "./WebPreviewPanel.tsx";

const URL_A = "https://example.com/a";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A host whose preview is a set of spies, and that can say something as the page does. */
function fakeHost(options: { handle?: boolean; turnOn?: boolean } = {}) {
  const listeners = new Set<(event: WebPreviewEvent) => void>();
  const handle = {
    place: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    reload: vi.fn(),
    openExternal: vi.fn(),
    hide: vi.fn(),
    show: vi.fn(),
    close: vi.fn(),
    subscribe: vi.fn((listener: (event: WebPreviewEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
  } satisfies WebPreviewHandle;
  const open = vi.fn(async (): Promise<WebPreviewHandle | null> => (options.handle === false ? null : handle));
  const turnOn = vi.fn();
  const host: WebPreviewHost = { open, ...(options.turnOn ? { turnOn } : {}) };
  const say = (state: Partial<WebPreviewState>) => act(() => listeners.forEach((l) => l({ type: "state", state: { url: URL_A, title: null, status: "loading", ...state } })));
  const press = (key: "Escape") => act(() => listeners.forEach((l) => l({ type: "key", key })));
  return { host, handle, open, turnOn, say, press };
}

async function show(props: Partial<WebPreviewPanelProps> = {}, host = fakeHost()) {
  const onClose = vi.fn();
  const view = render(<WebPreviewPanel host={host.host} url={URL_A} onClose={onClose} {...props} />);
  await act(async () => {});
  return { ...host, onClose, view, panel: () => screen.getByRole("dialog", { name: "Web page preview" }) };
}

const button = (name: string) => screen.getByRole("button", { name });
const escape = (target: Element = document.body) => fireEvent.keyDown(target, { key: "Escape", cancelable: true });

describe("the panel", () => {
  it("opens the host's preview on the address, over the slide in a show, over the box it draws", async () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      return (this.classList.contains("ks-wp-view") ? { left: 700, top: 40, width: 480, height: 600, right: 1180, bottom: 640, x: 700, y: 40, toJSON: () => ({}) } : new DOMRect()) as DOMRect;
    });
    const { open, handle, panel } = await show();
    expect(panel().dataset.mode).toBe("center");
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(URL_A, { mode: "center", rect: { x: 700, y: 40, w: 480, h: 600 } });
    expect(handle.place).toHaveBeenCalledWith({ mode: "center", rect: { x: 700, y: 40, w: 480, h: 600 } });
  });

  it("opens beside the slide in the editor, and in the way asked for when one is", async () => {
    const editor = await show({ surface: "editor" });
    expect(editor.panel().dataset.mode).toBe("side");
    cleanup();
    const asked = await show({ request: { mode: "full", n: 1 } });
    expect(asked.panel().dataset.mode).toBe("full");
    cleanup();
    const initial = await show({ initialMode: "side" });
    expect(initial.panel().dataset.mode).toBe("side");
  });

  it("has a header of named buttons, every one a button that can be reached with the keyboard", async () => {
    const { panel, handle, onClose, say } = await show();
    say({ status: "ready" });
    const bar = screen.getByRole("toolbar", { name: "Web page preview" });
    expect([...bar.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual(["Back", "Forward", "Reload", "Show over the slide", "Show beside the slide", "Full screen", "Open in my browser", "Close (Esc)"]);
    for (const b of bar.querySelectorAll("button")) expect(b.tabIndex, b.getAttribute("aria-label") ?? "").toBe(0);
    fireEvent.click(button("Back"));
    fireEvent.click(button("Forward"));
    fireEvent.click(button("Reload"));
    fireEvent.click(button("Open in my browser"));
    expect([handle.back, handle.forward, handle.reload, handle.openExternal].map((spy) => spy.mock.calls.length)).toEqual([1, 1, 1, 1]);
    fireEvent.click(button("Close (Esc)"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(panel().getAttribute("aria-modal")).toBe("false");
  });

  it("has Open in a KastenFlow tab when the host has a tab, and closes the preview behind it", async () => {
    const openInTab = vi.fn();
    const { onClose, say } = await show({ openInTab });
    say({ status: "ready", url: "https://example.com/moved" });
    fireEvent.click(button("Open in a KastenFlow tab"));
    expect(openInTab).toHaveBeenCalledWith("https://example.com/moved");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("goes beside the slide and to the whole window with the header, and back, telling the host where the box is each time", async () => {
    const { panel, handle } = await show();
    fireEvent.click(button("Show beside the slide"));
    expect(panel().dataset.mode).toBe("side");
    expect(handle.place).toHaveBeenLastCalledWith(expect.objectContaining({ mode: "side" }));
    expect(button("Show beside the slide").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(button("Full screen"));
    expect(panel().dataset.mode).toBe("full");
    expect(handle.place).toHaveBeenLastCalledWith(expect.objectContaining({ mode: "full" }));
    expect(button("Leave full screen").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(button("Leave full screen"));
    expect(panel().dataset.mode).toBe("side");
    fireEvent.click(button("Show over the slide"));
    expect(panel().dataset.mode).toBe("center");
  });

  it("tells the host how it sits each time the person changes it, so it can be kept", async () => {
    const onMode = vi.fn();
    await show({ onMode });
    fireEvent.click(button("Show beside the slide"));
    fireEvent.click(button("Full screen"));
    expect(onMode.mock.calls.map((call) => call[0])).toEqual(["side", "full"]);
  });

  it("follows a way asked for from a menu while it is open", async () => {
    const asked = vi.fn();
    const { view, host, panel } = await show({ onMode: asked, request: { mode: "center", n: 1 } });
    view.rerender(<WebPreviewPanel host={host} url={URL_A} onClose={() => {}} onMode={asked} request={{ mode: "side", n: 2 }} />);
    expect(panel().dataset.mode).toBe("side");
    view.rerender(<WebPreviewPanel host={host} url={URL_A} onClose={() => {}} onMode={asked} request={{ mode: "side", n: 2 }} />);
    expect(asked).toHaveBeenCalledTimes(1);
  });

  it("has the keys while it is open", async () => {
    const { panel } = await show();
    expect(document.activeElement).toBe(panel());
  });

  it("dims the slide behind the window, and a press on the dimmed slide closes it", async () => {
    const { view, onClose } = await show();
    const scrim = view.container.querySelector(".ks-wp-scrim")!;
    fireEvent.click(scrim);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(button("Show beside the slide"));
    expect(view.container.querySelector(".ks-wp-scrim")).toBeNull();
  });

  it("is placed again when the window changes size and when its box does", async () => {
    const { handle } = await show();
    handle.place.mockClear();
    fireEvent(window, new Event("resize"));
    expect(handle.place).toHaveBeenCalledTimes(1);
  });

  it("is placed again when the screen's density changes without a resize, and listens for the next density", async () => {
    const changes = new Set<() => void>();
    const asked: string[] = [];
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => {
        asked.push(query);
        return { matches: false, addEventListener: (_: string, listener: () => void) => changes.add(listener), removeEventListener: (_: string, listener: () => void) => changes.delete(listener) };
      },
    });
    const ratio = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 1 });
    try {
      const { handle } = await show();
      expect(asked.at(-1)).toBe("(resolution: 1dppx)");
      handle.place.mockClear();
      Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 2 });
      act(() => [...changes].forEach((listener) => listener()));
      expect(handle.place).toHaveBeenCalledTimes(1);
      expect(asked.at(-1)).toBe("(resolution: 2dppx)");
      expect(changes.size).toBe(1);
    } finally {
      if (ratio) Object.defineProperty(window, "devicePixelRatio", ratio);
      else Reflect.deleteProperty(window, "devicePixelRatio");
      Reflect.deleteProperty(window, "matchMedia");
    }
  });

  it("is placed again on a display change", async () => {
    // jsdom's screen is not an event target; one that is, as in the desktop app's web view, is stood in for.
    const heard = new Set<() => void>();
    const stand = { addEventListener: (_: string, listener: () => void) => heard.add(listener), removeEventListener: (_: string, listener: () => void) => heard.delete(listener) };
    Object.assign(window.screen, stand);
    try {
      const { handle } = await show();
      expect(heard.size).toBe(1);
      handle.place.mockClear();
      act(() => heard.forEach((listener) => listener()));
      expect(handle.place).toHaveBeenCalledTimes(1);
      cleanup();
      expect(heard.size).toBe(0);
    } finally {
      Reflect.deleteProperty(window.screen, "addEventListener");
      Reflect.deleteProperty(window.screen, "removeEventListener");
    }
  });
});

describe("the header", () => {
  it("shows the site and the address until the page has a title, then the title, and says it is loading", async () => {
    const { say } = await show();
    const bar = screen.getByRole("toolbar");
    expect(bar.textContent).toContain("example.com");
    expect(bar.textContent).toContain(URL_A);
    expect(bar.textContent).toContain("Loading…");
    say({ title: "An example", status: "ready" });
    expect(bar.textContent).toContain("An example");
    expect(bar.textContent).toContain(URL_A);
    expect(bar.textContent).not.toContain("Loading…");
    expect(screen.queryByRole("status", { name: "Loading the page" })).toBeNull();
  });

  it("says when the page could not be loaded", async () => {
    const { say } = await show();
    say({ status: "failed" });
    expect(screen.getByRole("toolbar").textContent).toContain("Could not load");
  });
});

describe("loading", () => {
  it("shows a skeleton in the page's place and keeps the host's view off the screen until the page has loaded", async () => {
    const { say, handle, view } = await show();
    expect(view.container.querySelector(".ks-wp-skeleton")).not.toBeNull();
    expect(screen.getByRole("status", { name: "Loading the page" })).toBeTruthy();
    expect(handle.show).not.toHaveBeenCalled();
    expect(handle.hide).toHaveBeenCalled();
    say({ status: "loading" });
    expect(handle.show).not.toHaveBeenCalled();
    say({ status: "ready", title: "Done" });
    expect(handle.show).toHaveBeenCalled();
    expect(view.container.querySelector(".ks-wp-skeleton")).toBeNull();
  });

  it("takes the view off the screen again when another address starts to load", async () => {
    const { say, handle } = await show();
    say({ status: "ready" });
    handle.hide.mockClear();
    say({ status: "loading" });
    expect(handle.hide).toHaveBeenCalled();
  });
});

describe("Escape", () => {
  it("steps back one level at a time: the whole window to where it was, then closed", async () => {
    const { panel, onClose } = await show();
    fireEvent.click(button("Show beside the slide"));
    fireEvent.click(button("Full screen"));
    escape(panel());
    expect(panel().dataset.mode).toBe("side");
    expect(onClose).not.toHaveBeenCalled();
    escape(panel());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("goes from the whole window back to the window over the slide when that is where it was", async () => {
    const { panel, onClose } = await show();
    fireEvent.click(button("Full screen"));
    escape();
    expect(panel().dataset.mode).toBe("center");
    escape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("is the panel's from anywhere over a presentation, and never reaches the presentation (it would end the show)", async () => {
    const seen = vi.fn();
    document.addEventListener("keydown", seen);
    const { onClose } = await show({ surface: "show" });
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => void document.body.dispatchEvent(event));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    expect(seen).not.toHaveBeenCalled();
    document.removeEventListener("keydown", seen);
  });

  it("is the panel's only from inside it beside the editor's slide, where the slide's own Escape is left alone", async () => {
    const { onClose, panel } = await show({ surface: "editor" });
    const outside = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => void document.body.dispatchEvent(outside));
    expect(onClose).not.toHaveBeenCalled();
    expect(outside.defaultPrevented).toBe(false);
    escape(panel());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("steps from the middle to the side beside the editor's slide, then closed", async () => {
    const { panel, onClose } = await show({ surface: "editor" });
    fireEvent.click(button("Show over the slide"));
    escape(panel());
    expect(panel().dataset.mode).toBe("side");
    expect(onClose).not.toHaveBeenCalled();
    escape(panel());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("is followed when the page's own view had the key, in the same order", async () => {
    const { panel, press, onClose } = await show();
    fireEvent.click(button("Full screen"));
    press("Escape");
    expect(panel().dataset.mode).toBe("center");
    press("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("the right-click menu on the header", () => {
  const openMenu = () => fireEvent.contextMenu(screen.getByRole("toolbar"), { clientX: 120, clientY: 40 });
  const row = (name: string) => screen.getByRole("menuitem", { name });

  it("has the six choices, and a choice of how it sits moves the window", async () => {
    const openInTab = vi.fn();
    const { panel, say } = await show({ openInTab });
    say({ status: "ready" });
    openMenu();
    expect(screen.getAllByRole("menuitem").map((r) => r.textContent)).toEqual(["Preview here", "Preview beside", "Full screen", "Open in a KastenFlow tab", "Open in my browser", "Copy link"]);
    fireEvent.click(row("Preview beside"));
    expect(panel().dataset.mode).toBe("side");
    expect(screen.queryByRole("menu")).toBeNull();
    openMenu();
    fireEvent.click(row("Full screen"));
    expect(panel().dataset.mode).toBe("full");
    openMenu();
    fireEvent.click(row("Preview here"));
    expect(panel().dataset.mode).toBe("center");
  });

  it("opens in a KastenFlow tab, in the person's browser, and copies the address", async () => {
    const openInTab = vi.fn();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    try {
      const { handle, say } = await show({ openInTab });
      say({ status: "ready" });
      openMenu();
      fireEvent.click(row("Copy link"));
      expect(writeText).toHaveBeenCalledWith(URL_A);
      openMenu();
      fireEvent.click(row("Open in my browser"));
      expect(handle.openExternal).toHaveBeenCalledTimes(1);
      openMenu();
      fireEvent.click(row("Open in a KastenFlow tab"));
      expect(openInTab).toHaveBeenCalledWith(URL_A);
    } finally {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("takes the host's view off the screen while it is open and puts it back", async () => {
    const { handle, say } = await show();
    say({ status: "ready" });
    handle.hide.mockClear();
    handle.show.mockClear();
    openMenu();
    expect(handle.hide).toHaveBeenCalled();
    fireEvent.click(row("Copy link"));
    expect(handle.show).toHaveBeenCalled();
  });

  it("is closed by Escape first; the window stays, and the next Escape closes the window, and nothing reaches the slides", async () => {
    const seen = vi.fn();
    document.addEventListener("keydown", seen);
    const { onClose } = await show();
    openMenu();
    escape(row("Copy link"));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    escape();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(seen).not.toHaveBeenCalled();
    document.removeEventListener("keydown", seen);
  });

  it("keeps the arrow keys in the menu: they never move the slides behind", async () => {
    const seen = vi.fn();
    document.addEventListener("keydown", seen);
    await show();
    openMenu();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(seen).not.toHaveBeenCalled();
    document.removeEventListener("keydown", seen);
  });
});

describe("the keys of the presentation", () => {
  const arrow = (target: EventTarget = document.body) => {
    const event = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true });
    target.dispatchEvent(event);
  };

  it("never advance the slides from inside the panel", async () => {
    const seen = vi.fn();
    document.addEventListener("keydown", seen);
    await show({ surface: "show" });
    arrow(button("Reload"));
    expect(seen).not.toHaveBeenCalled();
    document.removeEventListener("keydown", seen);
  });

  it("go on from the slide beside a peek at the side, and stop for the window over the slide and the whole window, which cover it", async () => {
    const seen = vi.fn();
    document.addEventListener("keydown", seen);
    await show({ surface: "show" });
    arrow();
    expect(seen).not.toHaveBeenCalled();
    fireEvent.click(button("Show beside the slide"));
    arrow();
    expect(seen).toHaveBeenCalledTimes(1);
    // Tab and the chords of the system are not taken.
    fireEvent.click(button("Show over the slide"));
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "r", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(seen).toHaveBeenCalledTimes(3);
    document.removeEventListener("keydown", seen);
  });

  it("are not touched beside the editor's slide: the editor's own keys are its own", async () => {
    const seen = vi.fn();
    document.addEventListener("keydown", seen);
    await show({ surface: "editor" });
    fireEvent.click(button("Show over the slide"));
    arrow();
    arrow(button("Reload"));
    expect(seen).toHaveBeenCalledTimes(2);
    document.removeEventListener("keydown", seen);
  });
});

describe("the edge", () => {
  const grip = () => screen.getByRole("separator", { name: "Resize the web page preview" });

  it("is a separator with a value, which the arrow keys move (left is wider), Home and End take to the ends, and which is kept", async () => {
    await show({ surface: "editor" });
    expect(grip().getAttribute("aria-valuenow")).toBe("480");
    grip().focus();
    fireEvent.keyDown(grip(), { key: "ArrowLeft" });
    expect(grip().getAttribute("aria-valuenow")).toBe("504");
    fireEvent.keyDown(grip(), { key: "ArrowRight" });
    fireEvent.keyDown(grip(), { key: "ArrowRight" });
    expect(grip().getAttribute("aria-valuenow")).toBe("456");
    expect(localStorage.getItem(WEB_PREVIEW_WIDTH_KEY)).toBe("456");
    fireEvent.keyDown(grip(), { key: "End" });
    expect(grip().getAttribute("aria-valuenow")).toBe(grip().getAttribute("aria-valuemin"));
    fireEvent.keyDown(grip(), { key: "Home" });
    expect(Number(grip().getAttribute("aria-valuenow"))).toBeGreaterThan(480);
  });

  it("is dragged with the pointer, and the box is placed again as it goes", async () => {
    const { panel, handle } = await show({ surface: "editor" });
    handle.place.mockClear();
    fireEvent.pointerDown(grip(), { clientX: 700, pointerId: 1 });
    fireEvent.pointerMove(grip(), { clientX: 600, pointerId: 1 });
    expect(panel().style.width).toBe("580px");
    expect(handle.place).toHaveBeenCalled();
    fireEvent.pointerUp(grip(), { clientX: 600, pointerId: 1 });
    expect(localStorage.getItem(WEB_PREVIEW_WIDTH_KEY)).toBe("580");
  });

  it("starts at the width that was kept, within bounds, and is only at the side", async () => {
    localStorage.setItem(WEB_PREVIEW_WIDTH_KEY, "650");
    await show({ surface: "editor" });
    expect(grip().getAttribute("aria-valuenow")).toBe("650");
    fireEvent.click(button("Show over the slide"));
    expect(screen.queryByRole("separator")).toBeNull();
    cleanup();
    localStorage.setItem(WEB_PREVIEW_WIDTH_KEY, "10");
    await show({ surface: "editor" });
    expect(Number(grip().getAttribute("aria-valuenow"))).toBeGreaterThanOrEqual(280);
  });
});

describe("a page that cannot be shown", () => {
  it("says so, offers to try again and to open in the browser, and takes the view off the screen so the card can be seen", async () => {
    const { say, handle } = await show();
    say({ status: "ready" });
    say({ status: "failed", message: "example.com refused to connect." });
    expect(screen.getByRole("status").textContent).toContain("example.com refused to connect.");
    expect(handle.hide).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(handle.reload).toHaveBeenCalledTimes(1);
    // The header's button and the card's do the same.
    fireEvent.click(screen.getAllByRole("button", { name: "Open in my browser" }).at(-1)!);
    expect(handle.openExternal).toHaveBeenCalledTimes(1);
    handle.show.mockClear();
    say({ status: "ready" });
    expect(handle.show).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("has a plain sentence for a blocked page without a message", async () => {
    const { say } = await show();
    say({ status: "blocked" });
    expect(screen.getByRole("status").textContent).toMatch(/blocked/);
  });

  it("explains a host that cannot preview, offers to turn previews on when it can, and to open in the browser", async () => {
    const openExternally = vi.fn();
    const host = fakeHost({ handle: false, turnOn: true });
    await show({ openExternally }, host);
    expect(screen.getByRole("status").textContent).toMatch(/can't be previewed here/);
    fireEvent.click(screen.getByRole("button", { name: "Turn on web previews" }));
    expect(host.turnOn).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getAllByRole("button", { name: "Open in my browser" }).at(-1)!);
    expect(openExternally).toHaveBeenCalledWith(URL_A);
    // The buttons of a view there is none of are off.
    expect((button("Reload") as HTMLButtonElement).disabled).toBe(true);
  });

  it("offers no switch where the host has none", async () => {
    await show({}, fakeHost({ handle: false }));
    expect(screen.queryByRole("button", { name: "Turn on web previews" })).toBeNull();
  });
});

describe("the host's view", () => {
  it("is closed when the panel goes, and when the panel goes before the host answered, once it does", async () => {
    const first = await show();
    first.view.unmount();
    expect(first.handle.close).toHaveBeenCalledTimes(1);
    cleanup();

    const slow = fakeHost();
    let answer: (handle: WebPreviewHandle | null) => void = () => {};
    slow.open.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    const view = render(<WebPreviewPanel host={slow.host} url={URL_A} onClose={() => {}} />);
    view.unmount();
    await act(async () => answer(slow.handle));
    expect(slow.handle.close).toHaveBeenCalledTimes(1);
  });

  it("navigates when the address changes: the host is asked again, and the open view is not closed in between", async () => {
    const { host, open, handle, view, onClose } = await show();
    view.rerender(<WebPreviewPanel host={host} url="https://example.com/b" onClose={onClose} />);
    await act(async () => {});
    expect(open).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenLastCalledWith("https://example.com/b", expect.objectContaining({ mode: "center" }));
    expect(handle.close).not.toHaveBeenCalled();
  });

  it("steps aside while the editor has a dialog or a menu open, and comes back", async () => {
    const { handle, say } = await show();
    say({ status: "ready" });
    handle.hide.mockClear();
    handle.show.mockClear();
    let release = () => {};
    act(() => {
      release = holdCover();
    });
    expect(handle.hide).toHaveBeenCalledTimes(1);
    act(() => release());
    expect(handle.show).toHaveBeenCalledTimes(1);
  });

  it("is hidden at once if something is open when it arrives", async () => {
    const release = holdCover();
    const { handle, say } = await show();
    say({ status: "ready" });
    expect(handle.hide).toHaveBeenCalled();
    expect(handle.show).not.toHaveBeenCalled();
    release();
  });
});

describe("closing", () => {
  it("returns the keys to the place named, the slide shown, and not to the page", async () => {
    const stage = document.createElement("div");
    stage.tabIndex = -1;
    document.body.append(stage);
    const { view } = await show({ returnTo: () => stage });
    expect(document.activeElement).not.toBe(stage);
    view.unmount();
    expect(document.activeElement).toBe(stage);
    stage.remove();
  });
});
