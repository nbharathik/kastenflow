// What a show remembers about its videos: where each one had got to (so a video the person comes back to carries on from there and
// does not start again), and the word that passes between the audience's window and the presenter's when one of them plays, pauses or
// seeks, so that the same video is at the same place in both. A video is known by its slide and its element: `slide/element`.

export type MediaAction = "play" | "pause" | "seek";

export interface MediaEvent {
  key: string;
  action: MediaAction;
  /** Seconds into the video. */
  time: number;
}

const isTime = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 1e6;

/** A media message from the other window, or null when what came is not one. */
export function readMedia(value: unknown): MediaEvent | null {
  if (typeof value !== "object" || value === null) return null;
  const event = value as Record<string, unknown>;
  if (typeof event.key !== "string" || event.key === "" || event.key.length > 400 || !isTime(event.time)) return null;
  return event.action === "play" || event.action === "pause" || event.action === "seek" ? { key: event.key, action: event.action, time: event.time } : null;
}

/** How far each video of the show had got. A video that played to its end starts again next time. */
export class MediaMemory {
  private readonly places = new Map<string, number>();

  get(key: string): number {
    return this.places.get(key) ?? 0;
  }

  set(key: string, seconds: number): void {
    if (Number.isFinite(seconds) && seconds >= 0) this.places.set(key, seconds);
  }

  forget(key: string): void {
    this.places.delete(key);
  }
}

/** What the videos of a show talk through. */
export interface MediaChannel {
  memory: MediaMemory;
  /** Videos play without sound (the presenter's view: the audience's window has the sound). */
  muted: boolean;
  /** This window's video did something: the other window is told. */
  send(event: MediaEvent): void;
  /** Hears what the other window's videos did. */
  subscribe(listener: (event: MediaEvent) => void): () => void;
}

export interface MediaLink {
  channel: MediaChannel;
  /** The other window said something about a video. */
  receive(event: MediaEvent): void;
}

/** A channel for one window; `post` carries what its videos do to the other window. */
export function createMediaLink(post: ((event: MediaEvent) => void) | null, muted = false, memory = new MediaMemory()): MediaLink {
  const listeners = new Set<(event: MediaEvent) => void>();
  return {
    channel: {
      memory,
      muted,
      send: (event) => post?.(event),
      subscribe(listener) {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
    },
    receive: (event) => {
      for (const listener of [...listeners]) listener(event);
    },
  };
}

/** The key of a video: where it is in the deck. */
export const mediaKey = (slideId: string, elementId: string): string => `${slideId}/${elementId}`;
