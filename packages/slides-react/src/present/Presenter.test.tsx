import type { Deck, Slide } from "@kasten-slides/wasm";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { plainDeck } from "../render/testing/decks.ts";
import { Presenter, elapsedText, moveOfKey, stepText } from "./Presenter.tsx";
import { PresenterWindow, presenterOf } from "./PresenterWindow.tsx";
import { type Position } from "./plan.ts";
import { type PresentMessage, memorySyncPair } from "./sync.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const slide = (id: string, extra: Partial<Slide> = {}): Slide => ({ id, layout: "blank", elements: [], ...extra });
const deckOf = (...slides: Slide[]): Deck => ({ ...plainDeck([]).deck, title: "The talk", slides });

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
const press = (key: string, init: KeyboardEventInit = {}) => act(async () => void window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })));
const text = (selector: string) => host.querySelector(selector)?.textContent?.replaceAll(/\s+/g, " ").trim();
const fact = (name: string) => text(`[data-fact="${name}"]`);

describe("the presenter's view", () => {
  const deck = deckOf(slide("a", { notes: "Say **hello**" }), slide("b", { steps: 3, notes: "- one\n- two" }), slide("c"));
  const view = (position: Position, extra: Partial<Parameters<typeof Presenter>[0]> = {}) => (
    <Presenter deck={deck} imageUrl={() => undefined} position={position} paused={false} since={Date.now()} onGo={() => {}} {...extra} />
  );

  it("shows which slide, how many steps of it, and the deck's name", async () => {
    await render(view({ h: 1, v: 0, f: 0 }));
    expect(text(".ks-pv-title")).toBe("The talk");
    expect(fact("slide")).toBe("Slide 2 / 3");
    expect(fact("step")).toBe("Step 1 / 3");
    await render(view({ h: 0, v: 0, f: -1 }));
    expect(fact("step")).toBe("No steps");
  });

  it("shows the speaker notes of the slide, as they are written", async () => {
    await render(view({ h: 0, v: 0, f: -1 }));
    expect(host.querySelector(".ks-pv-notes-text strong")?.textContent).toBe("hello");
    await render(view({ h: 1, v: 0, f: -1 }));
    expect([...host.querySelectorAll(".ks-pv-notes-text li")].map((li) => li.textContent)).toEqual(["one", "two"]);
    await render(view({ h: 2, v: 0, f: -1 }));
    expect(text(".ks-pv-notes-text")).toBe("No notes on this slide.");
  });

  it("shows the slide now at its step, and what comes next: the next step, else the next slide, else the end", async () => {
    await render(view({ h: 1, v: 0, f: 0 }));
    expect(text(".ks-pv-next .ks-pv-heading")).toBe("Next step");
    await render(view({ h: 1, v: 0, f: 2 }));
    expect(text(".ks-pv-next .ks-pv-heading")).toBe("Next slide");
    await render(view({ h: 2, v: 0, f: -1 }));
    expect(text(".ks-pv-next .ks-pv-heading")).toBe("End of the talk");
    expect(host.querySelector(".ks-pv-next .ks-show-scroll-frame")).toBeNull();
  });

  it("asks for a move with the keys, the arrows, space, the page keys, N and P, and Home and End", async () => {
    const onGo = vi.fn();
    await render(view({ h: 1, v: 0, f: -1 }, { onGo }));
    await press("ArrowRight");
    await press("PageDown");
    await press(" ");
    await press("ArrowLeft");
    await press(" ", { shiftKey: true });
    await press("Home");
    await press("End");
    expect(onGo.mock.calls.map(([position]) => position)).toEqual([
      { h: 1, v: 0, f: 0 },
      { h: 1, v: 0, f: 0 },
      { h: 1, v: 0, f: 0 },
      { h: 0, v: 0, f: -1 },
      { h: 0, v: 0, f: -1 },
      { h: 0, v: 0, f: -1 },
      { h: 2, v: 0, f: -1 },
    ]);
  });

  it("makes down and up step like right and left in a deck without backup slides", async () => {
    const onGo = vi.fn();
    await render(view({ h: 0, v: 0, f: -1 }, { onGo }));
    await press("ArrowDown");
    expect(onGo).toHaveBeenLastCalledWith({ h: 1, v: 0, f: -1 });
  });

  it("asks for the black screen with B and its button, and says how to take it away", async () => {
    const onGo = vi.fn();
    await render(view({ h: 0, v: 0, f: -1 }, { onGo }));
    await press("b");
    expect(onGo).toHaveBeenLastCalledWith({ h: 0, v: 0, f: -1 }, true);
    await render(view({ h: 0, v: 0, f: -1 }, { onGo, paused: true }));
    expect(text(".ks-pv-controls button[aria-pressed]")).toBe("Show the slide");
    host.querySelector<HTMLButtonElement>(".ks-pv-controls button[aria-pressed]")?.click();
    expect(onGo).toHaveBeenLastCalledWith({ h: 0, v: 0, f: -1 }, false);
  });

  it("has buttons for next and back, off where there is nowhere to go", async () => {
    const onGo = vi.fn();
    await render(view({ h: 0, v: 0, f: -1 }, { onGo }));
    const [back, next] = [...host.querySelectorAll<HTMLButtonElement>(".ks-pv-controls button")];
    expect(back?.disabled).toBe(true);
    expect(next?.disabled).toBe(false);
    next?.click();
    expect(onGo).toHaveBeenCalledWith({ h: 1, v: 0, f: -1 });
  });

  it("changes the size of the notes with Ctrl + and Ctrl -, and keeps it", async () => {
    await render(view({ h: 0, v: 0, f: -1 }));
    const size = () => host.querySelector<HTMLElement>(".ks-pv-notes-text")?.style.fontSize;
    expect(size()).toBe("18px");
    await press("+", { ctrlKey: true });
    expect(size()).toBe("20px");
    await press("=", { metaKey: true });
    expect(size()).toBe("24px");
    await press("-", { ctrlKey: true });
    await press("-", { ctrlKey: true });
    await press("-", { ctrlKey: true });
    expect(size()).toBe("16px");
    expect(localStorage.getItem("kasten-slides-presenter-notes-size")).toBe("16");
    await press("0", { ctrlKey: true });
    expect(size()).toBe("18px");
    // It comes back as it was left.
    await press("+", { ctrlKey: true });
    await act(async () => root.unmount());
    root = createRoot(host);
    await render(view({ h: 0, v: 0, f: -1 }));
    expect(size()).toBe("20px");
  });

  it("does not let the browser zoom the page on Ctrl +", async () => {
    await render(view({ h: 0, v: 0, f: -1 }));
    const event = new KeyboardEvent("keydown", { key: "+", ctrlKey: true, cancelable: true });
    await act(async () => void window.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
  });

  it("times the talk, and starts the time again", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 29, 10, 0, 0));
    const since = Date.now();
    await render(view({ h: 0, v: 0, f: -1 }, { since }));
    expect(fact("timer")).toContain("00:00");
    await act(async () => void vi.advanceTimersByTime(65_000));
    expect(fact("timer")).toContain("01:05");
    expect(fact("clock")).toBe("10:01");
    [...host.querySelectorAll<HTMLButtonElement>(".ks-pv-timer button")].find((b) => b.textContent === "Reset")?.click();
    await act(async () => void vi.advanceTimersByTime(2000));
    expect(fact("timer")).toContain("00:02");
  });

  it("has a Close button only when it can close", async () => {
    await render(view({ h: 0, v: 0, f: -1 }));
    expect(host.querySelector(".ks-pv-head > .ks-pv-button")).toBeNull();
    const onClose = vi.fn();
    await render(view({ h: 0, v: 0, f: -1 }, { onClose }));
    host.querySelector<HTMLButtonElement>(".ks-pv-head > .ks-pv-button")?.click();
    expect(onClose).toHaveBeenCalled();
  });
});

describe("the words of the view", () => {
  it("time as minutes and seconds, and hours once there are some", () => {
    expect(elapsedText(0)).toBe("00:00");
    expect(elapsedText(59_999)).toBe("00:59");
    expect(elapsedText(61_000)).toBe("01:01");
    expect(elapsedText(3_600_000 + 125_000)).toBe("1:02:05");
    expect(elapsedText(-5)).toBe("00:00");
  });

  it("word the step as the deck does", () => {
    expect(stepText({ ...plainDeck([]).deck, present: { slideNumbers: true, stepLabel: "{n} of {total}" } }, 2, 5)).toBe("2 of 5");
  });

  it("know the keys of the view", () => {
    expect(moveOfKey({ key: "ArrowRight", shiftKey: false })).toBe("right");
    expect(moveOfKey({ key: " ", shiftKey: true })).toBe("left");
    expect(moveOfKey({ key: "q", shiftKey: false })).toBeNull();
  });
});

describe("the presenter's window", () => {
  const deck = deckOf(slide("a", { notes: "First" }), slide("b", { steps: 2 }));

  it("asks for the deck until it gets it, then shows it where the audience is", async () => {
    vi.useFakeTimers();
    const [mine, theirs] = memorySyncPair();
    const asked: string[] = [];
    theirs.subscribe((m) => asked.push(m.type));
    await render(<PresenterWindow sync={mine} />);
    expect(text(".ks-presenter")).toContain("Waiting for the show");
    await act(async () => void vi.advanceTimersByTime(3200));
    expect(asked.filter((t) => t === "hello").length).toBeGreaterThanOrEqual(2);
    theirs.post({ type: "deck", deck, images: {}, state: { indexh: 1, indexv: 0, indexf: 0 }, since: Date.now() });
    await act(async () => void (await Promise.resolve()));
    await act(async () => void vi.advanceTimersByTime(10));
    expect(fact("slide")).toBe("Slide 2 / 2");
    expect(fact("step")).toBe("Step 1 / 2");
  });

  it("follows the audience, and tells it where the presenter goes", async () => {
    const [mine, theirs] = memorySyncPair();
    const heard: PresentMessage[] = [];
    theirs.subscribe((m) => heard.push(m));
    await render(<PresenterWindow sync={mine} />);
    theirs.post({ type: "deck", deck, images: {}, state: { indexh: 0, indexv: 0 }, since: Date.now() });
    await act(async () => void (await new Promise((done) => setTimeout(done, 5))));
    expect(fact("slide")).toBe("Slide 1 / 2");
    theirs.post({ type: "state", state: { indexh: 1, indexv: 0 } });
    await act(async () => void (await new Promise((done) => setTimeout(done, 5))));
    expect(fact("slide")).toBe("Slide 2 / 2");
    await press("ArrowRight");
    await act(async () => void (await new Promise((done) => setTimeout(done, 5))));
    expect(fact("step")).toBe("Step 1 / 2");
    const last = [...heard].reverse().find((m) => m.type === "state");
    expect(last).toEqual({ type: "state", state: { indexh: 1, indexv: 0, indexf: 0, paused: false, overview: false } });
    await press("b");
    await act(async () => void (await new Promise((done) => setTimeout(done, 5))));
    expect([...heard].reverse().find((m) => m.type === "state")).toMatchObject({ state: { paused: true } });
  });

  it("goes back to waiting for a show when the presentation ends, and says it is closing", async () => {
    const [mine, theirs] = memorySyncPair();
    const heard: string[] = [];
    theirs.subscribe((m) => heard.push(m.type));
    await render(<PresenterWindow sync={mine} />);
    theirs.post({ type: "deck", deck, images: {}, state: { indexh: 0, indexv: 0 }, since: 1 });
    await act(async () => void (await new Promise((done) => setTimeout(done, 5))));
    theirs.post({ type: "bye" });
    await act(async () => void (await new Promise((done) => setTimeout(done, 5))));
    expect(text(".ks-presenter")).toContain("Waiting for the show");
    await act(async () => root.unmount());
    expect(heard).toContain("bye");
  });

  it("uses the addresses of the pictures the audience sent", async () => {
    const [mine, theirs] = memorySyncPair();
    const pictured = deckOf(slide("a", { elements: [{ type: "image", id: "i", x: 0, y: 0, w: 100, h: 100, src: "assets/p.png" } as never] }));
    await render(<PresenterWindow sync={mine} />);
    theirs.post({ type: "deck", deck: pictured, images: { "assets/p.png": "blob:sent" }, state: { indexh: 0, indexv: 0 }, since: 1 });
    await act(async () => void (await new Promise((done) => setTimeout(done, 5))));
    expect(host.querySelector('.ks-pv-now img.ks-image-pic')?.getAttribute("src")).toBe("blob:sent");
  });

  it("is a page for the address that says so", () => {
    expect(presenterOf("?presenter=abc123")).toBe("abc123");
    expect(presenterOf("?a=1&presenter=projects%2Ftalk.deck")).toBe("projects/talk.deck");
    expect(presenterOf("?presenter=")).toBeNull();
    expect(presenterOf("?deck=demo")).toBeNull();
    expect(presenterOf("")).toBeNull();
  });
});
