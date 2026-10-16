import type { Deck, Element, Slide } from "@kasten-slides/wasm";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { plainDeck } from "../render/testing/decks.ts";
import { EmbedFrame, LiveLayer, VideoPlayer, liveItems } from "./Live.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const embed = (extra: Record<string, unknown> = {}) => ({ type: "embed", id: "e", x: 10, y: 20, w: 300, h: 200, url: "http://127.0.0.1:9/demo", poster: "posters/p.png", ...extra }) as unknown as Extract<Element, { type: "embed" }>;
const video = (extra: Record<string, unknown> = {}) => ({ type: "video", id: "v", x: 40, y: 50, w: 320, h: 180, src: "assets/clip.webm", poster: "assets/poster.png", ...extra }) as unknown as Extract<Element, { type: "video" }>;
const group = (children: Element[], extra: Record<string, unknown> = {}) => ({ type: "group", id: "g", children, ...extra }) as unknown as Element;

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

const render = (ui: React.ReactElement) => act(async () => root.render(ui));
const settle = () => act(async () => void (await Promise.resolve()));

describe("the live embeds and videos of a slide", () => {
  const scene = (elements: Element[]): { deck: Deck; slide: Slide } => plainDeck(elements);

  it("are the embeds and videos at any depth, with the boxes they are drawn in", () => {
    const { deck, slide } = scene([embed(), group([video()])]);
    const items = liveItems(deck, slide, 0);
    expect(items.map((i) => [i.element.id, i.box])).toEqual([
      ["e", { x: 10, y: 20, w: 300, h: 200 }],
      ["v", { x: 40, y: 50, w: 320, h: 180 }],
    ]);
  });

  it("leave out what a step hides, and what is in a group it hides", () => {
    const { deck, slide } = scene([embed({ stepStates: { 0: "hidden", 2: "normal" } }), group([video()], { stepStates: { 0: "hidden", 1: "normal" } })]);
    expect(liveItems(deck, slide, 0)).toEqual([]);
    expect(liveItems(deck, slide, 1).map((i) => i.element.id)).toEqual(["v"]);
    expect(liveItems(deck, slide, 2).map((i) => i.element.id)).toEqual(["e", "v"]);
  });

  it("are dim when a step dims them", () => {
    const { deck, slide } = scene([embed({ stepStates: { 0: "dimmed" } })]);
    expect(liveItems(deck, slide, 0)[0]?.opacity).toBe(deck.theme.dimmedOpacity);
  });

  it("are a layer the size of the slide, and none when there are none", async () => {
    const { deck, slide } = scene([embed()]);
    await render(<LiveLayer deck={deck} slide={slide} step={0} imageUrl={() => undefined} />);
    expect(host.querySelector<HTMLElement>(".ks-show-live")?.style.width).toBe("960px");
    const plain = scene([]);
    await render(<LiveLayer deck={plain.deck} slide={plain.slide} step={0} imageUrl={() => undefined} />);
    expect(host.querySelector(".ks-show-live")).toBeNull();
  });
});

/** What the browser sends when the page around a frame refuses its address. */
function refuse(address: string, directive = "frame-src"): void {
  const event = new Event("securitypolicyviolation", { bubbles: true });
  Object.assign(event, { effectiveDirective: directive, violatedDirective: directive, blockedURI: address });
  document.dispatchEvent(event);
}

describe("an embedded page", () => {
  const item = (extra: Record<string, unknown> = {}) => ({ element: embed(extra), box: { x: 10, y: 20, w: 300, h: 200 }, opacity: 1 });
  const card = () => host.querySelector<HTMLElement>(".ks-embed-card");
  const button = (name: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === name);

  it("runs in a frame over its box, sandboxed, see-through until it has loaded", async () => {
    await render(<EmbedFrame item={item()} />);
    await settle();
    const frame = host.querySelector<HTMLIFrameElement>("iframe");
    expect(frame?.getAttribute("src")).toBe("http://127.0.0.1:9/demo");
    expect(frame?.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin");
    expect(frame?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(frame?.style.opacity).toBe("0");
    const box = host.querySelector<HTMLElement>(".ks-show-live-item");
    expect([box?.style.left, box?.style.top, box?.style.width, box?.style.height]).toEqual(["10px", "20px", "300px", "200px"]);
    await act(async () => void frame?.dispatchEvent(new Event("load")));
    expect(frame?.style.opacity).toBe("1");
    expect(box?.style.pointerEvents).toBe("auto");
  });

  it("is given no storage of its own when it is a page of the presentation's own origin", async () => {
    await render(<EmbedFrame item={item({ url: `${location.origin}/other` })} />);
    await settle();
    expect(host.querySelector("iframe")?.getAttribute("sandbox")).toBe("allow-scripts");
  });

  it("asks the network nothing: no fetch, however long it takes", async () => {
    vi.useFakeTimers();
    const fetched = vi.spyOn(globalThis, "fetch");
    await render(<EmbedFrame item={item()} seconds={3} />);
    await act(async () => void vi.advanceTimersByTime(20_000));
    expect(fetched).not.toHaveBeenCalled();
    fetched.mockRestore();
  });

  it("is not removed when it is slow: a card says so, and the page shows if it loads after all (it used to go away after 3 seconds)", async () => {
    vi.useFakeTimers();
    await render(<EmbedFrame item={item()} seconds={3} />);
    await settle();
    expect(card()).toBeNull();
    await act(async () => void vi.advanceTimersByTime(3100));
    expect(host.querySelector("iframe")).not.toBeNull();
    expect(card()?.dataset.status).toBe("slow");
    expect(card()?.textContent).toMatch(/taking a long time/);
    await act(async () => void host.querySelector("iframe")?.dispatchEvent(new Event("load")));
    expect(card()).toBeNull();
    expect(host.querySelector<HTMLIFrameElement>("iframe")?.style.opacity).toBe("1");
    await act(async () => void vi.advanceTimersByTime(60_000));
    expect(host.querySelector("iframe")).not.toBeNull();
  });

  it("stays when it loads in time", async () => {
    vi.useFakeTimers();
    await render(<EmbedFrame item={item()} seconds={3} />);
    await settle();
    await act(async () => void host.querySelector("iframe")?.dispatchEvent(new Event("load")));
    await act(async () => void vi.advanceTimersByTime(10_000));
    expect(host.querySelector("iframe")).not.toBeNull();
    expect(card()).toBeNull();
  });

  it("says plainly that the page is refused when the security policy blocks its frame, even though the frame then 'loads' its error page", async () => {
    await render(<EmbedFrame item={item()} />);
    await settle();
    // The report comes after the frame was inserted; the listener has been there from the start.
    await act(async () => refuse("http://127.0.0.1:9/demo"));
    expect(card()?.dataset.status).toBe("blocked");
    expect(card()?.textContent).toMatch(/can't be shown inside a slide/);
    await act(async () => void host.querySelector("iframe")?.dispatchEvent(new Event("load")));
    expect(card()?.dataset.status).toBe("blocked");
    expect(host.querySelector<HTMLIFrameElement>("iframe")?.style.opacity).toBe("0");
  });

  it("does not take the refusal of another page for its own", async () => {
    await render(<EmbedFrame item={item()} />);
    await settle();
    await act(async () => refuse("https://other.example/page"));
    await act(async () => refuse("http://127.0.0.1:9/demo", "script-src"));
    expect(card()).toBeNull();
  });

  it("offers to open the page outside on the card, with the host's way if it has one, and always in a small link", async () => {
    const openUrl = vi.fn();
    await render(<EmbedFrame item={item()} pages={{ openUrl }} />);
    await settle();
    // Nothing is wrong yet, and the link is there anyway: a page that refuses to be framed cannot be told.
    expect(card()).toBeNull();
    await act(async () => void button("Not showing? Open externally")?.click());
    expect(openUrl).toHaveBeenLastCalledWith("http://127.0.0.1:9/demo");
    await act(async () => refuse("http://127.0.0.1:9/demo"));
    expect(button("Not showing? Open externally")).toBeUndefined();
    await act(async () => void button("Open externally")?.click());
    expect(openUrl).toHaveBeenCalledTimes(2);
  });

  it("opens it in a window that shares nothing with the slide when the host has no way of its own", async () => {
    const opened = vi.spyOn(window, "open").mockReturnValue(null);
    await render(<EmbedFrame item={item()} />);
    await settle();
    await act(async () => void button("Not showing? Open externally")?.click());
    expect(opened).toHaveBeenCalledWith("http://127.0.0.1:9/demo", "_blank", "noopener,noreferrer");
    opened.mockRestore();
  });

  it("offers the snapshot on the card when the embed has one, and shows the slide's own picture once it is chosen", async () => {
    await render(<EmbedFrame item={item()} />);
    await settle();
    await act(async () => refuse("http://127.0.0.1:9/demo"));
    await act(async () => void button("Show the snapshot")?.click());
    expect(host.querySelector(".ks-show-live-item")).toBeNull();
    // An embed with no snapshot has nothing to go back to.
    await render(<EmbedFrame key="plain" item={item({ poster: undefined })} />);
    await settle();
    await act(async () => refuse("http://127.0.0.1:9/demo"));
    expect(button("Show the snapshot")).toBeUndefined();
    expect(button("Open externally")).toBeDefined();
  });

  it("says it is offline, without loading, and loads when the network is back", async () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await render(<EmbedFrame item={item({ url: "https://example.com/x" })} />);
    await settle();
    expect(card()?.dataset.status).toBe("offline");
    expect(host.querySelector("iframe")?.getAttribute("src")).toBeNull();
    online.mockReturnValue(true);
    await act(async () => void window.dispatchEvent(new Event("online")));
    expect(card()).toBeNull();
    expect(host.querySelector("iframe")?.getAttribute("src")).toBe("https://example.com/x");
    online.mockRestore();
  });

  it("is not there at all for an address that is not a web address", async () => {
    for (const url of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,x", "", "not a url"]) {
      await render(<EmbedFrame item={item({ url })} />);
      await settle();
      expect(host.querySelector("iframe"), url).toBeNull();
    }
  });
});

describe("a video", () => {
  const item = (extra: Record<string, unknown> = {}) => ({ element: video(extra), box: { x: 40, y: 50, w: 320, h: 180 }, opacity: 1 });
  const urls = (path: string) => `blob:${path}`;

  it("plays in place, with its still until it starts and the controls of the browser", async () => {
    await render(<VideoPlayer item={item()} imageUrl={urls} />);
    const node = host.querySelector("video");
    expect(node?.getAttribute("src")).toBe("blob:assets/clip.webm");
    expect(node?.getAttribute("poster")).toBe("blob:assets/poster.png");
    expect(node?.controls).toBe(true);
    expect(node?.getAttribute("preload")).toBe("metadata");
    expect(node?.hasAttribute("data-autoplay")).toBe(false);
    expect(node?.style.left).toBe("40px");
  });

  it("starts by itself when the video says so, and loops when it says so", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    await render(<VideoPlayer item={item({ autoplay: true, looped: true })} imageUrl={urls} />);
    const node = host.querySelector("video");
    expect(node?.loop).toBe(true);
    expect(node?.hasAttribute("data-autoplay")).toBe(true);
    expect(play).toHaveBeenCalled();
    play.mockRestore();
  });

  it("plays without sound if the browser will not play with it", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValueOnce(new Error("NotAllowedError")).mockResolvedValue(undefined);
    await render(<VideoPlayer item={item({ autoplay: true })} imageUrl={urls} />);
    await settle();
    expect(host.querySelector("video")?.muted).toBe(true);
    expect(play).toHaveBeenCalledTimes(2);
    play.mockRestore();
  });

  it("is not there when the host has no file, or the file cannot be played", async () => {
    await render(<VideoPlayer item={item()} imageUrl={() => undefined} />);
    expect(host.querySelector("video")).toBeNull();
    await render(<VideoPlayer item={item()} imageUrl={urls} />);
    await act(async () => void host.querySelector("video")?.dispatchEvent(new Event("error")));
    expect(host.querySelector("video")).toBeNull();
  });
});
