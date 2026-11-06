import type { Slide } from "@kasten-slides/wasm";
import { describe, expect, it } from "vitest";

import { AudioShow, type Voice, audioOf, soundKey, spanOf } from "./audio-show.ts";

class FakeVoice implements Voice {
  volume = 1;
  loop = false;
  at = 0;
  playing = false;
  disposed = false;
  private time: (() => void) | null = null;
  private end: (() => void) | null = null;
  constructor(readonly address: string) {}
  play(): void {
    this.playing = true;
  }
  pause(): void {
    this.playing = false;
  }
  onTime(listener: () => void): void {
    this.time = listener;
  }
  onEnd(listener: () => void): void {
    this.end = listener;
  }
  dispose(): void {
    this.disposed = true;
    this.playing = false;
  }
  tick(at: number): void {
    this.at = at;
    this.time?.();
  }
  finish(): void {
    this.end?.();
  }
}

function sound(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: "audio", id, x: 0, y: 0, w: 100, h: 100, src: `assets/${id}.mp3`, ...extra };
}

const slide = (id: string, ...elements: Record<string, unknown>[]): Slide => ({ id, layout: "blank", elements }) as unknown as Slide;

function show() {
  const voices: FakeVoice[] = [];
  const audio = new AudioShow((address) => {
    const voice = new FakeVoice(address);
    voices.push(voice);
    return voice;
  });
  return { audio, voices };
}

const url = (path: string): string => `blob:${path}`;

describe("the sounds on a slide", () => {
  it("are found in groups too, and each plays over at least one slide and at most 999", () => {
    const grouped = slide("s", { type: "group", id: "g", children: [sound("a")] }, sound("b"));
    expect(audioOf(grouped).map((a) => a.id)).toEqual(["a", "b"]);
    expect(spanOf(sound("x") as never)).toBe(1);
    expect(spanOf(sound("x", { across: 3 }) as never)).toBe(3);
    expect(spanOf(sound("x", { across: 0 }) as never)).toBe(1);
    expect(spanOf(sound("x", { across: 5000 }) as never)).toBe(999);
    expect(soundKey("s-1", "e-2")).toBe("s-1/e-2");
  });
});

describe("a show with sound", () => {
  it("starts a sound that plays with its slide, at its volume, and does not start the others", () => {
    const { audio, voices } = show();
    const slides = [slide("s1", sound("a", { autoplay: true, volume: 0.4 }), sound("b"))];
    audio.enter(slides, 0, url);
    expect(voices).toHaveLength(1);
    expect(voices[0]?.address).toBe("blob:assets/a.mp3");
    expect(voices[0]?.volume).toBe(0.4);
    expect(voices[0]?.playing).toBe(true);
    expect(audio.playing()).toEqual(["s1/a"]);
  });

  it("goes on over the slides it was told to and stops when it has gone past them", () => {
    const { audio, voices } = show();
    const slides = [slide("s1", sound("a", { autoplay: true, across: 3 })), slide("s2"), slide("s3"), slide("s4")];
    audio.enter(slides, 0, url);
    audio.enter(slides, 1, url);
    audio.enter(slides, 2, url);
    expect(voices).toHaveLength(1);
    expect(voices[0]?.disposed).toBe(false);
    audio.enter(slides, 3, url);
    expect(voices[0]?.disposed).toBe(true);
    expect(audio.playing()).toEqual([]);
  });

  it("stops a one-slide sound when the show leaves its slide, and going back starts it again", () => {
    const { audio, voices } = show();
    const slides = [slide("s1", sound("a", { autoplay: true })), slide("s2")];
    audio.enter(slides, 0, url);
    audio.enter(slides, 1, url);
    expect(voices[0]?.disposed).toBe(true);
    audio.enter(slides, 0, url);
    expect(voices).toHaveLength(2);
    expect(voices[1]?.playing).toBe(true);
  });

  it("is started by a click on its chip and stopped by another, and only for a sound on the slide shown", () => {
    const { audio, voices } = show();
    const slides = [slide("s1", sound("a"))];
    audio.enter(slides, 0, url);
    expect(audio.hears("a")).toBe(true);
    expect(audio.hears("nope")).toBe(false);
    expect(audio.toggle("a")).toBe(true);
    expect(voices[0]?.playing).toBe(true);
    expect(audio.toggle("a")).toBe(true);
    expect(voices[0]?.disposed).toBe(true);
    expect(audio.toggle("nope")).toBe(false);
  });

  it("plays only the part between its start and end, stopping at the end or going back when it loops", () => {
    const { audio, voices } = show();
    const slides = [slide("s1", sound("a", { autoplay: true, start: 5, end: 9 }), sound("b", { autoplay: true, start: 1, end: 3, looped: true }))];
    audio.enter(slides, 0, url);
    const [plain, looped] = voices;
    expect(plain?.at).toBe(5);
    expect(looped?.loop).toBe(false);
    plain?.tick(9);
    expect(plain?.disposed).toBe(true);
    looped?.tick(3);
    expect(looped?.at).toBe(1);
    expect(looped?.disposed).toBe(false);
  });

  it("lets a sound that reached its end be started again, and ignores a source it has no address for", () => {
    const { audio, voices } = show();
    const slides = [slide("s1", sound("a"), sound("b", { autoplay: true }))];
    audio.enter(slides, 0, () => undefined);
    expect(voices).toHaveLength(0);
    audio.enter(slides, 0, url);
    voices[0]?.finish();
    expect(audio.playing()).toEqual([]);
    audio.toggle("a");
    expect(audio.playing()).toEqual(["s1/a"]);
  });

  it("stops everything when the show ends", () => {
    const { audio, voices } = show();
    audio.enter([slide("s1", sound("a", { autoplay: true, across: 9 }))], 0, url);
    audio.dispose();
    expect(voices.every((voice) => voice.disposed)).toBe(true);
    expect(audio.playing()).toEqual([]);
  });
});
