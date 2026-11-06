// The sound of a show. An audio element plays when its slide comes up (or when its chip is clicked), keeps playing over the next slides it
// was told to (`across`), and stops by itself when it has gone past them. One sound is one voice; the show owns them all, and a window
// that closes (or a show that ends) stops every one. A web page cannot be trusted to allow sound before the first touch, so a refused
// play is dropped quietly: the chip, when it is shown, can be clicked.

import type { Element, Slide } from "@kasten-slides/wasm";

import { inside, pastEnd, trimOf, volumeOf } from "../video-trim.ts";

export type AudioElement = Extract<Element, { type: "audio" }>;

/** The sounds on a slide, those in groups too. */
export function audioOf(slide: Slide): AudioElement[] {
  const found: AudioElement[] = [];
  const walk = (elements: readonly Element[]): void => {
    for (const element of elements) {
      if (element.type === "audio") found.push(element);
      else if (element.type === "group") walk(element.children);
    }
  };
  walk(slide.elements);
  return found;
}

/** How many slides a sound plays over, its own included: 1 to 999. */
export const spanOf = (audio: AudioElement): number => {
  const n = typeof audio.across === "number" && Number.isFinite(audio.across) ? Math.floor(audio.across) : 1;
  return Math.min(999, Math.max(1, n));
};

/** A sound is known by its slide and its element: `slide/element`. */
export const soundKey = (slideId: string, elementId: string): string => `${slideId}/${elementId}`;

/** One sound being played. */
export interface Voice {
  volume: number;
  loop: boolean;
  /** Seconds into the file. */
  at: number;
  play(): void;
  pause(): void;
  onTime(listener: () => void): void;
  onEnd(listener: () => void): void;
  dispose(): void;
}

export type VoiceFactory = (address: string) => Voice;

/** A voice made of the browser's audio element. */
export const browserVoice: VoiceFactory = (address) => {
  const node = new Audio(address);
  node.preload = "auto";
  return {
    get volume() {
      return node.volume;
    },
    set volume(value: number) {
      node.volume = value;
    },
    get loop() {
      return node.loop;
    },
    set loop(value: boolean) {
      node.loop = value;
    },
    get at() {
      return node.currentTime;
    },
    set at(value: number) {
      node.currentTime = value;
    },
    play: () => void node.play().catch(() => {}),
    pause: () => node.pause(),
    onTime: (listener) => node.addEventListener("timeupdate", listener),
    onEnd: (listener) => node.addEventListener("ended", listener),
    dispose: () => {
      node.pause();
      node.removeAttribute("src");
      node.load();
    },
  };
};

interface Sounding {
  voice: Voice;
  /** The slide it began on, and how many it plays over. */
  from: number;
  span: number;
}

/** Plays the sounds of the slides a show comes to. */
export class AudioShow {
  private readonly sounding = new Map<string, Sounding>();
  private slides: readonly Slide[] = [];
  private index = -1;
  private urlOf: (path: string) => string | undefined = () => undefined;

  constructor(private readonly make: VoiceFactory = browserVoice) {}

  /** The keys of the sounds that are playing now. */
  playing(): string[] {
    return [...this.sounding.keys()];
  }

  /** The show is on slide `index` of `slides`: sounds past their slides stop, and those that begin here and play by themselves start. */
  enter(slides: readonly Slide[], index: number, urlOf: (path: string) => string | undefined): void {
    this.slides = slides;
    this.index = index;
    this.urlOf = urlOf;
    for (const [key, sound] of [...this.sounding]) {
      if (index < sound.from || index >= sound.from + sound.span) this.stop(key);
    }
    const slide = slides[index];
    if (!slide) return;
    for (const audio of audioOf(slide)) {
      const key = soundKey(slide.id, audio.id);
      if (audio.autoplay && !this.sounding.has(key)) this.start(key, audio);
    }
  }

  /** A click on the chip of a sound on this slide: it starts, or stops when it is playing. Resolves to whether the click was for a sound. */
  toggle(elementId: string): boolean {
    const slide = this.slides[this.index];
    const audio = slide ? audioOf(slide).find((candidate) => candidate.id === elementId) : undefined;
    if (!slide || !audio) return false;
    const key = soundKey(slide.id, audio.id);
    if (this.sounding.has(key)) this.stop(key);
    else this.start(key, audio);
    return true;
  }

  /** Whether a click on this element of the slide on show is for a sound. */
  hears(elementId: string): boolean {
    const slide = this.slides[this.index];
    return slide ? audioOf(slide).some((audio) => audio.id === elementId) : false;
  }

  stop(key: string): void {
    const sound = this.sounding.get(key);
    if (!sound) return;
    this.sounding.delete(key);
    sound.voice.dispose();
  }

  /** Stops every sound: the show has ended. */
  dispose(): void {
    for (const key of [...this.sounding.keys()]) this.stop(key);
  }

  private start(key: string, audio: AudioElement): void {
    const address = audio.src ? this.urlOf(audio.src) : undefined;
    if (!address) return;
    const trim = trimOf(audio);
    const voice = this.make(address);
    voice.volume = volumeOf(audio.volume);
    voice.loop = Boolean(audio.looped) && trim.end === null && trim.start === 0;
    voice.at = trim.start;
    voice.onTime(() => {
      if (!pastEnd(trim, voice.at)) return;
      if (audio.looped) voice.at = trim.start;
      else this.stop(key);
    });
    voice.onEnd(() => {
      if (!audio.looped) this.stop(key);
    });
    this.sounding.set(key, { voice, from: this.index, span: spanOf(audio) });
    voice.at = inside(trim, trim.start);
    voice.play();
  }
}
