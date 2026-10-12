import type { Deck, Slide } from "@kasten-slides/wasm";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { plainDeck } from "../render/testing/decks.ts";
import { PresentMode } from "./PresentMode.tsx";
import { memorySyncPair } from "./sync.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const slide = (id: string, extra: Partial<Slide> = {}): Slide => ({ id, layout: "blank", elements: [], ...extra });
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
});

const wait = (ms = 30) => act(async () => void (await new Promise((done) => setTimeout(done, ms))));
const key = (code: number, name: string, init: KeyboardEventInit = {}) => act(async () => void document.dispatchEvent(new KeyboardEvent("keydown", { key: name, keyCode: code, bubbles: true, cancelable: true, ...init })));
const present = () => host.querySelector<HTMLElement>(".slides section.present:not(.stack)")?.getAttribute("data-slide");

async function show(deck: Deck, props: Partial<Parameters<typeof PresentMode>[0]> = {}) {
  const onExit = vi.fn();
  await act(async () => root.render(<PresentMode deck={deck} start={0} imageUrl={() => undefined} onExit={onExit} {...props} />));
  await wait(60);
  return onExit;
}

describe("presenting a deck of another shape", () => {
  const stage = () => host.querySelector<HTMLElement>(".ks-show")!;

  it("sets reveal.js to the deck's own size, so the slide is whole and centred whatever the screen is", async () => {
    const deck = { ...deckOf(slide("a")), size: { w: 960, h: 720 } };
    await show(deck);
    expect(host.querySelector<HTMLElement>(".slides")?.style.width).toBe("960px");
    expect(host.querySelector<HTMLElement>(".slides")?.style.height).toBe("720px");
    const square = { ...deckOf(slide("a")), size: { w: 720, h: 720 } };
    await act(async () => root.unmount());
    root = createRoot(host);
    await show(square);
    expect(host.querySelector<HTMLElement>(".slides")?.style.width).toBe("720px");
    expect(host.querySelector<HTMLElement>(".slides")?.style.height).toBe("720px");
  });

  it("has black round the slide unless another colour was chosen, and says which", async () => {
    await show(deckOf(slide("a")));
    expect(stage().dataset.matte).toBe("black");
    expect(stage().style.getPropertyValue("--ks-show-matte")).toBe("#000000");
  });

  it("takes the theme's background or its dark colour as the matte when asked", async () => {
    const deck = deckOf(slide("a"));
    const { bg1, text1 } = deck.theme.colors;
    await show(deck, { matte: "paper" });
    expect(stage().dataset.matte).toBe("paper");
    expect(stage().style.getPropertyValue("--ks-show-matte")).toBe(bg1);
    await act(async () => root.unmount());
    root = createRoot(host);
    await show(deck, { matte: "dark" });
    expect([bg1, text1]).toContain(stage().style.getPropertyValue("--ks-show-matte"));
  });
});

describe("presenting in reveal.js", () => {
  it("shows the first slide, and moves through the slides and their steps with the keys", async () => {
    await show(deckOf(slide("a"), slide("b", { steps: 2 }), slide("c")));
    expect(present()).toBe("a");
    await key(39, "ArrowRight");
    expect(present()).toBe("b");
    await key(39, "ArrowRight");
    expect(host.querySelector('[data-slide="b"]')?.getAttribute("data-fragment")).toBe("0");
    await key(32, " ");
    await key(39, "ArrowRight");
    expect(present()).toBe("c");
    await key(37, "ArrowLeft");
    expect(present()).toBe("b");
    expect(host.querySelector('[data-slide="b"]')?.getAttribute("data-fragment")).toBe("1");
  });

  it("begins at the slide asked for, and skips hidden slides", async () => {
    await show(deckOf(slide("a"), slide("h", { hidden: true }), slide("c"), slide("d")), { start: 2 });
    expect(present()).toBe("c");
    await key(37, "ArrowLeft");
    expect(present()).toBe("a");
    expect(host.querySelector('[data-slide="h"]')).toBeNull();
  });

  it("puts backup slides in a stack: down goes into it, right skips it", async () => {
    await show(deckOf(slide("a"), slide("a2", { backup: true }), slide("b")));
    expect(host.querySelectorAll(".slides > section.stack")).toHaveLength(1);
    await key(40, "ArrowDown");
    expect(present()).toBe("a2");
    await key(38, "ArrowUp");
    expect(present()).toBe("a");
    await key(39, "ArrowRight");
    expect(present()).toBe("b");
  });

  it("draws the slides near the one on the screen, and each slide at its own step", async () => {
    const shape = (id: string, hiddenUntil: number) => ({ type: "shape", id, shape: "rect", x: 0, y: 0, w: 10, h: 10, stepStates: { 0: "hidden", [hiddenUntil]: "normal" } }) as unknown as Slide["elements"][number];
    await show(deckOf(slide("a", { steps: 2, elements: [shape("one", 1), shape("two", 2)] }), slide("b")));
    const seen = () => [...host.querySelectorAll('[data-slide="a"] [data-el]')].map((n) => n.getAttribute("data-el"));
    expect(seen()).toEqual([]);
    await key(39, "ArrowRight");
    expect(seen()).toEqual(["one"]);
    await key(39, "ArrowRight");
    expect(seen()).toEqual(["one", "two"]);
    await key(39, "ArrowRight");
    expect(present()).toBe("b");
    // A slide behind is done.
    expect(seen()).toEqual(["one", "two"]);
    await key(37, "ArrowLeft");
    await key(37, "ArrowLeft");
    await key(37, "ArrowLeft");
    expect(seen()).toEqual([]);
  });

  it("leaves on Esc, and Esc first puts away the overview", async () => {
    const onExit = await show(deckOf(slide("a"), slide("b")));
    await key(79, "o");
    expect(host.querySelector(".reveal.overview")).not.toBeNull();
    await key(27, "Escape");
    expect(host.querySelector(".reveal.overview")).toBeNull();
    expect(onExit).not.toHaveBeenCalled();
    await key(27, "Escape");
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("goes to a slide by its number", async () => {
    await show(deckOf(slide("a"), slide("b"), slide("c"), slide("d")));
    await key(51, "3");
    await key(13, "Enter");
    expect(present()).toBe("c");
  });

  it("puts up the black screen with B", async () => {
    await show(deckOf(slide("a")));
    await key(66, "b");
    expect(host.querySelector(".reveal.paused")).not.toBeNull();
    await key(66, "b");
    expect(host.querySelector(".reveal.paused")).toBeNull();
  });

  it("names how each slide arrives, and gives a morph the id that pairs it with the one before", async () => {
    await show(deckOf(slide("a"), slide("b", { transition: { kind: "fade", duration: 1 } }), slide("c", { transition: { kind: "morph", duration: 0.8 } })));
    const attrs = (id: string) => {
      const section = host.querySelector(`[data-slide="${id}"]`);
      return { transition: section?.getAttribute("data-transition"), animate: section?.hasAttribute("data-auto-animate"), id: section?.getAttribute("data-auto-animate-id"), duration: section?.getAttribute("data-auto-animate-duration") };
    };
    expect(attrs("a")).toMatchObject({ transition: "none", animate: false });
    expect(attrs("b")).toMatchObject({ transition: "fade", animate: true, id: "morph-b" });
    expect(attrs("c")).toMatchObject({ transition: "fade", animate: true, id: "morph-b", duration: "0.8" });
  });

  it("follows the presenter's window, and tells it where the audience is", async () => {
    const [mine, theirs] = memorySyncPair();
    const heard: string[] = [];
    theirs.subscribe((m) => heard.push(m.type + (m.type === "state" ? `:${m.state.indexh}` : "")));
    await show(deckOf(slide("a"), slide("b"), slide("c")), { sync: mine });
    await wait();
    expect(heard).toContain("deck");
    await key(39, "ArrowRight");
    await wait();
    expect(heard).toContain("state:1");
    theirs.post({ type: "state", state: { indexh: 2, indexv: 0 } });
    await wait();
    expect(present()).toBe("c");
    // What it applied was not said back.
    expect(heard.filter((h) => h === "state:2")).toHaveLength(0);
  });
});
