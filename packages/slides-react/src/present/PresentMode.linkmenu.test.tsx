// The right-click menu on a web link in a show: the six choices, what each one asks of the host, that it works during the show (a menu
// drawn in the page), and the order of Escape: the menu first, then the preview, and the show itself only after both.

import type { Deck, Element, Slide } from "@kasten-slides/wasm";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WebPreviewEvent, WebPreviewHandle, WebPreviewHost } from "../editor/web-preview-host.ts";
import { makePageLink } from "../pages/links.ts";
import { plainDeck } from "../render/testing/decks.ts";
import { PresentMode } from "./PresentMode.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WEB = "https://example.com/x";

const words = (id: string, link: string, x = 40): Element =>
  ({ type: "text", id, x, y: 40, w: 300, h: 60, text: { paragraphs: [{ runs: [{ t: `go ${id}`, link }] }] } }) as unknown as Element;
const slide = (id: string, ...elements: Element[]): Slide => ({ id, layout: "blank", elements });
const deckOf = (...slides: Slide[]): Deck => ({ ...plainDeck([]).deck, slides });

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "clipboard");
});

const wait = (ms = 30) => act(async () => void (await new Promise((done) => setTimeout(done, ms))));
const link = (id: string) => host.querySelector<HTMLElement>(`[data-el="${id}"] [data-href]`)!;
const peek = () => host.querySelector<HTMLElement>(".ks-wp");
const menu = () => document.querySelector<HTMLElement>('[role="menu"]');
const rows = () => [...document.querySelectorAll('[role="menuitem"]')].map((row) => row.textContent);
const choose = (name: string) => act(async () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((row) => row.textContent === name)!.click());
const rightClick = (target: HTMLElement) => act(async () => void target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 200, clientY: 100 })));

function fakePreview() {
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
  const open = vi.fn(async (): Promise<WebPreviewHandle | null> => handle);
  const preview: WebPreviewHost = { open };
  return { preview, handle, open };
}

async function show(deck: Deck, props: Partial<Parameters<typeof PresentMode>[0]> = {}) {
  const onExit = vi.fn();
  await act(async () => root.render(<PresentMode deck={deck} start={0} imageUrl={() => undefined} onExit={onExit} {...props} />));
  await wait(60);
  return onExit;
}

const CODES: Record<string, number> = { Escape: 27, ArrowRight: 39 };
const key = (name: string, target: EventTarget = document.body) => {
  const event = new KeyboardEvent("keydown", { key: name, keyCode: CODES[name] ?? 0, bubbles: true, cancelable: true });
  act(() => void target.dispatchEvent(event));
  return event;
};

function ready() {
  const { preview, handle, open } = fakePreview();
  const openUrl = vi.fn();
  const openInTab = vi.fn();
  return { preview, handle, open, openUrl, openInTab, pages: { webPreview: preview, openUrl, openInTab } };
}

describe("a right-click on a web link in the show", () => {
  it("opens a menu of the six choices, in the page, and the system's menu does not open", async () => {
    const { pages } = ready();
    await show(deckOf(slide("a", words("w", WEB))), { pages });
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 200, clientY: 100 });
    await act(async () => void link("w").dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(menu()).not.toBeNull();
    expect(rows()).toEqual(["Preview here", "Preview beside", "Full screen", "Open in a KastenFlow tab", "Open in my browser", "Copy link"]);
  });

  it("previews here, beside or full screen, each asking the host for a view in that way, and not outside", async () => {
    const { pages, open, handle, openUrl } = ready();
    await show(deckOf(slide("a", words("w", WEB))), { pages });
    for (const [name, mode] of [["Preview beside", "side"], ["Full screen", "full"], ["Preview here", "center"]] as const) {
      await rightClick(link("w"));
      await choose(name);
      await wait();
      expect(peek()?.dataset.mode, name).toBe(mode);
      // The one view is placed the new way (it is not opened again for the same address).
      expect(handle.place, name).toHaveBeenLastCalledWith(expect.objectContaining({ mode }));
    }
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(WEB, expect.objectContaining({ mode: "side" }));
    expect(openUrl).not.toHaveBeenCalled();
    expect(host.querySelectorAll(".ks-wp")).toHaveLength(1);
  });

  it("opens in a KastenFlow tab, opens in the person's browser, and copies the address, each through the right host method", async () => {
    const { pages, openUrl, openInTab, open } = ready();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await show(deckOf(slide("a", words("w", WEB))), { pages });
    await rightClick(link("w"));
    await choose("Open in a KastenFlow tab");
    expect(openInTab).toHaveBeenCalledWith(WEB);
    await rightClick(link("w"));
    await choose("Open in my browser");
    expect(openUrl).toHaveBeenCalledWith(WEB);
    await rightClick(link("w"));
    await choose("Copy link");
    expect(writeText).toHaveBeenCalledWith(WEB);
    expect(open).not.toHaveBeenCalled();
    expect(peek()).toBeNull();
  });

  it("leaves out the rows the host cannot do: no preview rows without a web preview, no tab row without a tab", async () => {
    const openUrl = vi.fn();
    await show(deckOf(slide("a", words("w", WEB))), { pages: { openUrl } });
    await rightClick(link("w"));
    expect(rows()).toEqual(["Open in my browser", "Copy link"]);
  });

  it("is not offered on links to slides or pages, or on what could run", async () => {
    const { pages } = ready();
    const Panel = ({ path }: { path: string }) => <div>{path}</div>;
    await show(deckOf(slide("a", words("p", makePageLink("projects/talk/plan.md", null)), words("s", "slide:b", 400), words("j", "javascript:alert(1)", 40)), slide("b")), { pages: { ...pages, pagePanel: Panel } });
    for (const id of ["p", "s", "j"]) {
      await rightClick(link(id));
      expect(menu(), id).toBeNull();
    }
  });

  it("keeps the show where it was: the arrows in the menu do not move the slides", async () => {
    const { pages } = ready();
    await show(deckOf(slide("a", words("w", WEB)), slide("b")), { pages });
    await rightClick(link("w"));
    key("ArrowRight", menu()!);
    await wait();
    expect(host.querySelector(".slides section.present:not(.stack)")?.getAttribute("data-slide")).toBe("a");
  });
});

describe("Escape, one level at a time", () => {
  it("closes the menu first, then the preview, and only then ends the show", async () => {
    const { pages } = ready();
    const onExit = await show(deckOf(slide("a", words("w", WEB))), { pages });
    await rightClick(link("w"));
    key("Escape");
    expect(menu()).toBeNull();
    expect(peek()).toBeNull();
    expect(onExit).not.toHaveBeenCalled();

    await act(async () => link("w").click());
    await wait();
    expect(peek()).not.toBeNull();
    // The menu on the preview's header: Escape closes it and leaves the preview.
    await act(async () => void peek()!.querySelector(".ks-wp-bar")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 50, clientY: 20 })));
    expect(rows()).toHaveLength(6);
    key("Escape");
    expect(menu()).toBeNull();
    expect(peek()).not.toBeNull();
    expect(onExit).not.toHaveBeenCalled();
    key("Escape");
    await wait();
    expect(peek()).toBeNull();
    expect(onExit).not.toHaveBeenCalled();
    key("Escape");
    await wait();
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
