// The web page peek: a toolbar of named buttons, three sizes, an edge that is dragged or moved with the arrow keys, a card for a page that
// cannot be shown, the order of the Escape key, and the view handed to the host being placed, hidden and closed as the panel moves.

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
  it("opens the host's preview on the address, at the side, over the box it draws", async () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      return (this.classList.contains("ks-wp-view") ? { left: 700, top: 40, width: 480, height: 600, right: 1180, bottom: 640, x: 700, y: 40, toJSON: () => ({}) } : new DOMRect()) as DOMRect;
    });
    const { open, handle } = await show();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(URL_A, { mode: "side", rect: { x: 700, y: 40, w: 480, h: 600 } });
    expect(handle.place).toHaveBeenCalledWith({ mode: "side", rect: { x: 700, y: 40, w: 480, h: 600 } });
  });

  it("has a toolbar of named buttons, every one a button that can be reached with the keyboard", async () => {
    const { panel, handle, onClose } = await show();
    const bar = screen.getByRole("toolbar", { name: "Web page preview" });
    expect([...bar.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual(["Back", "Forward", "Reload", "Show in the middle", "Full screen", "Open externally", "Close (Esc)"]);
    for (const b of bar.querySelectorAll("button")) expect(b.tabIndex, b.getAttribute("aria-label") ?? "").toBe(0);
    fireEvent.click(button("Back"));
    fireEvent.click(button("Forward"));
    fireEvent.click(button("Reload"));
    fireEvent.click(button("Open externally"));
    expect([handle.back, handle.forward, handle.reload, handle.openExternal].map((spy) => spy.mock.calls.length)).toEqual([1, 1, 1, 1]);
    fireEvent.click(button("Close (Esc)"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(panel().getAttribute("aria-modal")).toBe("false");
  });

  it("goes to the middle and to the whole window with the toolbar, and back, telling the host where the box is each time", async () => {
    const { panel, handle } = await show();
    fireEvent.click(button("Show in the middle"));
    expect(panel().dataset.mode).toBe("center");
    expect(handle.place).toHaveBeenLastCalledWith(expect.objectContaining({ mode: "center" }));
    expect(button("Show at the side")).toBeTruthy();
    fireEvent.click(button("Full screen"));
    expect(panel().dataset.mode).toBe("full");
    expect(handle.place).toHaveBeenLastCalledWith(expect.objectContaining({ mode: "full" }));
    expect(button("Leave full screen").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(button("Leave full screen"));
    expect(panel().dataset.mode).toBe("side");
  });

  it("has the keys while it is open", async () => {
    const { panel } = await show();
    expect(document.activeElement).toBe(panel());
  });

  it("is placed again when the window changes size and when its box does", async () => {
    const { handle } = await show();
    handle.place.mockClear();
    fireEvent(window, new Event("resize"));
    expect(handle.place).toHaveBeenCalledTimes(1);
  });

  it("shows the title the page reports, or its address until it has one, and says it is loading", async () => {
    const { say } = await show();
    expect(screen.getByRole("toolbar").textContent).toContain(URL_A);
    say({ title: "An example", status: "ready" });
    expect(screen.getByRole("toolbar").textContent).toContain("An example");
    expect(screen.queryByRole("status", { name: "Loading the page" })).toBeNull();
  });
});

describe("Escape", () => {
  it("steps back one size at a time: the whole window to the side, then closed", async () => {
    const { panel, onClose } = await show();
    fireEvent.click(button("Full screen"));
    escape(panel());
    expect(panel().dataset.mode).toBe("side");
    expect(onClose).not.toHaveBeenCalled();
    escape(panel());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("steps back from the middle to the side as well", async () => {
    const { panel, onClose } = await show();
    fireEvent.click(button("Show in the middle"));
    escape();
    expect(panel().dataset.mode).toBe("side");
    expect(onClose).not.toHaveBeenCalled();
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

  it("is followed when the page's own view had the key, in the same order", async () => {
    const { panel, press, onClose } = await show();
    fireEvent.click(button("Full screen"));
    press("Escape");
    expect(panel().dataset.mode).toBe("side");
    press("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
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

  it("go on from the slide beside a peek at the side, and stop for the middle and the whole window, which cover it", async () => {
    const seen = vi.fn();
    document.addEventListener("keydown", seen);
    await show({ surface: "show" });
    arrow();
    expect(seen).toHaveBeenCalledTimes(1);
    fireEvent.click(button("Show in the middle"));
    arrow();
    expect(seen).toHaveBeenCalledTimes(1);
    // Tab and the chords of the system are not taken.
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "r", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(seen).toHaveBeenCalledTimes(3);
    document.removeEventListener("keydown", seen);
  });

  it("are not touched beside the editor's slide: the editor's own keys are its own", async () => {
    const seen = vi.fn();
    document.addEventListener("keydown", seen);
    await show({ surface: "editor" });
    fireEvent.click(button("Show in the middle"));
    arrow();
    arrow(button("Reload"));
    expect(seen).toHaveBeenCalledTimes(2);
    document.removeEventListener("keydown", seen);
  });
});

describe("the edge", () => {
  const grip = () => screen.getByRole("separator", { name: "Resize the web page preview" });

  it("is a separator with a value, which the arrow keys move (left is wider), Home and End take to the ends, and which is kept", async () => {
    await show();
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
    const { panel, handle } = await show();
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
    await show();
    expect(grip().getAttribute("aria-valuenow")).toBe("650");
    fireEvent.click(button("Show in the middle"));
    expect(screen.queryByRole("separator")).toBeNull();
    cleanup();
    localStorage.setItem(WEB_PREVIEW_WIDTH_KEY, "10");
    await show();
    expect(Number(grip().getAttribute("aria-valuenow"))).toBeGreaterThanOrEqual(280);
  });
});

describe("a page that cannot be shown", () => {
  it("says so, offers to try again and to open outside, and takes the view off the screen so the card can be seen", async () => {
    const { say, handle } = await show();
    say({ status: "failed", message: "example.com refused to connect." });
    expect(screen.getByRole("status").textContent).toContain("example.com refused to connect.");
    expect(handle.hide).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(handle.reload).toHaveBeenCalledTimes(1);
    // The toolbar's button and the card's do the same.
    fireEvent.click(screen.getAllByRole("button", { name: "Open externally" }).at(-1)!);
    expect(handle.openExternal).toHaveBeenCalledTimes(1);
    say({ status: "ready" });
    expect(handle.show).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("has a plain sentence for a blocked page without a message", async () => {
    const { say } = await show();
    say({ status: "blocked" });
    expect(screen.getByRole("status").textContent).toMatch(/blocked/);
  });

  it("explains a host that cannot preview, offers to turn previews on when it can, and to open outside", async () => {
    const openExternally = vi.fn();
    const host = fakeHost({ handle: false, turnOn: true });
    await show({ openExternally }, host);
    expect(screen.getByRole("status").textContent).toMatch(/can't be previewed here/);
    fireEvent.click(screen.getByRole("button", { name: "Turn on web previews" }));
    expect(host.turnOn).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getAllByRole("button", { name: "Open externally" }).at(-1)!);
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
    expect(open).toHaveBeenLastCalledWith("https://example.com/b", expect.objectContaining({ mode: "side" }));
    expect(handle.close).not.toHaveBeenCalled();
  });

  it("steps aside while the editor has a dialog or a menu open, and comes back", async () => {
    const { handle } = await show();
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
    const { handle } = await show();
    expect(handle.hide).toHaveBeenCalled();
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
