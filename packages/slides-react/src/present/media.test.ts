import { describe, expect, it, vi } from "vitest";

import { MediaMemory, createMediaLink, mediaKey, readMedia } from "./media.ts";
import { videoPaths } from "./show-images.ts";
import { plainDeck } from "../render/testing/decks.ts";

describe("what a show remembers about its videos", () => {
  it("keeps a place for each video, and forgets one when it is told to", () => {
    const memory = new MediaMemory();
    expect(memory.get("a/v")).toBe(0);
    memory.set("a/v", 12.5);
    memory.set("b/v", 3);
    expect(memory.get("a/v")).toBe(12.5);
    memory.forget("a/v");
    expect(memory.get("a/v")).toBe(0);
    expect(memory.get("b/v")).toBe(3);
  });

  it("does not keep a place that is not a time", () => {
    const memory = new MediaMemory();
    memory.set("a/v", Number.NaN);
    memory.set("a/v", -4);
    expect(memory.get("a/v")).toBe(0);
  });

  it("names a video by its slide and its element", () => {
    expect(mediaKey("s1", "e2")).toBe("s1/e2");
  });
});

describe("the word between two windows' videos", () => {
  it("reads a well made event and nothing else", () => {
    expect(readMedia({ key: "s/e", action: "seek", time: 4 })).toEqual({ key: "s/e", action: "seek", time: 4 });
    for (const bad of [null, 4, {}, { key: "", action: "play", time: 0 }, { key: "s/e", action: "rewind", time: 0 }, { key: "s/e", action: "play", time: -1 }, { key: "s/e", action: "play", time: Number.POSITIVE_INFINITY }, { key: "s/e", action: "play", time: "4" }]) {
      expect(readMedia(bad)).toBeNull();
    }
  });

  it("passes what this window's video does to the other window, and what the other says to the listeners", () => {
    const sent = vi.fn();
    const heard = vi.fn();
    const link = createMediaLink(sent);
    const stop = link.channel.subscribe(heard);
    link.channel.send({ key: "s/e", action: "play", time: 1 });
    expect(sent).toHaveBeenCalledWith({ key: "s/e", action: "play", time: 1 });
    link.receive({ key: "s/e", action: "pause", time: 2 });
    expect(heard).toHaveBeenCalledWith({ key: "s/e", action: "pause", time: 2 });
    stop();
    link.receive({ key: "s/e", action: "pause", time: 3 });
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("is quiet where there is no other window, and says whether the video is muted", () => {
    const link = createMediaLink(null, true);
    expect(() => link.channel.send({ key: "s/e", action: "play", time: 0 })).not.toThrow();
    expect(link.channel.muted).toBe(true);
    expect(createMediaLink(null).channel.muted).toBe(false);
  });
});

describe("the files of a show's videos", () => {
  it("are found at any depth, once each", () => {
    const { deck } = plainDeck([]);
    const video = (id: string, src: string) => ({ type: "video", id, x: 0, y: 0, w: 10, h: 10, src });
    const slides = [
      { id: "s1", layout: "blank", elements: [video("a", "assets/one.mp4"), { type: "group", id: "g", x: 0, y: 0, w: 1, h: 1, children: [video("b", "assets/two.mp4"), video("c", "assets/one.mp4")] }] },
    ];
    expect(videoPaths({ ...deck, slides } as never)).toEqual(["assets/one.mp4", "assets/two.mp4"]);
  });
});
