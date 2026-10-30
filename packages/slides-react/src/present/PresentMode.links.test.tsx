// A web link followed in a presentation. It used to open a Kasten browser tab underneath the show, out of sight. With a host that has a
// web preview it opens in a window over the dimmed slide (Escape steps back out of it, and the slide, the step and the keys are as they
// were), or beside the slide or over the whole window as the person last chose for the deck; without one it opens outside, as before.
// A right-click on a web link, in the show or on the preview's header, offers the same six choices. Mail and phone links go out.

import type { Deck, Element, Slide } from "@kasten-slides/wasm";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WebPreviewEvent, WebPreviewHandle, WebPreviewHost } from "../editor/web-preview-host.ts";
import { makePageLink } from "../pages/links.ts";
import { plainDeck } from "../render/testing/decks.ts";
import { PresentMode } from "./PresentMode.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
});

const wait = (ms = 30) => act(async () => void (await new Promise((done) => setTimeout(done, ms))));
const present = () => host.querySelector<HTMLElement>(".slides section.present:not(.stack)")?.getAttribute("data-slide");
const link = (id: string) => host.querySelector<HTMLElement>(`[data-el="${id}"] [data-href]`)!;
const peek = () => host.querySelector<HTMLElement>(".ks-wp");
const stage = () => host.querySelector<HTMLElement>(".ks-show")!;

/** A host whose web preview is a set of spies. */
function fakePreview(options: { handle?: boolean; turnOn?: boolean } = {}) {
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
  const preview: WebPreviewHost = { open, ...(options.turnOn ? { turnOn } : {}) };
  const say = (status: "loading" | "ready" | "failed") => act(() => listeners.forEach((l) => l({ type: "state", state: { url: WEB, title: null, status } })));
  return { preview, handle, open, turnOn, say, press: () => act(() => listeners.forEach((l) => l({ type: "key", key: "Escape" }))) };
}

async function show(deck: Deck, props: Partial<Parameters<typeof PresentMode>[0]> = {}) {
  const onExit = vi.fn();
  await act(async () => root.render(<PresentMode deck={deck} start={0} imageUrl={() => undefined} onExit={onExit} {...props} />));
  await wait(60);
  return onExit;
}

/** reveal.js reads the old key codes. */
const CODES: Record<string, number> = { Escape: 27, ArrowRight: 39, " ": 32 };

const key = (name: string, target: EventTarget = document.body) => {
  const event = new KeyboardEvent("keydown", { key: name, keyCode: CODES[name] ?? 0, bubbles: true, cancelable: true });
  act(() => void target.dispatchEvent(event));
  return event;
};

const WEB = "https://example.com/x";

describe("a link to the web, where the host has a web preview", () => {
  it("opens it in a window over the dimmed slide, and not outside", async () => {
    const openUrl = vi.fn();
    const opened = vi.spyOn(window, "open").mockReturnValue(null);
    const { preview, open } = fakePreview();
    await show(deckOf(slide("a", words("w", WEB)), slide("b")), { pages: { webPreview: preview, openUrl } });
    expect(peek()).toBeNull();
    await act(async () => link("w").click());
    await wait();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(WEB, expect.objectContaining({ mode: "center" }));
    expect(peek()?.dataset.mode).toBe("center");
    expect(host.querySelector(".ks-wp-scrim")).not.toBeNull();
    expect(openUrl).not.toHaveBeenCalled();
    expect(opened).not.toHaveBeenCalled();
    // The slide is where it was.
    expect(present()).toBe("a");
  });

  it("steps back with Escape: the peek first, and the presentation only after it; the slide, the step and the keys are the same", async () => {
    const { preview, handle } = fakePreview();
    const onExit = await show(deckOf(slide("a", words("w", WEB)), slide("b")), { pages: { webPreview: preview } });
    await act(async () => link("w").click());
    await wait();
    const first = key("Escape");
    await wait();
    expect(peek()).toBeNull();
    expect(handle.close).toHaveBeenCalledTimes(1);
    expect(onExit).not.toHaveBeenCalled();
    expect(first.defaultPrevented).toBe(true);
    expect(present()).toBe("a");
    expect(host.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(stage());
    // Now the key is the presentation's own again.
    key("Escape");
    await wait();
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("goes from the whole window back to the window over the slide to closed, and from the page's own view the same way", async () => {
    const { preview, press } = fakePreview();
    const onExit = await show(deckOf(slide("a", words("w", WEB))), { pages: { webPreview: preview } });
    await act(async () => link("w").click());
    await wait();
    await act(async () => peek()!.querySelector<HTMLElement>('[aria-label="Full screen"]')!.click());
    expect(peek()?.dataset.mode).toBe("full");
    key("Escape");
    expect(peek()?.dataset.mode).toBe("center");
    await act(async () => peek()!.querySelector<HTMLElement>('[aria-label="Full screen"]')!.click());
    await press();
    expect(peek()?.dataset.mode).toBe("center");
    await press();
    expect(peek()).toBeNull();
    expect(onExit).not.toHaveBeenCalled();
  });

  it("does not move the slides while it covers them, and does beside a peek at the side", async () => {
    const { preview } = fakePreview();
    await show(deckOf(slide("a", words("w", WEB)), slide("b")), { pages: { webPreview: preview } });
    await act(async () => link("w").click());
    await wait();
    key("ArrowRight");
    key(" ");
    await wait();
    expect(present()).toBe("a");
    await act(async () => peek()!.querySelector<HTMLElement>('[aria-label="Show beside the slide"]')!.click());
    key("ArrowRight");
    await wait();
    expect(present()).toBe("b");
  });

  it("shows a skeleton and keeps the host's view off the screen until the page has loaded", async () => {
    const { preview, handle, say } = fakePreview();
    await show(deckOf(slide("a", words("w", WEB))), { pages: { webPreview: preview } });
    await act(async () => link("w").click());
    await wait();
    expect(host.querySelector(".ks-wp-skeleton")).not.toBeNull();
    expect(peek()!.textContent).toContain("Loading…");
    expect(handle.show).not.toHaveBeenCalled();
    await say("loading");
    expect(handle.show).not.toHaveBeenCalled();
    await say("ready");
    expect(handle.show).toHaveBeenCalled();
    expect(host.querySelector(".ks-wp-skeleton")).toBeNull();
    expect(peek()!.textContent).not.toContain("Loading…");
  });

  it("remembers how it was last shown for the deck: beside the slide next time, and the default for another deck", async () => {
    const { preview, open } = fakePreview();
    const first = deckOf(slide("a", words("w", WEB)));
    await show(first, { pages: { webPreview: preview } });
    await act(async () => link("w").click());
    await wait();
    await act(async () => peek()!.querySelector<HTMLElement>('[aria-label="Show beside the slide"]')!.click());
    key("Escape");
    expect(peek()).toBeNull();
    await act(async () => link("w").click());
    await wait();
    expect(open).toHaveBeenLastCalledWith(WEB, expect.objectContaining({ mode: "side" }));
    expect(peek()?.dataset.mode).toBe("side");
    await act(async () => root.unmount());
    root = createRoot(host);
    await show({ ...first, id: "d-another" }, { pages: { webPreview: preview } });
    await act(async () => link("w").click());
    await wait();
    expect(peek()?.dataset.mode).toBe("center");
  });

  it("opens another address in the same peek, one at a time", async () => {
    const { preview, open } = fakePreview();
    await show(deckOf(slide("a", words("w", WEB), words("v", "https://example.org/y", 400))), { pages: { webPreview: preview } });
    await act(async () => link("w").click());
    await wait();
    await act(async () => link("v").click());
    await wait();
    expect(host.querySelectorAll(".ks-wp")).toHaveLength(1);
    expect(open).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenLastCalledWith("https://example.org/y", expect.anything());
  });

  it("gives way to the panel of a page of the host, and the panel to the peek: one thing at the side", async () => {
    const { preview } = fakePreview();
    const Panel = ({ path }: { path: string }) => <div data-testid="panel">{path}</div>;
    await show(deckOf(slide("a", words("w", WEB), words("p", makePageLink("projects/talk/plan.md", null), 400))), { pages: { webPreview: preview, pagePanel: Panel } });
    await act(async () => link("w").click());
    await wait();
    expect(peek()).not.toBeNull();
    await act(async () => link("p").click());
    expect(peek()).toBeNull();
    expect(host.querySelector(".ks-show-panel")).not.toBeNull();
    await act(async () => link("w").click());
    await wait();
    expect(host.querySelector(".ks-show-panel")).toBeNull();
    expect(peek()).not.toBeNull();
  });

  it("says so, and offers to open outside, when the host cannot show a page now", async () => {
    const openUrl = vi.fn();
    const { preview } = fakePreview({ handle: false });
    await show(deckOf(slide("a", words("w", WEB))), { pages: { webPreview: preview, openUrl } });
    await act(async () => link("w").click());
    await wait();
    expect(peek()?.dataset.phase).toBe("unavailable");
    await act(async () => [...peek()!.querySelectorAll("button")].find((b) => b.textContent === "Open in my browser")!.click());
    expect(openUrl).toHaveBeenCalledWith(WEB);
  });

  it("with previews switched off, still says so on the card and offers to turn them on", async () => {
    const { preview, turnOn } = fakePreview({ handle: false, turnOn: true });
    await show(deckOf(slide("a", words("w", WEB))), { pages: { webPreview: preview } });
    await act(async () => link("w").click());
    await wait();
    expect(peek()?.textContent).toContain("switched off");
    await act(async () => [...peek()!.querySelectorAll("button")].find((b) => b.textContent === "Turn on web previews")!.click());
    expect(turnOn).toHaveBeenCalledTimes(1);
  });

  it("sends mail and phone links out, and never previews them", async () => {
    const openUrl = vi.fn();
    const { preview, open } = fakePreview();
    await show(deckOf(slide("a", words("m", "mailto:me@example.com"), words("t", "tel:+15550100", 400))), { pages: { webPreview: preview, openUrl } });
    await act(async () => link("m").click());
    await act(async () => link("t").click());
    expect(openUrl.mock.calls.map((call) => call[0])).toEqual(["mailto:me@example.com", "tel:+15550100"]);
    expect(open).not.toHaveBeenCalled();
    expect(peek()).toBeNull();
    // And there is no menu of web choices on them.
    await act(async () => void link("m").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("never follows what could run", async () => {
    const { preview, open } = fakePreview();
    await show(deckOf(slide("a", words("w", "javascript:alert(1)"))), { pages: { webPreview: preview } });
    await act(async () => link("w").click());
    await wait();
    expect(open).not.toHaveBeenCalled();
    expect(peek()).toBeNull();
  });
});

describe("a link to the web, where the host has no web preview", () => {
  it("opens it outside in the host's way, or in a window that shares nothing with the slide", async () => {
    const openUrl = vi.fn();
    await show(deckOf(slide("a", words("w", WEB))), { pages: { openUrl } });
    await act(async () => link("w").click());
    expect(openUrl).toHaveBeenCalledWith(WEB);
    expect(peek()).toBeNull();
    await act(async () => root.unmount());
    root = createRoot(host);
    const opened = vi.spyOn(window, "open").mockReturnValue(null);
    await show(deckOf(slide("a", words("w", WEB))));
    await act(async () => link("w").click());
    expect(opened).toHaveBeenCalledWith(WEB, "_blank", "noopener,noreferrer");
    expect(peek()).toBeNull();
  });
});
