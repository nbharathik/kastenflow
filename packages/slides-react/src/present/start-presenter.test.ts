import type { Deck, Slide } from "@kasten-slides/wasm";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SlidesHost } from "../editor/host.ts";
import type { EditorSession } from "../editor/session/session.ts";
import { plainDeck } from "../render/testing/decks.ts";
import { presenting } from "./open.tsx";
import { type PresentOptions, presentDeck as startDeck } from "./start.ts";
import type { PresentMessage, PresentSync } from "./sync.ts";
import { echoBus } from "./wire.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const slide = (id: string): Slide => ({ id, layout: "blank", elements: [] });
const deck: Deck = { ...plainDeck([]).deck, slides: [slide("a"), slide("b"), slide("c")] };
const session = (): EditorSession => ({ deck, state: { slideId: "a" }, exports: {} }) as unknown as EditorSession;
const host = (extra: Partial<SlidesHost> = {}): SlidesHost => ({ save: async () => ({ status: "saved" }), imageUrl: () => undefined, addImage: async () => "", deliver: async () => {}, notify: vi.fn(), ...extra });

const presentDeck = (h: SlidesHost, options?: PresentOptions) =>
  act(async () => {
    await startDeck(session(), h, "start", options);
  });

const tick = (ms: number) => act(async () => void (await new Promise((done) => setTimeout(done, ms))));

async function until(expected: () => void, ms = 8000): Promise<void> {
  const end = Date.now() + ms;
  for (;;) {
    await tick(25);
    try {
      expected();
      return;
    } catch (error) {
      if (Date.now() > end) throw error;
    }
  }
}

const press = (name: string, code: number) => act(async () => void document.dispatchEvent(new KeyboardEvent("keydown", { key: name, keyCode: code, bubbles: true, cancelable: true })));
const ready = () => expect(document.querySelector(".reveal.ready")).not.toBeNull();

async function leave(): Promise<void> {
  for (let tries = 0; presenting() && tries < 200; tries++) {
    await press("Escape", 27);
    await tick(25);
  }
  await tick(10);
  expect(presenting()).toBe(false);
}

beforeEach(() => {
  document.body.innerHTML = '<div id="editor"></div>';
});

afterEach(async () => {
  await leave();
  document.body.innerHTML = "";
});

/** A window the host opens for the presenter's view: the link the show gets, and the other end where the presenter would be. */
function windows() {
  const bus = echoBus();
  const opened: { link: PresentSync; close: ReturnType<typeof vi.fn>; presenter: PresentSync; heard: PresentMessage[] }[] = [];
  const open = vi.fn(async () => {
    const link = bus.end("show");
    const close = vi.fn(link.close);
    const presenter = bus.end("presenter");
    const heard: PresentMessage[] = [];
    link.subscribe(() => {});
    presenter.subscribe((m) => heard.push(m));
    opened.push({ link, close, presenter, heard });
    return { ...link, close };
  });
  return { open, opened };
}

describe("the presenter's window can be opened again", () => {
  it("opens one window when S is pressed twice, and a third time too", async () => {
    let release: () => void = () => {};
    const slow = new Promise<void>((done) => (release = done));
    const { open, opened } = windows();
    const openPresenter = vi.fn(async () => {
      await slow;
      return open();
    });
    await presentDeck(host({ openPresenter }), {});
    await until(ready);
    await press("s", 83);
    await press("s", 83);
    await press("s", 83);
    expect(openPresenter).toHaveBeenCalledTimes(1);
    release();
    await until(() => expect(opened).toHaveLength(1));
    // Once it is open, S asks for nothing more.
    await press("s", 83);
    await tick(30);
    expect(openPresenter).toHaveBeenCalledTimes(1);
  });

  it("closes the link when the presenter's window is closed, and opens a window again on the next S", async () => {
    const { open, opened } = windows();
    const openPresenter = vi.fn(open);
    await presentDeck(host({ openPresenter }), { presenter: true });
    await until(ready);
    await until(() => expect(opened).toHaveLength(1));
    const first = opened[0]!;
    // The window is closed: it says goodbye and hears no more.
    first.presenter.post({ type: "bye" });
    first.presenter.close();
    await until(() => expect(first.close).toHaveBeenCalledTimes(1));
    expect(presenting()).toBe(true);
    await press("s", 83);
    await until(() => expect(openPresenter).toHaveBeenCalledTimes(2));
    await until(() => expect(opened).toHaveLength(2));
    // The new window is given the deck.
    const second = opened[1]!;
    await until(() => expect(second.heard.some((m) => m.type === "deck")).toBe(true));
    // And the one that closed is not heard from again.
    expect(first.heard.filter((m) => m.type === "deck")).toHaveLength(1);
  });

  it("can be closed and opened again as often as the person likes", async () => {
    const { open, opened } = windows();
    const openPresenter = vi.fn(open);
    await presentDeck(host({ openPresenter }), { presenter: true });
    await until(ready);
    for (let round = 1; round <= 3; round++) {
      await until(() => expect(opened).toHaveLength(round));
      opened[round - 1]?.presenter.post({ type: "bye" });
      opened[round - 1]?.presenter.close();
      await until(() => expect(opened[round - 1]?.close).toHaveBeenCalledTimes(1));
      await press("s", 83);
    }
    await until(() => expect(opened).toHaveLength(4));
  });

  it("tells the presenter's window goodbye when the show ends, and lets go of the link", async () => {
    const { open, opened } = windows();
    await presentDeck(host({ openPresenter: open }), { presenter: true });
    await until(ready);
    await until(() => expect(opened).toHaveLength(1));
    await leave();
    await until(() => expect(opened[0]?.heard.some((m) => m.type === "bye")).toBe(true));
    expect(opened[0]?.close).toHaveBeenCalledTimes(1);
  });

  it("says so when the window would not open, and lets S try again", async () => {
    const notify = vi.fn();
    const { open, opened } = windows();
    let first = true;
    const openPresenter = vi.fn(async () => {
      if (first) {
        first = false;
        return null;
      }
      return open();
    });
    await presentDeck(host({ openPresenter, notify }), {});
    await until(ready);
    await press("s", 83);
    await until(() => expect(notify).toHaveBeenCalledTimes(1));
    await press("s", 83);
    await until(() => expect(opened).toHaveLength(1));
  });
});
