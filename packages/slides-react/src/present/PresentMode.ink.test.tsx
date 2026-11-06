import type { Deck, Slide } from "@kasten-slides/wasm";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { plainDeck } from "../render/testing/decks.ts";
import { EDIT_MS } from "./useShowSync.ts";
import { PresentMode } from "./PresentMode.tsx";
import { type PresentMessage } from "./sync.ts";
import { echoBus } from "./wire.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const slide = (id: string, extra: Partial<Slide> = {}): Slide => ({ id, layout: "blank", elements: [], ...extra });
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
});

const wait = (ms = 30) => act(async () => void (await new Promise((done) => setTimeout(done, ms))));
const present = () => host.querySelector<HTMLElement>(".slides section.present:not(.stack)")?.getAttribute("data-slide");
const key = (name: string, keyCode: number) => act(async () => void document.dispatchEvent(new KeyboardEvent("keydown", { key: name, keyCode, bubbles: true, cancelable: true })));
const layer = () => host.querySelector<SVGSVGElement>(".ks-ink");

async function show(deck: Deck, props: Partial<Parameters<typeof PresentMode>[0]> = {}) {
  const onExit = vi.fn();
  const ui = (next: Deck) => <PresentMode deck={next} start={0} imageUrl={() => undefined} onExit={onExit} {...props} />;
  await act(async () => root.render(ui(deck)));
  await wait(60);
  return { onExit, again: (next: Deck) => act(async () => root.render(ui(next))) };
}

/** A pen stroke over the slide, from one corner of a 100 by 100 slide to the middle. */
async function stroke() {
  const svg = layer()!;
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
  const at = (type: string, x: number, y: number) => act(async () => void svg.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true })));
  await at("pointerdown", 10, 10);
  await at("pointermove", 50, 50);
  await at("pointerup", 50, 50);
}

describe("the pen in the show", () => {
  it("is picked up with P, draws, and is put down with Esc before the show would leave", async () => {
    const { onExit } = await show(deckOf(slide("a"), slide("b")));
    expect(layer()?.hasAttribute("data-active")).toBe(false);
    await key("p", 80);
    expect(layer()?.getAttribute("data-tool")).toBe("pen");
    await stroke();
    expect(host.querySelectorAll(".ks-ink-stroke[data-tool='pen']")).toHaveLength(1);
    await key("Escape", 27);
    expect(layer()?.hasAttribute("data-active")).toBe(false);
    expect(onExit).not.toHaveBeenCalled();
    // The ink stays; Esc again leaves.
    expect(host.querySelectorAll(".ks-ink-stroke")).toHaveLength(1);
    await key("Escape", 27);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("is a highlighter with H, and E clears the slide's ink", async () => {
    await show(deckOf(slide("a")));
    await key("h", 72);
    expect(layer()?.getAttribute("data-tool")).toBe("highlighter");
    await stroke();
    expect(host.querySelectorAll(".ks-ink-stroke[data-tool='highlighter']")).toHaveLength(1);
    await key("e", 69);
    expect(host.querySelectorAll(".ks-ink-stroke")).toHaveLength(0);
  });

  it("is not P for 'back a slide' in the show", async () => {
    await show(deckOf(slide("a"), slide("b")));
    await key("ArrowRight", 39);
    expect(present()).toBe("b");
    await key("p", 80);
    expect(present()).toBe("b");
  });

  it("goes with the slide by default", async () => {
    await show(deckOf(slide("a"), slide("b")));
    await key("p", 80);
    await stroke();
    await key("ArrowRight", 39);
    await wait();
    expect(host.querySelectorAll(".ks-ink-stroke")).toHaveLength(0);
    await key("ArrowLeft", 37);
    await wait();
    expect(host.querySelectorAll(".ks-ink-stroke")).toHaveLength(0);
  });

  it("stays on each slide when the person chose to keep ink, and the choice is remembered for the next show", async () => {
    await show(deckOf(slide("a"), slide("b")));
    await key("p", 80);
    const keep = [...host.querySelectorAll<HTMLButtonElement>(".ks-ink-tools button")].find((button) => button.textContent === "Keep ink")!;
    await act(async () => keep.click());
    expect(keep.getAttribute("aria-pressed")).toBe("true");
    await stroke();
    await key("ArrowRight", 39);
    await wait();
    expect(host.querySelectorAll(".ks-ink-stroke")).toHaveLength(0);
    await key("ArrowLeft", 37);
    await wait();
    expect(host.querySelectorAll(".ks-ink-stroke")).toHaveLength(1);
    expect(localStorage.getItem("ks-present-keep-ink")).toBe("on");
  });

  it("offers the colours, undo and clear only while a pen is in hand", async () => {
    await show(deckOf(slide("a")));
    expect(host.querySelector(".ks-ink-tools")).toBeNull();
    await key("p", 80);
    expect(host.querySelectorAll(".ks-ink-swatch")).toHaveLength(6);
    const undo = [...host.querySelectorAll<HTMLButtonElement>(".ks-ink-tools button")].find((button) => button.textContent === "Undo")!;
    expect(undo.disabled).toBe(true);
    await stroke();
    expect(undo.disabled).toBe(false);
    await act(async () => undo.click());
    expect(host.querySelectorAll(".ks-ink-stroke")).toHaveLength(0);
  });
});

describe("the white screen", () => {
  it("comes with W and goes with W", async () => {
    await show(deckOf(slide("a")));
    const white = () => host.querySelector<HTMLElement>(".ks-show-white");
    expect(white()?.hidden).toBe(true);
    await key("w", 87);
    expect(white()?.hidden).toBe(false);
    await key("w", 87);
    expect(white()?.hidden).toBe(true);
  });
});

describe("a deck edited while it is shown", () => {
  it("keeps the show where it is and goes on following reveal.js", async () => {
    const { again } = await show(deckOf(slide("a"), slide("b"), slide("c")));
    await key("ArrowRight", 39);
    await wait();
    expect(present()).toBe("b");
    await again(deckOf(slide("a"), slide("b", { notes: "edited" }), slide("c")));
    await wait(60);
    expect(present()).toBe("b");
    await key("ArrowRight", 39);
    await wait();
    expect(present()).toBe("c");
    // Moves are still told to the store the screen reads: the slide on the screen is drawn.
    expect(host.querySelector(".slides section.present .ks-show-slide")).not.toBeNull();
  });

  it("tells the presenter's window what changed a moment after the edits stop, and not the whole deck", async () => {
    const bus = echoBus();
    const presenter = bus.end("presenter");
    const heard: PresentMessage[] = [];
    presenter.subscribe((message) => heard.push(message));
    const { again } = await show(deckOf(slide("a"), slide("b")), { sync: bus.end("show") });
    expect(heard.filter((message) => message.type === "deck")).toHaveLength(1);
    await again(deckOf(slide("a", { notes: "1" }), slide("b")));
    await again(deckOf(slide("a", { notes: "12" }), slide("b")));
    await wait(EDIT_MS / 2);
    expect(heard.filter((message) => message.type === "edit")).toHaveLength(0);
    await wait(EDIT_MS + 100);
    const edits = heard.filter((message) => message.type === "edit");
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({ type: "edit", patch: { order: ["a", "b"], slides: [{ id: "a", notes: "12" }] } });
    expect(heard.filter((message) => message.type === "deck")).toHaveLength(1);
    // The same deck again is nothing new.
    await again(deckOf(slide("a", { notes: "12" }), slide("b")));
    await wait(EDIT_MS + 100);
    expect(heard.filter((message) => message.type === "edit")).toHaveLength(1);
  });
});

describe("a deck that loops or moves on by itself", () => {
  it("goes back to the first slide after the last when the deck says loop", async () => {
    const deck = deckOf(slide("a"), slide("b"));
    await show({ ...deck, present: { ...deck.present, loop: true } });
    await key("ArrowRight", 39);
    await wait();
    expect(present()).toBe("b");
    await key("ArrowRight", 39);
    await wait();
    expect(present()).toBe("a");
  });

  it("stops at the last slide when it does not", async () => {
    await show(deckOf(slide("a"), slide("b")));
    await key("ArrowRight", 39);
    await key("ArrowRight", 39);
    await wait();
    expect(present()).toBe("b");
  });
});
