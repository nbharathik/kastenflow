// An embed that plays in the editor: the desktop app shows a picture until Play is pressed on the selected embed; Esc, another selection or
// another slide ends it. Where the editor frames a selected page by itself (a browser) nothing changes.

import type { Element } from "@kasten-slides/wasm";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MemoryHost } from "../editor/memory-host.ts";
import type { SlidesHost } from "../editor/host.ts";
import { plainDeck } from "../render/testing/decks.ts";
import { EmbedLayer, canPlay } from "./EmbedLayer.tsx";
import { playingId, startPlaying, stopPlaying } from "./play-store.ts";

const WATCH = "https://youtu.be/dQw4w9WgXcQ?t=30";
const PLAYER = "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=30&autoplay=1&rel=0";

afterEach(() => {
  act(() => stopPlaying());
  cleanup();
});

/** A host like the desktop app's: it permits frames for a presentation, and for a playing embed. */
function appHost(release = vi.fn()): { host: SlidesHost; allowFrames: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> } {
  const allowFrames = vi.fn(async () => release);
  const host = new MemoryHost();
  Object.assign(host, { willPresent: () => {}, allowFrames });
  return { host, allowFrames, release };
}

const scene = (host: SlidesHost, selection: string[] = ["e"]) => {
  const { deck, slide } = plainDeck([{ type: "embed", id: "e", x: 10, y: 20, w: 320, h: 180, url: WATCH } as unknown as Element]);
  return <EmbedLayer deck={deck} slide={slide} step={undefined} selection={selection} host={host} imageUrl={() => undefined} />;
};

const frame = (container: HTMLElement) => container.querySelector<HTMLIFrameElement>("iframe");

describe("playing an embed in the editor", () => {
  it("is offered where the host permits frames and has the means to, and not where the editor frames by itself", () => {
    expect(canPlay(appHost().host)).toBe(true);
    expect(canPlay(new MemoryHost())).toBe(false);
    const noMeans = new MemoryHost();
    Object.assign(noMeans, { willPresent: () => {} });
    expect(canPlay(noMeans)).toBe(false);
  });

  it("shows only the picture of the selected embed until Play, then the player, with the host told which page may load", async () => {
    const { host, allowFrames } = appHost();
    const view = render(scene(host));
    expect(frame(view.container)).toBeNull();
    await act(async () => startPlaying(host, "e", PLAYER));
    expect(allowFrames).toHaveBeenCalledWith([PLAYER]);
    expect(playingId()).toBe("e");
    const player = frame(view.container);
    expect(player?.getAttribute("src")).toBe(PLAYER);
    expect(player?.getAttribute("allow")).toContain("autoplay");
    expect(player?.getAttribute("tabindex")).toBe("0");
    // It takes the pointer, which the layer never does otherwise.
    expect(view.container.querySelector<HTMLElement>(".ks-embed-live")?.style.pointerEvents).toBe("auto");
    expect(view.container.querySelector(".ks-embed-layer")?.getAttribute("aria-hidden")).toBeNull();
  });

  it("ends with Esc, which the editor does not see, and the host takes its permission back", async () => {
    const { host, release } = appHost();
    const view = render(scene(host));
    await act(async () => startPlaying(host, "e", PLAYER));
    const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => void window.dispatchEvent(esc));
    expect(esc.defaultPrevented).toBe(true);
    expect(playingId()).toBeNull();
    expect(release).toHaveBeenCalledTimes(1);
    expect(frame(view.container)).toBeNull();
    // The next Esc is not taken.
    const again = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => void window.dispatchEvent(again));
    expect(again.defaultPrevented).toBe(false);
  });

  it("ends when something else is selected", async () => {
    const { host, release } = appHost();
    const view = render(scene(host));
    await act(async () => startPlaying(host, "e", PLAYER));
    view.rerender(scene(host, []));
    expect(playingId()).toBeNull();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("is not started when the host refuses to permit it, and a stop before the permission came wins", async () => {
    const host = new MemoryHost();
    Object.assign(host, { willPresent: () => {}, allowFrames: async () => Promise.reject(new Error("no")) });
    await act(async () => startPlaying(host, "e", PLAYER));
    expect(playingId()).toBeNull();

    const release = vi.fn();
    let permit: (value: () => void) => void = () => {};
    const slow = new MemoryHost();
    Object.assign(slow, { willPresent: () => {}, allowFrames: () => new Promise<() => void>((done) => (permit = done)) });
    const started = startPlaying(slow, "e", PLAYER);
    act(() => stopPlaying());
    await act(async () => {
      permit(release);
      await started;
    });
    expect(playingId()).toBeNull();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("leaves a browser host as it was: the selected page is framed at once, with no Play", () => {
    const view = render(scene(new MemoryHost()));
    expect(frame(view.container)?.getAttribute("src")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=30&rel=0");
  });
});
