import type { Deck, Slide } from "@kasten-slides/wasm";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SlidesHost } from "../editor/host.ts";
import type { EditorSession } from "../editor/session/session.ts";
import { plainDeck } from "../render/testing/decks.ts";
import { presenting } from "./open.tsx";
import { type PresentOptions, presentDeck as startDeck } from "./start.ts";
import { memorySyncPair } from "./sync.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const slide = (id: string): Slide => ({ id, layout: "blank", elements: [] });
const deck: Deck = { ...plainDeck([]).deck, slides: [slide("a"), slide("b"), slide("c")] };
const session = (current = "b"): EditorSession => ({ deck, state: { slideId: current }, exports: {} }) as unknown as EditorSession;
const host = (extra: Partial<SlidesHost> = {}): SlidesHost => ({ save: async () => ({ status: "saved" }), imageUrl: () => undefined, addImage: async () => "", deliver: async () => {}, notify: vi.fn(), ...extra });

/** Starts a show the way the editor does, with the page's updates counted as the test environment wants. */
const presentDeck = (s: EditorSession, h: SlidesHost, from: "start" | "current", options?: PresentOptions) =>
  act(async () => {
    await startDeck(s, h, from, options);
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

const press = (name: string, code: number, init: KeyboardEventInit = {}) => act(async () => void document.dispatchEvent(new KeyboardEvent("keydown", { key: name, keyCode: code, bubbles: true, cancelable: true, ...init })));
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

describe("a show fills the screen", () => {
  it("asks the host for the screen on every way of starting, and gives it back when the show closes", async () => {
    for (const from of ["start", "current"] as const) {
      const give = vi.fn();
      const fillScreen = vi.fn(async () => give);
      await presentDeck(session(), host({ fillScreen }), from);
      await until(ready);
      expect(fillScreen).toHaveBeenCalledTimes(1);
      expect(give).not.toHaveBeenCalled();
      await leave();
      expect(give).toHaveBeenCalledTimes(1);
    }
  });

  it("has the screen before the presenter's window is opened, so the window can be placed on the display left over", async () => {
    const order: string[] = [];
    const [mine] = memorySyncPair();
    const fillScreen = vi.fn(async () => {
      order.push("screen");
      return () => {};
    });
    const openPresenter = vi.fn(async () => {
      order.push("presenter");
      return mine;
    });
    await presentDeck(session(), host({ fillScreen, openPresenter }), "start", { presenter: true });
    await until(ready);
    expect(order).toEqual(["screen", "presenter"]);
  });

  it("lets the F key give the screen back and take it again, without ending the show", async () => {
    const give = vi.fn();
    const fillScreen = vi.fn(async () => give);
    await presentDeck(session(), host({ fillScreen }), "start");
    await until(ready);
    await press("f", 70);
    expect(give).toHaveBeenCalledTimes(1);
    expect(presenting()).toBe(true);
    await press("f", 70);
    await until(() => expect(fillScreen).toHaveBeenCalledTimes(2));
    expect(presenting()).toBe(true);
  });

  it("closes the layers one at a time, then the show and the full screen with one press", async () => {
    const give = vi.fn();
    await presentDeck(session(), host({ fillScreen: async () => give }), "start");
    await until(ready);
    // The list of keys is a layer.
    await press("?", 191, { shiftKey: true });
    expect(document.querySelector(".ks-show-hints")).not.toBeNull();
    await press("Escape", 27);
    expect(document.querySelector(".ks-show-hints")).toBeNull();
    expect(presenting()).toBe(true);
    expect(give).not.toHaveBeenCalled();
    await press("Escape", 27);
    await until(() => expect(presenting()).toBe(false));
    expect(give).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".ks-show-root")).toBeNull();
  });

  it("ends the show when the person leaves full screen another way", async () => {
    let left: () => void = () => {};
    const give = vi.fn();
    await presentDeck(session(), host({ fillScreen: async (onLeft) => ((left = onLeft), give) }), "start");
    await until(ready);
    left();
    await until(() => expect(presenting()).toBe(false));
    // The host gave nothing back that was not already given.
    expect(give).not.toHaveBeenCalled();
  });

  it("still presents where the host has no full screen of its own", async () => {
    await presentDeck(session(), host(), "start");
    await until(ready);
    expect(presenting()).toBe(true);
  });

  it("looks right when the host refuses the screen", async () => {
    await presentDeck(session(), host({ fillScreen: async () => Promise.reject(new Error("no")) }), "start");
    await until(ready);
    expect(presenting()).toBe(true);
  });

  it("gives everything back when starting fails: the host is told the show is over and the screen is given back", async () => {
    const done = vi.fn();
    const give = vi.fn();
    const failing = host({
      willPresent: async () => done,
      fillScreen: async () => give,
      openPresenter: async () => {
        throw new Error("no window");
      },
    });
    await expect(presentDeck(session(), failing, "start", { presenter: true })).rejects.toThrow("no window");
    expect(done).toHaveBeenCalledTimes(1);
    expect(give).toHaveBeenCalledTimes(1);
    expect(presenting()).toBe(false);
  });

  it("asks the host to get ready only once when a show is already open", async () => {
    const willPresent = vi.fn(async () => () => {});
    await presentDeck(session(), host({ willPresent }), "start");
    await until(ready);
    await presentDeck(session(), host({ willPresent }), "start");
    expect(willPresent).toHaveBeenCalledTimes(1);
  });
});

describe("what a show looks like", () => {
  it("has no arrows and no progress bar unless they were turned on", async () => {
    await presentDeck(session(), host(), "start");
    await until(ready);
    expect(document.querySelector<HTMLElement>(".reveal .controls")?.style.display).toBe("none");
    expect(document.querySelector<HTMLElement>(".reveal .progress")?.style.display).toBe("none");
  });
});
