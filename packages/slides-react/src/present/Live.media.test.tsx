import type { Element as DeckElement } from "@kasten-slides/wasm";
import { type ReactNode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VideoPlayer } from "./Live.tsx";
import { type MediaEvent, MediaMemory, createMediaLink } from "./media.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Video = Extract<DeckElement, { type: "video" }>;
type Media = HTMLMediaElement & { _paused?: boolean; _time?: number };

const video = (extra: Partial<Video> = {}): Video => ({ type: "video", id: "v1", x: 0, y: 0, w: 320, h: 180, src: "assets/clip.webm", ...extra }) as Video;
const item = (extra: Partial<Video> = {}) => ({ element: video(extra), box: { x: 40, y: 50, w: 320, h: 180 }, opacity: 1 });
const urls = (path: string) => `blob:${path}`;

let host: HTMLDivElement;
let root: Root;
const restore: (() => void)[] = [];

/** jsdom plays nothing: a media element here keeps its own place and state, and says "play" and "pause" as a browser does. */
function pretendToPlay(): void {
  const proto = HTMLMediaElement.prototype as Media;
  const define = (name: string, descriptor: PropertyDescriptor): void => {
    const before = Object.getOwnPropertyDescriptor(proto, name);
    Object.defineProperty(proto, name, { configurable: true, ...descriptor });
    restore.push(() => (before ? Object.defineProperty(proto, name, before) : Reflect.deleteProperty(proto, name)));
  };
  define("paused", { get: function (this: Media) { return this._paused ?? true; } });
  define("duration", { get: () => 100 });
  define("ended", { get: () => false });
  define("currentTime", {
    get: function (this: Media) {
      return this._time ?? 0;
    },
    set: function (this: Media, value: number) {
      this._time = value;
      this.dispatchEvent(new Event("seeked"));
    },
  });
  define("play", {
    value: function (this: Media) {
      this._paused = false;
      this.dispatchEvent(new Event("play"));
      return Promise.resolve();
    },
  });
  define("pause", {
    value: function (this: Media) {
      if (this._paused === false) {
        this._paused = true;
        this.dispatchEvent(new Event("pause"));
      }
    },
  });
}

beforeEach(() => {
  pretendToPlay();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  for (const undo of restore.splice(0).reverse()) undo();
});

const node = () => host.querySelector("video") as Media;
const draw = (ui: ReactNode) => act(async () => root.render(ui));
const emit = (target: EventTarget, type: string) => act(async () => void target.dispatchEvent(new Event(type)));

describe("a video keeps its place", () => {
  it("remembers where it had got to and carries on from there when it comes back", async () => {
    const memory = new MediaMemory();
    const { channel } = createMediaLink(null, false, memory);
    await draw(<VideoPlayer item={item()} imageUrl={urls} media={channel} mediaKey="s1/v1" />);
    node()._time = 42;
    await emit(node(), "timeupdate");
    expect(memory.get("s1/v1")).toBe(42);
    // The slide goes away and comes back: a new element picks up the place once it knows its length.
    await draw(null);
    await draw(<VideoPlayer item={item()} imageUrl={urls} media={channel} mediaKey="s1/v1" />);
    await emit(node(), "loadedmetadata");
    expect(node().currentTime).toBe(42);
  });

  it("starts again from the beginning after it played to its end", async () => {
    const memory = new MediaMemory();
    memory.set("s1/v1", 99.9);
    const { channel } = createMediaLink(null, false, memory);
    await draw(<VideoPlayer item={item()} imageUrl={urls} media={channel} mediaKey="s1/v1" />);
    await emit(node(), "ended");
    expect(memory.get("s1/v1")).toBe(0);
    await emit(node(), "loadedmetadata");
    expect(node().currentTime).toBe(0);
  });

  it("is mounted early, paused and loading, and plays when its slide arrives", async () => {
    const memory = new MediaMemory();
    const { channel } = createMediaLink(null, false, memory);
    const play = vi.spyOn(HTMLMediaElement.prototype, "play");
    await draw(<VideoPlayer item={item({ autoplay: true })} imageUrl={urls} media={channel} mediaKey="s1/v1" active={false} />);
    expect(node().getAttribute("preload")).toBe("auto");
    expect(play).not.toHaveBeenCalled();
    const early = node();
    await draw(<VideoPlayer item={item({ autoplay: true })} imageUrl={urls} media={channel} mediaKey="s1/v1" />);
    expect(node()).toBe(early);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("stops and keeps its place when its slide goes, without telling the other window to pause", async () => {
    const memory = new MediaMemory();
    const sent: MediaEvent[] = [];
    const { channel } = createMediaLink((event) => sent.push(event), false, memory);
    await draw(<VideoPlayer item={item()} imageUrl={urls} media={channel} mediaKey="s1/v1" />);
    await act(async () => void node().play());
    node()._time = 12;
    sent.length = 0;
    await draw(<VideoPlayer item={item()} imageUrl={urls} media={channel} mediaKey="s1/v1" active={false} />);
    expect(node().paused).toBe(true);
    expect(memory.get("s1/v1")).toBe(12);
    expect(sent.filter((event) => event.action === "pause")).toEqual([]);
  });
});

describe("a video in two windows", () => {
  it("tells the other window when it plays, pauses and seeks", async () => {
    const sent: MediaEvent[] = [];
    const { channel } = createMediaLink((event) => sent.push(event));
    await draw(<VideoPlayer item={item()} imageUrl={urls} media={channel} mediaKey="s1/v1" />);
    await act(async () => void node().play());
    node()._time = 7;
    await act(async () => void (node().currentTime = 9));
    await act(async () => void node().pause());
    expect(sent.map((event) => event.action)).toEqual(["play", "seek", "pause"]);
    expect(sent.at(-1)).toEqual({ key: "s1/v1", action: "pause", time: 9 });
  });

  it("does what the other window did, and does not say it back", async () => {
    const sent: MediaEvent[] = [];
    const link = createMediaLink((event) => sent.push(event));
    await draw(<VideoPlayer item={item()} imageUrl={urls} media={link.channel} mediaKey="s1/v1" />);
    await act(async () => link.receive({ key: "s1/v1", action: "play", time: 30 }));
    expect(node().paused).toBe(false);
    expect(node().currentTime).toBe(30);
    await act(async () => link.receive({ key: "s1/v1", action: "pause", time: 31 }));
    expect(node().paused).toBe(true);
    expect(node().currentTime).toBe(31);
    expect(sent).toEqual([]);
    // Another video's word is not for this one.
    await act(async () => link.receive({ key: "s2/v9", action: "play", time: 0 }));
    expect(node().paused).toBe(true);
  });

  it("plays without sound where the channel says so (the presenter's view)", async () => {
    const { channel } = createMediaLink(null, true);
    await draw(<VideoPlayer item={item()} imageUrl={urls} media={channel} mediaKey="s1/v1" />);
    expect(node().muted).toBe(true);
  });
});
