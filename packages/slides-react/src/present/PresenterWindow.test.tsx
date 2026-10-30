import type { Deck, Slide } from "@kasten-slides/wasm";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { plainDeck } from "../render/testing/decks.ts";
import { PresenterWindow } from "./PresenterWindow.tsx";
import { type PresentMessage, type PresentSync } from "./sync.ts";
import { echoBus } from "./wire.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const slide = (id: string, extra: Partial<Slide> = {}): Slide => ({ id, layout: "blank", elements: [], ...extra });
const deckOf = (count: number): Deck => ({ ...plainDeck([]).deck, title: "The talk", slides: Array.from({ length: count }, (_, i) => slide(`s${i}`)) });

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  localStorage.clear();
});

afterEach(async () => {
  vi.useRealTimers();
  await act(async () => root.unmount());
  host.remove();
});

const render = (ui: React.ReactElement) => act(async () => root.render(ui));
const flush = () =>
  act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
const advance = (ms: number) => act(async () => void vi.advanceTimersByTime(ms));
const press = (key: string, init: KeyboardEventInit = {}) => act(async () => void window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })));
const text = (selector: string) => host.querySelector(selector)?.textContent?.replaceAll(/\s+/g, " ").trim();
const fact = (name: string) => text(`[data-fact="${name}"]`);
const buttons = () => [...host.querySelectorAll<HTMLButtonElement>(".ks-pv-controls button")];

/** The window that presents, as far as the presenter's window can tell: it gives the deck when asked, and follows and says where it is. */
function fakeShow(link: PresentSync, deck: Deck, since = 1) {
  let at = 0;
  const heard: PresentMessage[] = [];
  const show = {
    heard,
    /** The show has gone (its window was reloaded, or the talk ended): it answers nobody. */
    gone: false,
    at: () => at,
    deck: () => link.post({ type: "deck", deck, images: {}, state: { indexh: at, indexv: 0 }, since }),
    press(by: 1 | -1) {
      at = Math.min(Math.max(at + by, 0), deck.slides.length - 1);
      link.post({ type: "state", state: { indexh: at, indexv: 0 } });
    },
  };
  link.subscribe((message) => {
    heard.push(message);
    if (show.gone) return;
    if (message.type === "hello") show.deck();
    else if (message.type === "state") at = message.state.indexh;
  });
  return show;
}

describe("the presenter's window and the show it is joined to", () => {
  it("says it is waiting for the show until the deck comes", async () => {
    vi.useFakeTimers();
    const bus = echoBus();
    const asked = fakeAsks(bus);
    await render(<PresenterWindow sync={bus.end("presenter")} />);
    expect(text(".ks-presenter")).toContain("Waiting for the show…");
    await advance(3200);
    expect(asked()).toBeGreaterThanOrEqual(2);
  });

  it("goes back to waiting when the show says goodbye, and asks for a show again", async () => {
    vi.useFakeTimers();
    const bus = echoBus();
    const show = fakeShow(bus.end("show"), deckOf(3));
    await render(<PresenterWindow sync={bus.end("presenter")} />);
    await flush();
    expect(fact("slide")).toBe("Slide 1 / 3");
    show.heard.length = 0;
    show.gone = true;
    bus.end("other").post({ type: "bye" });
    await flush();
    expect(text(".ks-presenter")).toContain("Waiting for the show…");
    expect(host.querySelector(".ks-pv-body")).toBeNull();
    show.heard.length = 0;
    await advance(3200);
    expect(show.heard.filter((m) => m.type === "hello").length).toBeGreaterThanOrEqual(2);
    // A show begins again: the deck comes unasked, and it is shown.
    show.gone = false;
    show.press(1);
    show.deck();
    await flush();
    expect(fact("slide")).toBe("Slide 2 / 3");
  });

  it("goes back to waiting after 5 s without a beat from the show, and keeps going while the beats come", async () => {
    vi.useFakeTimers();
    const bus = echoBus();
    const link = bus.end("show");
    const show = fakeShow(link, deckOf(3));
    await render(<PresenterWindow sync={bus.end("presenter")} />);
    await flush();
    expect(fact("slide")).toBe("Slide 1 / 3");
    // A beat every 2 s keeps it for as long as they come.
    for (let i = 0; i < 10; i++) {
      await advance(2000);
      link.post({ type: "beat" });
      await flush();
    }
    expect(fact("slide")).toBe("Slide 1 / 3");
    // Then the show goes quiet (its window was reloaded, say).
    show.gone = true;
    await advance(4900);
    expect(fact("slide")).toBe("Slide 1 / 3");
    await advance(200);
    expect(text(".ks-presenter")).toContain("Waiting for the show…");
    // It asks again, and takes up with the show when that answers.
    show.heard.length = 0;
    await advance(1600);
    expect(show.heard.some((m) => m.type === "hello")).toBe(true);
    show.gone = false;
    show.deck();
    await flush();
    expect(fact("slide")).toBe("Slide 1 / 3");
  });

  it("counts a move of the show as a sign of life too", async () => {
    vi.useFakeTimers();
    const bus = echoBus();
    const link = bus.end("show");
    const show = fakeShow(link, deckOf(30));
    await render(<PresenterWindow sync={bus.end("presenter")} />);
    await flush();
    for (let i = 0; i < 5; i++) {
      await advance(4000);
      show.press(1);
      await flush();
    }
    expect(fact("slide")).toBe("Slide 6 / 30");
  });

  it("asks for the deck when it hears a beat and has none", async () => {
    vi.useFakeTimers();
    const bus = echoBus();
    const link = bus.end("show");
    const heard: string[] = [];
    link.subscribe((m) => heard.push(m.type));
    await render(<PresenterWindow sync={bus.end("presenter")} />);
    await flush();
    heard.length = 0;
    link.post({ type: "beat" });
    await flush();
    expect(heard).toEqual(["hello"]);
  });

  it("keeps the view of a rehearsal when the show ends, and says so, so that a run in it is not lost", async () => {
    vi.useFakeTimers();
    const bus = echoBus();
    const link = bus.end("show");
    const show = fakeShow(link, deckOf(3));
    await render(<PresenterWindow sync={bus.end("presenter")} />);
    await flush();
    link.post({ type: "rehearse" });
    show.gone = true;
    link.post({ type: "bye" });
    await flush();
    expect(text(".ks-pv-ended")).toBe("The presentation has ended.");
    expect(fact("slide")).toBe("Slide 1 / 3");
  });

  it("tells the show it is closing, once", async () => {
    const bus = echoBus();
    const link = bus.end("show");
    const show = fakeShow(link, deckOf(2));
    await render(<PresenterWindow sync={bus.end("presenter")} />);
    await flush();
    await act(async () => root.unmount());
    root = createRoot(host);
    expect(show.heard.filter((m) => m.type === "bye")).toHaveLength(1);
  });

  it("ignores a repeat of the deck it already has, and so is not drawn again or moved back", async () => {
    const bus = echoBus();
    const show = fakeShow(bus.end("show"), deckOf(5));
    await render(<PresenterWindow sync={bus.end("presenter")} />);
    await flush();
    await act(async () => void buttons()[1]?.click());
    await flush();
    expect(fact("slide")).toBe("Slide 2 / 5");
    show.deck();
    await flush();
    expect(fact("slide")).toBe("Slide 2 / 5");
  });
});

describe("the presenter's window keeps the two in step", () => {
  it("ends on the show's slide after 200 quick presses from both windows", async () => {
    const bus = echoBus();
    const show = fakeShow(bus.end("show"), deckOf(40));
    await render(<PresenterWindow sync={bus.end("presenter")} />);
    await flush();
    let seed = 11;
    const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let i = 0; i < 200; i++) {
      const by = random() < 0.6 ? 1 : -1;
      const fromShow = random() < 0.5;
      const together = random() < 0.3;
      await act(async () => {
        if (fromShow) show.press(by);
        else buttons()[by === 1 ? 1 : 0]?.click();
        if (together) {
          // The other window presses before it has heard of this press.
          if (fromShow) buttons()[random() < 0.5 ? 1 : 0]?.click();
          else show.press(random() < 0.5 ? 1 : -1);
        }
        if (random() < 0.5) for (let n = 0; n < 6; n++) await Promise.resolve();
      });
      // Every so often the words are all through, and the two must stand on the same slide: a split that a later press would only hide fails here.
      if (i % 10 === 9) {
        await flush();
        expect(fact("slide"), `after press ${i + 1}`).toBe(`Slide ${show.at() + 1} / 40`);
      }
    }
    await flush();
    expect(fact("slide")).toBe(`Slide ${show.at() + 1} / 40`);
  });

  it("ends on the show's slide after 200 presses of the key", async () => {
    const bus = echoBus();
    const show = fakeShow(bus.end("show"), deckOf(120));
    await render(<PresenterWindow sync={bus.end("presenter")} />);
    await flush();
    for (let i = 0; i < 200; i++) await press(i % 4 === 3 ? "ArrowLeft" : "ArrowRight");
    await flush();
    expect(show.at()).toBe(100);
    expect(fact("slide")).toBe("Slide 101 / 120");
  });
});

describe("the keys of the presenter's window drive the show", () => {
  it("Escape asks the show to end, and first puts away a number being typed", async () => {
    const bus = echoBus();
    const show = fakeShow(bus.end("show"), deckOf(5));
    await render(<PresenterWindow sync={bus.end("presenter")} />);
    await flush();
    await press("3");
    await press("Escape");
    await flush();
    expect(show.heard.some((m) => m.type === "end")).toBe(false);
    // One Escape says how to end the show; a second one does.
    await press("Escape");
    await flush();
    expect(show.heard.some((m) => m.type === "end")).toBe(false);
    expect(text(".ks-presenter")).toContain("Press Esc again to end the show");
    await press("Escape");
    await flush();
    expect(show.heard.filter((m) => m.type === "end")).toHaveLength(1);
    expect(text(".ks-presenter")).not.toContain("Press Esc again");
  });

  it("a lone Escape ends nothing: the second press has to come within two seconds", async () => {
    vi.useFakeTimers();
    const bus = echoBus();
    const show = fakeShow(bus.end("show"), deckOf(5));
    await render(<PresenterWindow sync={bus.end("presenter")} />);
    await flush();
    await press("Escape");
    await advance(2100);
    expect(text(".ks-presenter")).not.toContain("Press Esc again");
    await press("Escape");
    await flush();
    expect(show.heard.some((m) => m.type === "end")).toBe(false);
  });

  it("goes to a slide by its number with Enter", async () => {
    const bus = echoBus();
    const show = fakeShow(bus.end("show"), deckOf(12));
    await render(<PresenterWindow sync={bus.end("presenter")} />);
    await flush();
    await press("1");
    await press("0");
    expect(text(".ks-pv-jump")).toContain("10");
    await press("Enter");
    await flush();
    expect(show.at()).toBe(9);
    expect(fact("slide")).toBe("Slide 10 / 12");
    // A number that is no slide goes nowhere.
    await press("9");
    await press("9");
    await press("Enter");
    await flush();
    expect(show.at()).toBe(9);
  });

  it("puts the black screen up and down with B", async () => {
    const bus = echoBus();
    const show = fakeShow(bus.end("show"), deckOf(3));
    await render(<PresenterWindow sync={bus.end("presenter")} />);
    await flush();
    await press("b");
    await flush();
    expect(show.heard.filter((m) => m.type === "state" && m.state.paused === true)).toHaveLength(1);
  });

  it("pauses and resumes the timer with T, and starts it again with R", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 29, 10, 0, 0));
    const bus = echoBus();
    fakeShow(bus.end("show"), deckOf(3), Date.now());
    await render(<PresenterWindow sync={bus.end("presenter")} />);
    await flush();
    await advance(10_000);
    expect(fact("timer")).toContain("00:10");
    await press("t");
    await advance(10_000);
    expect(fact("timer")).toContain("00:10");
    await press("t");
    await advance(5_000);
    expect(fact("timer")).toContain("00:15");
    await press("r");
    expect(fact("timer")).toContain("00:00");
    await advance(3_000);
    expect(fact("timer")).toContain("00:03");
  });
});

/** Counts how many times the presenter's window asked for a deck on a bus. */
function fakeAsks(bus: ReturnType<typeof echoBus>): () => number {
  let asked = 0;
  bus.end("listener").subscribe((m) => {
    if (m.type === "hello") asked += 1;
  });
  return () => asked;
}
