// Which embed is playing in the editor. A web page or a video is only a picture while it is selected (a slide of many embeds stays light,
// and nothing off the slide runs); "Play" on the selected embed makes it live, and Esc, another selection or another slide ends it.
// A host that has to permit the frames a deck embeds (the desktop app) is told which page may load, for as long as it plays.

import { useSyncExternalStore } from "react";

import type { SlidesHost } from "../editor/host.ts";

interface Playing {
  id: string;
  release: (() => void) | undefined;
}

let playing: Playing | null = null;
/** Counts the starts, so that a start that was slow to be allowed does not win over a stop or a newer start. */
let turn = 0;
const listeners = new Set<() => void>();

const tell = (): void => listeners.forEach((listener) => listener());

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** The id of the embed that is playing, or null. */
export const playingId = (): string | null => playing?.id ?? null;

export function usePlayingEmbed(): string | null {
  return useSyncExternalStore(subscribe, playingId, () => null);
}

/** Ends the playing, if any. */
export function stopPlaying(): void {
  turn += 1;
  const was = playing;
  playing = null;
  if (was) {
    try {
      was.release?.();
    } catch {
      // A host that cannot take its permission back has nothing more to do here.
    }
    tell();
  }
}

/** Makes the embed `id` live, once the host has permitted its page (`address`) to load. */
export async function startPlaying(host: SlidesHost, id: string, address: string): Promise<void> {
  stopPlaying();
  const mine = turn;
  let release: (() => void) | undefined;
  try {
    const given = await host.allowFrames?.([address]);
    release = typeof given === "function" ? given : undefined;
  } catch {
    // The host refused to permit it: the page is not played, and the chip stays as it was.
    return;
  }
  if (mine !== turn) {
    release?.();
    return;
  }
  playing = { id, release };
  tell();
}
