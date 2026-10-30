import type { Deck, Slide } from "@kasten-slides/wasm";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { plainDeck } from "../render/testing/decks.ts";
import { PresenterWindow } from "./PresenterWindow.tsx";
import type { PresentSync } from "./sync.ts";
import { echoBus } from "./wire.ts";

// The presenter's window counts the moves of the show (the higher number wins). A show that begins again (its window was reloaded, or
// the talk was started anew) counts from nothing: the presenter's window must take up with it whatever number the last one reached.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const slide = (id: string): Slide => ({ id, layout: "blank", elements: [] });
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
const fact = (name: string) => host.querySelector(`[data-fact="${name}"]`)?.textContent?.replaceAll(/\s+/g, " ").trim();
const buttons = () => [...host.querySelectorAll<HTMLButtonElement>(".ks-pv-controls button")];

/** A show over `link`: it answers `hello` with its deck, follows the presenter, and says where it is when its person presses. */
function show(link: PresentSync, deck: Deck, since: number) {
  let at = 0;
  const me = {
    gone: false,
    at: () => at,
    deck: () => link.post({ type: "deck", deck, images: {}, state: { indexh: at, indexv: 0 }, since }),
    press(by: 1 | -1) {
      at = Math.min(Math.max(at + by, 0), deck.slides.length - 1);
      link.post({ type: "state", state: { indexh: at, indexv: 0 } });
    },
  };
  link.subscribe((message) => {
    if (me.gone) return;
    if (message.type === "hello") me.deck();
    else if (message.type === "state") at = message.state.indexh;
  });
  return me;
}

describe("a show that begins again counts from nothing, and is heard", () => {
  it("takes up with a new show after the old one went quiet (the show's window was reloaded)", async () => {
    vi.useFakeTimers();
    const bus = echoBus();
    const first = show(bus.end("show-1"), deckOf(60), 1);
    await render(<PresenterWindow sync={bus.end("presenter")} />);
    await flush();
    // The first show goes far: its numbers run up to 40 and more.
    for (let i = 0; i < 40; i++) first.press(1);
    await flush();
    expect(fact("slide")).toBe("Slide 41 / 60");
    first.gone = true;
    await advance(5200);
    expect(host.textContent).toContain("Waiting for the show…");
    // A new show: a new link that counts from nothing. It answers the next ask with its deck.
    const second = show(bus.end("show-2"), deckOf(60), 2);
    await advance(1600);
    await flush();
    expect(fact("slide")).toBe("Slide 1 / 60");
    for (let i = 0; i < 3; i++) second.press(1);
    await flush();
    expect(fact("slide")).toBe("Slide 4 / 60");
    // And the presenter's window drives it in turn.
    await act(async () => void buttons()[1]?.click());
    await flush();
    expect(second.at()).toBe(4);
    second.press(1);
    await flush();
    expect(fact("slide")).toBe("Slide 6 / 60");
  });

  it("takes up with a new show that begins at once, with no time to be taken for gone", async () => {
    vi.useFakeTimers();
    const bus = echoBus();
    const first = show(bus.end("show-1"), deckOf(60), 1);
    await render(<PresenterWindow sync={bus.end("presenter")} />);
    await flush();
    for (let i = 0; i < 40; i++) first.press(1);
    await flush();
    first.gone = true;
    const second = show(bus.end("show-2"), deckOf(60), 2);
    // Its first moves come before its deck (a show begins with the position, then introduces itself): they are late news and are let go.
    second.press(1);
    second.press(1);
    second.deck();
    await flush();
    expect(fact("slide")).toBe("Slide 3 / 60");
    second.press(1);
    await flush();
    expect(fact("slide")).toBe("Slide 4 / 60");
  });

  it("takes up with a new show after the old one said goodbye", async () => {
    vi.useFakeTimers();
    const bus = echoBus();
    const link = bus.end("show-1");
    const first = show(link, deckOf(60), 1);
    await render(<PresenterWindow sync={bus.end("presenter")} />);
    await flush();
    for (let i = 0; i < 40; i++) first.press(1);
    await flush();
    // It says goodbye and answers nobody after.
    first.gone = true;
    link.post({ type: "bye" });
    await flush();
    expect(host.textContent).toContain("Waiting for the show…");
    const second = show(bus.end("show-2"), deckOf(60), 2);
    second.press(1);
    second.deck();
    await flush();
    expect(fact("slide")).toBe("Slide 2 / 60");
    second.press(1);
    await flush();
    expect(fact("slide")).toBe("Slide 3 / 60");
  });

  it("a rehearsal's mark does not stay for the next talk: that one, when it ends, sends the window back to waiting", async () => {
    vi.useFakeTimers();
    const bus = echoBus();
    const link = bus.end("show-1");
    const first = show(link, deckOf(5), 1);
    await render(<PresenterWindow sync={bus.end("presenter")} />);
    await flush();
    link.post({ type: "rehearse" });
    await flush();
    // A rehearsal keeps its view when the show goes.
    first.gone = true;
    link.post({ type: "bye" });
    await flush();
    expect(fact("slide")).toBe("Slide 1 / 5");
    // A new talk that is no rehearsal.
    const second = show(bus.end("show-2"), deckOf(5), 2);
    second.deck();
    await flush();
    expect(fact("slide")).toBe("Slide 1 / 5");
    second.gone = true;
    await advance(5200);
    expect(host.textContent).toContain("Waiting for the show…");
  });

  it("follows a new show that gives a deck with the same start time the old one had", async () => {
    // The start time is the talk's name for the presenter's window; the order must still start again at a deck.
    vi.useFakeTimers();
    const bus = echoBus();
    const first = show(bus.end("show-1"), deckOf(60), 7);
    await render(<PresenterWindow sync={bus.end("presenter")} />);
    await flush();
    for (let i = 0; i < 40; i++) first.press(1);
    await flush();
    first.gone = true;
    const second = show(bus.end("show-2"), deckOf(60), 7);
    second.deck();
    second.press(1);
    second.press(1);
    await flush();
    expect(fact("slide")).toBe("Slide 3 / 60");
  });

  it("is taken up by a show that ran long when the presenter's window is made again (its clock starts from nothing)", async () => {
    vi.useFakeTimers();
    const bus = echoBus();
    const running = show(bus.end("show"), deckOf(80), 1);
    await render(<PresenterWindow sync={bus.end("presenter-1")} />);
    await flush();
    for (let i = 0; i < 50; i++) running.press(1);
    await flush();
    await act(async () => root.unmount());
    root = createRoot(host);
    await render(<PresenterWindow sync={bus.end("presenter-2")} />);
    await flush();
    expect(fact("slide")).toBe("Slide 51 / 80");
    // Its first press has a small number; the show, whose numbers are large, must still take it.
    await act(async () => void buttons()[1]?.click());
    await flush();
    expect(running.at()).toBe(51);
    running.press(1);
    await flush();
    expect(fact("slide")).toBe("Slide 53 / 80");
    await act(async () => void buttons()[0]?.click());
    await flush();
    expect(running.at()).toBe(51);
  });
});
