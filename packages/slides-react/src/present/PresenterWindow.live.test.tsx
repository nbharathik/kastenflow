import type { Deck, Slide } from "@kasten-slides/wasm";
import { type ReactElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { plainDeck } from "../render/testing/decks.ts";
import { PresenterWindow } from "./PresenterWindow.tsx";
import { type PresentMessage } from "./sync.ts";
import { echoBus } from "./wire.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const slide = (id: string, extra: Partial<Slide> = {}): Slide => ({ id, layout: "blank", elements: [], ...extra });
const video = { type: "video", id: "v1", x: 40, y: 40, w: 320, h: 180, src: "assets/clip.webm" };
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
  await act(async () => root.unmount());
  host.remove();
});

const render = (ui: ReactElement) => act(async () => root.render(ui));
const flush = () =>
  act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
const press = (key: string) => act(async () => void window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));

/** The show, as far as the presenter's window can tell: it gives the deck when asked. */
function openWith(deck: Deck, images: Record<string, string> = {}) {
  const bus = echoBus();
  const show = bus.end("show");
  const heard: PresentMessage[] = [];
  show.subscribe((message) => {
    heard.push(message);
    if (message.type === "hello") show.post({ type: "deck", deck, images, state: { indexh: 0, indexv: 0 }, since: 7 });
  });
  return { show, heard, presenter: bus.end("presenter") };
}

describe("the presenter's view shows the slide's videos live", () => {
  it("plays a video there without sound, from the address the show sent", async () => {
    const { presenter } = openWith(deckOf(slide("a", { elements: [video as never] })), { "assets/clip.webm": "blob:clip" });
    await render(<PresenterWindow sync={presenter} />);
    await flush();
    const node = host.querySelector<HTMLVideoElement>(".ks-pv-now video");
    expect(node?.getAttribute("src")).toBe("blob:clip");
    expect(node?.muted).toBe(true);
  });

  it("says a video's play to the show, and plays what the show plays", async () => {
    const { presenter, show, heard } = openWith(deckOf(slide("a", { elements: [video as never] })), { "assets/clip.webm": "blob:clip" });
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    await render(<PresenterWindow sync={presenter} />);
    await flush();
    show.post({ type: "media", media: { key: "a/v1", action: "play", time: 0 } });
    await flush();
    expect(play).toHaveBeenCalled();
    play.mockRestore();
    heard.length = 0;
    host.querySelector("video")?.dispatchEvent(new Event("pause"));
    await flush();
    expect(heard.some((message) => message.type === "media" && message.media.action === "pause")).toBe(true);
  });
});

describe("the presenter's view keeps up with the deck being edited", () => {
  it("applies what changed without asking for the deck again", async () => {
    const before = deckOf(slide("a", { notes: "first" }), slide("b"));
    const { presenter, show, heard } = openWith(before);
    await render(<PresenterWindow sync={presenter} />);
    await flush();
    expect(host.querySelector(".ks-pv-notes-text")?.textContent).toContain("first");
    heard.length = 0;
    show.post({ type: "edit", since: 7, patch: { order: ["a", "b", "c"], slides: [slide("a", { notes: "edited" }), slide("c")] } });
    await flush();
    expect(host.querySelector(".ks-pv-notes-text")?.textContent).toContain("edited");
    expect(host.querySelector('[data-fact="slide"]')?.textContent).toContain("/ 3");
    expect(heard.filter((message) => message.type === "hello")).toEqual([]);
  });

  it("asks for the whole deck when an edit names a slide it never had, and ignores an edit of another talk", async () => {
    const { presenter, show, heard } = openWith(deckOf(slide("a"), slide("b")));
    await render(<PresenterWindow sync={presenter} />);
    await flush();
    heard.length = 0;
    show.post({ type: "edit", since: 99, patch: { order: ["a", "x"], slides: [] } });
    await flush();
    expect(heard.filter((message) => message.type === "hello")).toEqual([]);
    show.post({ type: "edit", since: 7, patch: { order: ["a", "x"], slides: [] } });
    await flush();
    expect(heard.filter((message) => message.type === "hello")).toHaveLength(1);
  });
});

describe("the laser and the ink", () => {
  it("shows the show's ink on the slide, and clears it when the slide changes", async () => {
    const { presenter, show } = openWith(deckOf(slide("a"), slide("b")));
    await render(<PresenterWindow sync={presenter} />);
    await flush();
    show.post({ type: "ink", ink: { op: "add", slide: "a", stroke: { id: "k1", tool: "pen", color: "red", width: 0.0045, points: [0.1, 0.1, 0.5, 0.5] } } });
    await flush();
    expect(host.querySelectorAll(".ks-ink-stroke")).toHaveLength(1);
    show.post({ type: "state", state: { indexh: 1, indexv: 0 } });
    await flush();
    expect(host.querySelectorAll(".ks-ink-stroke")).toHaveLength(0);
  });

  it("sends the laser's place when L is pressed and the pointer moves over the slide", async () => {
    const { presenter, heard } = openWith(deckOf(slide("a")));
    await render(<PresenterWindow sync={presenter} />);
    await flush();
    await press("l");
    const layer = host.querySelector<SVGSVGElement>(".ks-ink");
    expect(layer?.getAttribute("data-tool")).toBe("laser");
    layer!.getBoundingClientRect = () => ({ left: 100, top: 50, width: 400, height: 200, right: 500, bottom: 250, x: 100, y: 50, toJSON: () => ({}) });
    await act(async () => void layer!.dispatchEvent(new MouseEvent("pointermove", { clientX: 300, clientY: 100, bubbles: true })));
    const pointer = heard.filter((message) => message.type === "pointer");
    expect(pointer.at(-1)).toEqual({ type: "pointer", at: { slide: "a", x: 0.5, y: 0.25 } });
    await press("l");
    expect(heard.filter((message) => message.type === "pointer").at(-1)).toMatchObject({ at: null });
  });

  it("draws with P and sends the stroke to the show, and Esc puts the pen down before it asks to end", async () => {
    const { presenter, heard } = openWith(deckOf(slide("a")));
    await render(<PresenterWindow sync={presenter} />);
    await flush();
    await press("p");
    const layer = host.querySelector<SVGSVGElement>(".ks-ink")!;
    expect(layer.hasAttribute("data-active")).toBe(true);
    layer.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    const at = (type: string, x: number, y: number) => act(async () => void layer.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true })));
    await at("pointerdown", 10, 10);
    await at("pointermove", 50, 50);
    await at("pointerup", 50, 50);
    expect(host.querySelectorAll(".ks-ink-stroke")).toHaveLength(1);
    const added = heard.find((message) => message.type === "ink" && message.ink.op === "add");
    expect(added).toMatchObject({ type: "ink", ink: { op: "add", slide: "a", stroke: { tool: "pen", points: [0.1, 0.1, 0.5, 0.5] } } });
    await press("Escape");
    expect(layer.hasAttribute("data-active")).toBe(false);
    expect(heard.some((message) => message.type === "end")).toBe(false);
  });
});
