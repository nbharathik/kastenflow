import type { Deck, Slide } from "@kasten-slides/wasm";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { presenting } from "../present/open.tsx";
import { memorySyncPair } from "../present/sync.ts";
import { plainDeck } from "../render/testing/decks.ts";
import { defaultActions } from "./actions.ts";
import type { SlidesHost } from "./host.ts";
import type { EditorSession } from "./session/session.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const slide = (id: string, extra: Partial<Slide> = {}): Slide => ({ id, layout: "blank", elements: [], ...extra });
const deck: Deck = { ...plainDeck([]).deck, slides: [slide("a"), slide("b"), slide("c")] };

function session(current = "b", extra: Record<string, unknown> = {}): EditorSession {
  return { deck, state: { slideId: current }, exports: {}, ...extra } as unknown as EditorSession;
}

const host = (extra: Partial<SlidesHost> = {}): SlidesHost => ({ save: async () => ({ status: "saved" }), imageUrl: () => undefined, addImage: async () => "", deliver: async () => {}, notify: vi.fn(), ...extra });

const tick = (ms: number) => act(async () => void (await new Promise((done) => setTimeout(done, ms))));

/** Lets the page work until what is expected holds: the presentation loads its parts the first time it is asked for. */
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
const shown = () => document.querySelector(".slides section.present:not(.stack)")?.getAttribute("data-slide");
const ready = () => expect(document.querySelector(".reveal.ready")).not.toBeNull();

/** Presses Escape until the presentation has gone (it takes the key once reveal.js is up). */
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

describe("the editor's own way of presenting", () => {
  it("opens the presentation over the editor, from the slide shown, and the editor is inert until it ends", async () => {
    defaultActions(session("b"), host()).present?.("current");
    await until(() => expect(shown()).toBe("b"));
    expect(presenting()).toBe(true);
    expect(document.getElementById("editor")?.inert).toBe(true);
    await leave();
    expect(document.getElementById("editor")?.inert).toBe(false);
    expect(document.querySelector(".ks-show-root")).toBeNull();
  });

  it("gives the keys back to where they were, though a page made inert loses its focus", async () => {
    // What a browser does, which jsdom does not: the focus leaves what is made inert.
    const before = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "inert");
    const held = new WeakMap<object, boolean>();
    Object.defineProperty(HTMLElement.prototype, "inert", {
      configurable: true,
      get(this: HTMLElement) {
        return held.get(this) ?? false;
      },
      set(this: HTMLElement, value: boolean) {
        held.set(this, value);
        if (value && this.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
      },
    });
    try {
      document.getElementById("editor")!.innerHTML = '<button id="was">Present</button>';
      const was = document.getElementById("was") as HTMLButtonElement;
      was.focus();
      expect(document.activeElement).toBe(was);
      defaultActions(session(), host()).present?.("start");
      await until(ready);
      expect(document.activeElement).not.toBe(was);
      await leave();
      expect(document.activeElement).toBe(was);
    } finally {
      if (before) Object.defineProperty(HTMLElement.prototype, "inert", before);
      else delete (HTMLElement.prototype as { inert?: boolean }).inert;
    }
  });

  it("starts at the first slide when asked to begin", async () => {
    defaultActions(session("c"), host()).present?.("start");
    await until(ready);
    await tick(100);
    expect(shown()).toBe("a");
  });

  it("opens the deck as a page that scrolls when asked", async () => {
    defaultActions(session(), host()).present?.("current", { view: "scroll" });
    await until(() => expect(document.querySelector(".ks-show-scroll")).not.toBeNull());
    expect(document.querySelector(".reveal")).toBeNull();
    await leave();
  });

  it("asks the host to get ready, and tells it when the presentation is over", async () => {
    const done = vi.fn();
    const willPresent = vi.fn(async () => done);
    defaultActions(session(), host({ willPresent })).present?.("start");
    await until(ready);
    expect(willPresent).toHaveBeenCalledWith(deck);
    expect(done).not.toHaveBeenCalled();
    await leave();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("opens the presenter's window through the host, and passes its link on: the two follow each other, and it is told when the talk ends", async () => {
    const [mine, theirs] = memorySyncPair();
    const heard: string[] = [];
    theirs.subscribe((m) => heard.push(m.type));
    const openPresenter = vi.fn(async () => mine);
    defaultActions(session(), host({ openPresenter })).present?.("start", { presenter: true });
    await until(ready);
    expect(openPresenter).toHaveBeenCalledTimes(1);
    theirs.post({ type: "hello" });
    await until(() => expect(heard).toContain("deck"));
    theirs.post({ type: "state", state: { indexh: 2, indexv: 0 } });
    await until(() => expect(shown()).toBe("c"));
    await leave();
    await until(() => expect(heard).toContain("bye"));
  });

  it("opens the presenter's window for a rehearsal even when only the rehearsal was asked for, and says it is one with the deck", async () => {
    const [mine, theirs] = memorySyncPair();
    const heard: string[] = [];
    theirs.subscribe((m) => heard.push(m.type));
    const openPresenter = vi.fn(async () => mine);
    defaultActions(session(), host({ openPresenter })).present?.("start", { rehearse: true });
    await until(ready);
    expect(openPresenter).toHaveBeenCalledTimes(1);
    theirs.post({ type: "hello" });
    await until(() => expect(heard).toContain("rehearse"));
    // It still shows the audience's window, and moves only when someone moves it.
    expect(shown()).toBe("a");
  });

  it("says so when the presenter's window would not open, and still presents", async () => {
    const notify = vi.fn();
    defaultActions(session(), host({ openPresenter: async () => null, notify })).present?.("start", { presenter: true });
    await until(ready);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("presenter view could not be opened"));
    expect(presenting()).toBe(true);
  });

  it("uses the host's full screen for F, and gives the screen back", async () => {
    const give = vi.fn();
    const fillScreen = vi.fn(async () => give);
    defaultActions(session(), host({ fillScreen })).present?.("start");
    await until(ready);
    await press("f", 70);
    await until(() => expect(fillScreen).toHaveBeenCalledTimes(1));
    await leave();
    expect(give).toHaveBeenCalled();
  });

  it("presents one talk at a time", async () => {
    defaultActions(session(), host()).present?.("start");
    await until(ready);
    defaultActions(session(), host()).present?.("start");
    await tick(300);
    expect(document.querySelectorAll(".ks-show-root")).toHaveLength(1);
    expect(document.querySelectorAll(".reveal")).toHaveLength(1);
  });
});

describe("the editor's own way of exporting a web page", () => {
  it("makes the page and hands it to the host", async () => {
    const delivered: unknown[] = [];
    const file = { name: "Talk.html", bytes: new Uint8Array([60]), type: "text/html" };
    const html = vi.fn(async () => ({ file, warnings: [] }));
    const tell = vi.fn();
    defaultActions(session("a", { exports: { html } }), host({ deliver: async (f) => void delivered.push(f), notify: tell })).exportAs?.("html");
    await until(() => expect(delivered).toEqual([file]));
    expect(html).toHaveBeenCalledTimes(1);
    expect(tell).not.toHaveBeenCalled();
  });

  it("says what it could not carry", async () => {
    const tell = vi.fn();
    const html = async () => ({ file: { name: "T.html", bytes: new Uint8Array(), type: "text/html" }, warnings: [{ slide: null, element: null, message: "Videos are not put in the page." }] });
    defaultActions(session("a", { exports: { html } }), host({ notify: tell })).exportAs?.("html");
    await until(() => expect(tell).toHaveBeenCalledWith(expect.stringContaining("Videos are not put in the page.")));
  });
});
