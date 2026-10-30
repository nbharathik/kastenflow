import type { Deck, Slide } from "@kasten-slides/wasm";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { plainDeck } from "../render/testing/decks.ts";
import { PresentMode } from "./PresentMode.tsx";
import { echoBus } from "./wire.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const slide = (id: string): Slide => ({ id, layout: "blank", elements: [] });
const deckOf = (...slides: Slide[]): Deck => ({ ...plainDeck([]).deck, slides });

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  vi.useRealTimers();
  await act(async () => root.unmount());
  host.remove();
});

const wait = (ms = 30) => act(async () => void (await new Promise((done) => setTimeout(done, ms))));
const present = () => host.querySelector<HTMLElement>(".slides section.present:not(.stack)")?.getAttribute("data-slide");

async function show(deck: Deck, props: Partial<Parameters<typeof PresentMode>[0]> = {}) {
  const onExit = vi.fn();
  await act(async () => root.render(<PresentMode deck={deck} start={0} imageUrl={() => undefined} onExit={onExit} {...props} />));
  await wait(60);
  return onExit;
}

describe("the show keeps the presenter's window in touch", () => {
  it("sends the deck when it starts, then a beat every 2 s for as long as the show is up, and none after it", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const bus = echoBus();
    const heard: string[] = [];
    bus.end("presenter").subscribe((m) => heard.push(m.type));
    await show(deckOf(slide("a"), slide("b")), { sync: bus.end("show") });
    expect(heard.filter((type) => type === "deck")).toHaveLength(1);
    expect(heard.filter((type) => type === "beat")).toHaveLength(0);
    await act(async () => void vi.advanceTimersByTime(2000));
    expect(heard.filter((type) => type === "beat")).toHaveLength(1);
    await act(async () => void vi.advanceTimersByTime(4000));
    expect(heard.filter((type) => type === "beat")).toHaveLength(3);
    await act(async () => root.unmount());
    root = createRoot(host);
    await act(async () => void vi.advanceTimersByTime(10_000));
    expect(heard.filter((type) => type === "beat")).toHaveLength(3);
  });

  it("gives the deck again to a window that asks, and says nothing larger than a position after that", async () => {
    const bus = echoBus();
    const presenter = bus.end("presenter");
    const heard: string[] = [];
    presenter.subscribe((m) => heard.push(m.type));
    await show(deckOf(slide("a"), slide("b")), { sync: bus.end("show") });
    presenter.post({ type: "hello" });
    await wait();
    expect(heard.filter((type) => type === "deck")).toHaveLength(2);
    heard.length = 0;
    presenter.post({ type: "state", state: { indexh: 1, indexv: 0 } });
    await wait();
    expect(present()).toBe("b");
    expect(heard).toEqual([]);
  });

  it("leaves when the presenter's window says to end the show", async () => {
    const bus = echoBus();
    const presenter = bus.end("presenter");
    const onExit = await show(deckOf(slide("a")), { sync: bus.end("show") });
    expect(onExit).not.toHaveBeenCalled();
    presenter.post({ type: "end" });
    await wait();
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("does not jump back to its own old position when the link gives it its own words", async () => {
    const bus = echoBus();
    // The core's old way: every window hears every word, its own among them.
    const presenter = bus.end("presenter");
    const state: number[] = [];
    presenter.subscribe((m) => m.type === "state" && state.push(m.state.indexh));
    await show(deckOf(slide("a"), slide("b"), slide("c")), { sync: bus.end("show") });
    for (const code of [39, 39]) await act(async () => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", keyCode: code, bubbles: true, cancelable: true })));
    await wait();
    expect(present()).toBe("c");
    expect(state.at(-1)).toBe(2);
  });
});
