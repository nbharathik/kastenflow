// Links in a presentation: to another slide, to a page of the host (a calm panel at the side, which Esc puts away without ending the show),
// and out to the web.

import type { Deck, Element, Slide } from "@kasten-slides/wasm";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

async function show(deck: Deck, props: Partial<Parameters<typeof PresentMode>[0]> = {}) {
  const onExit = vi.fn();
  await act(async () => root.render(<PresentMode deck={deck} start={0} imageUrl={() => undefined} onExit={onExit} {...props} />));
  await wait(60);
  return onExit;
}

const PAGE = makePageLink("projects/talk/plan.md", "Risks");

describe("a link to a slide", () => {
  it("goes to it when it is clicked", async () => {
    await show(deckOf(slide("a", words("w", "slide:c")), slide("b"), slide("c")));
    expect(present()).toBe("a");
    await act(async () => link("w").click());
    await wait();
    expect(present()).toBe("c");
  });

  it("is reached with Tab, says where it goes, and goes on Enter", async () => {
    await show(deckOf(slide("a", words("w", "slide:b")), slide("b")));
    const words1 = link("w");
    expect(words1.tabIndex).toBe(0);
    expect(words1.getAttribute("role")).toBe("link");
    expect(words1.title).toBe("Go to that slide");
    await act(async () => void words1.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    await wait();
    expect(present()).toBe("b");
  });

  it("is followed from an element that links as a whole", async () => {
    const shape = { type: "shape", id: "s", shape: "rect", x: 10, y: 10, w: 100, h: 60, link: "slide:b" } as unknown as Element;
    await show(deckOf(slide("a", shape), slide("b")));
    const node = host.querySelector<HTMLElement>('[data-el="s"]')!;
    expect(node.dataset.link).toBe("slide:b");
    await act(async () => node.click());
    await wait();
    expect(present()).toBe("b");
  });
});

describe("a link to a page of the host", () => {
  const Panel = ({ path, section, onClose }: { path: string; section: string | null; onClose(): void }) => (
    <div data-testid="panel">
      {path}|{section}
      <button type="button" onClick={onClose}>
        close it
      </button>
    </div>
  );

  it("opens the host's panel at the side, with the page and the heading, and leaves the slide where it is", async () => {
    await show(deckOf(slide("a", words("p", PAGE)), slide("b")), { pages: { pagePanel: Panel } });
    expect(host.querySelector(".ks-show-panel")).toBeNull();
    await act(async () => link("p").click());
    expect(host.querySelector(".ks-show-panel")?.getAttribute("role")).toBe("dialog");
    expect(host.querySelector('[data-testid="panel"]')?.textContent).toContain("projects/talk/plan.md|Risks");
    expect(present()).toBe("a");
  });

  it("is put away by Esc, which returns to the slide and does not end the presentation", async () => {
    const onExit = await show(deckOf(slide("a", words("p", PAGE))), { pages: { pagePanel: Panel } });
    await act(async () => link("p").click());
    const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    await act(async () => void document.body.dispatchEvent(esc));
    expect(host.querySelector(".ks-show-panel")).toBeNull();
    expect(onExit).not.toHaveBeenCalled();
    expect(host.contains(document.activeElement)).toBe(true);
    // The next Esc is the presentation's own: the panel is not in its way.
    expect(esc.defaultPrevented).toBe(true);
  });

  it("is put away by its own button, and by the panel when it asks", async () => {
    await show(deckOf(slide("a", words("p", PAGE))), { pages: { pagePanel: Panel } });
    await act(async () => link("p").click());
    await act(async () => host.querySelector<HTMLElement>(".ks-show-panel-close")!.click());
    expect(host.querySelector(".ks-show-panel")).toBeNull();
    await act(async () => link("p").click());
    await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === "close it")!.click());
    expect(host.querySelector(".ks-show-panel")).toBeNull();
  });

  it("does nothing where the host has no panel", async () => {
    await show(deckOf(slide("a", words("p", PAGE))));
    await act(async () => link("p").click());
    expect(host.querySelector(".ks-show-panel")).toBeNull();
    expect(present()).toBe("a");
  });
});

describe("a link to the web", () => {
  it("opens in the host's way when it has one, else in a window that shares nothing with the slide", async () => {
    const openUrl = vi.fn();
    await show(deckOf(slide("a", words("w", "https://example.com/x"))), { pages: { openUrl } });
    await act(async () => link("w").click());
    expect(openUrl).toHaveBeenCalledWith("https://example.com/x");
    await act(async () => root.unmount());
    root = createRoot(host);
    const opened = vi.spyOn(window, "open").mockReturnValue(null);
    await show(deckOf(slide("a", words("w", "https://example.com/y"))));
    await act(async () => link("w").click());
    expect(opened).toHaveBeenCalledWith("https://example.com/y", "_blank", "noopener,noreferrer");
  });

  it("never follows what could run", async () => {
    const openUrl = vi.fn();
    const opened = vi.spyOn(window, "open").mockReturnValue(null);
    await show(deckOf(slide("a", words("w", "javascript:alert(1)"))), { pages: { openUrl } });
    const words1 = link("w");
    expect(words1.hasAttribute("tabindex")).toBe(false);
    await act(async () => words1.click());
    expect(openUrl).not.toHaveBeenCalled();
    expect(opened).not.toHaveBeenCalled();
  });
});
