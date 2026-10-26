import type { Deck } from "@kasten-slides/wasm";
import { describe, expect, it } from "vitest";

import { echoBus, echoingPair } from "./wire.ts";
import { type PresentMessage, type PresentSync } from "./sync.ts";

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

/** The tiny model of a window: a slide number that follows the other window, and moves when its person presses a key. */
class Window {
  at = 0;
  /** Every position this window was moved to by the other one. */
  moved: number[] = [];
  constructor(
    readonly link: PresentSync,
    readonly mark: number,
    readonly length: number,
  ) {
    link.subscribe((message) => {
      if (message.type !== "state") return;
      this.at = message.state.indexh;
      this.moved.push(message.state.indexh);
      this.heard.push(message.state.indexv);
    });
  }
  heard: number[] = [];
  /** A press of next (+1) or back (-1). `indexv` carries which window said it, so a window can see its own words come back. */
  press(by: 1 | -1): void {
    this.at = Math.min(Math.max(this.at + by, 0), this.length - 1);
    this.link.post({ type: "state", state: { indexh: this.at, indexv: this.mark } });
  }
}

/** A small seeded generator, so a run that fails can be run again. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

describe("an echoing link, which gives each window the words of both", () => {
  it("never gives a window its own words back", async () => {
    const [a, b] = echoingPair();
    const heard: PresentMessage[] = [];
    a.subscribe((m) => heard.push(m));
    b.subscribe(() => {});
    a.post({ type: "hello" });
    a.post({ type: "state", state: { indexh: 1, indexv: 0 } });
    b.post({ type: "state", state: { indexh: 2, indexv: 0 } });
    await flush();
    expect(heard).toEqual([{ type: "state", state: { indexh: 2, indexv: 0 } }]);
  });

  it("passes what one says to the other", async () => {
    const [a, b] = echoingPair();
    const heard: string[] = [];
    b.subscribe((m) => heard.push(m.type));
    a.post({ type: "hello" });
    a.post({ type: "beat" });
    a.post({ type: "end" });
    await flush();
    expect(heard).toEqual(["hello", "beat", "end"]);
  });

  it("goes quiet when closed", async () => {
    const [a, b] = echoingPair();
    const heard: string[] = [];
    b.subscribe((m) => heard.push(m.type));
    b.close();
    a.post({ type: "hello" });
    await flush();
    expect(heard).toEqual([]);
  });

  it("takes a word from the core, which comes with no name on it", async () => {
    // The core says "bye" for a window that was closed; nothing in it tells who said it.
    const bus = echoBus();
    const heard: string[] = [];
    bus.end("a").subscribe((m) => heard.push(m.type));
    bus.inject({ type: "bye" });
    bus.inject({ type: "state", state: { indexh: 1, indexv: 0 } });
    bus.inject({ type: "run" });
    await flush();
    expect(heard).toEqual(["bye", "state"]);
  });

  it("ends both windows on the same slide after 200 quick presses from both sides", async () => {
    const [a, b] = echoingPair();
    const length = 30;
    const one = new Window(a, 1, length);
    const two = new Window(b, 2, length);
    const next = random(7);
    for (let i = 0; i < 200; i++) {
      const by = next() < 0.6 ? 1 : -1;
      // Some presses come in the same instant on both sides, before either has heard of the other's.
      const both = next() < 0.4;
      (next() < 0.5 ? one : two).press(by);
      if (both) (next() < 0.5 ? two : one).press(next() < 0.5 ? 1 : -1);
      // Now and then the words get through; they are not always so slow.
      if (next() < 0.3) await flush();
      // Whenever the words are all through, the two stand on the same slide (a split that a later press hides is a split all the same).
      if (i % 10 === 9) {
        await flush();
        expect(one.at, `after press ${i + 1}`).toBe(two.at);
      }
    }
    await flush();
    expect(one.at).toBe(two.at);
    // A window heard only the other's words: never its own.
    expect(one.heard.every((mark) => mark === 2)).toBe(true);
    expect(two.heard.every((mark) => mark === 1)).toBe(true);
  });

  it("ends on the same slide when one window presses 200 times without waiting", async () => {
    const [a, b] = echoingPair();
    const one = new Window(a, 1, 300);
    const two = new Window(b, 2, 300);
    for (let i = 0; i < 200; i++) one.press(1);
    await flush();
    expect(one.at).toBe(200);
    expect(two.at).toBe(200);
    // The other window was brought along step by step and is never sent back.
    expect(two.moved).toEqual([...two.moved].sort((x, y) => x - y));
  });

  it("hears the first words of a talk that begins again in a window that was reloaded (its clock starts from nothing)", async () => {
    const bus = echoBus();
    const presenter = bus.end("presenter");
    const heard: number[] = [];
    presenter.subscribe((m) => m.type === "state" && heard.push(m.state.indexh));
    // The first show says a lot; the clocks run far on.
    const first = bus.end("show");
    first.subscribe(() => {});
    for (let i = 0; i < 20; i++) first.post({ type: "state", state: { indexh: i, indexv: 0 } });
    await flush();
    expect(heard.at(-1)).toBe(19);
    // The page is reloaded and a new show begins: a new link, and it starts by giving the deck.
    first.close();
    const second = bus.end("show");
    second.post({ type: "deck", deck: { slides: [] } as unknown as Deck, images: {}, state: { indexh: 0, indexv: 0 }, since: 5 });
    second.post({ type: "state", state: { indexh: 3, indexv: 0 } });
    await flush();
    expect(heard.at(-1)).toBe(3);
  });

  it("hears a window again after it said goodbye", async () => {
    const bus = echoBus();
    const presenter = bus.end("presenter");
    const show = bus.end("show");
    const heard: number[] = [];
    presenter.subscribe((m) => m.type === "state" && heard.push(m.state.indexh));
    for (let i = 0; i < 10; i++) show.post({ type: "state", state: { indexh: i, indexv: 0 } });
    show.post({ type: "bye" });
    const again = bus.end("show");
    again.post({ type: "state", state: { indexh: 1, indexv: 0 } });
    await flush();
    expect(heard.at(-1)).toBe(1);
  });
});
