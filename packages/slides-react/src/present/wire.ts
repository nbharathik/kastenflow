// A link between the two windows over a wire that may give a window its own words back, and that gives both windows the same
// words in an order of its own. Every word goes with the name of the window that said it, and a window drops the words that carry
// its own name. Every position goes with a number too: the number of the last position seen, one on, so that when both windows
// move in the same instant they end on the same one (the higher number wins, the higher name for a tie) and neither jumps back.

import { type PresentMessage, type PresentSync, readMessage } from "./sync.ts";

/** What a window can send and hear: the words of the other, and its own when the wire echoes. */
export interface Wire {
  send(payload: unknown): void;
  /** Hears every payload that reaches this window; returns how to stop. */
  listen(handler: (payload: unknown) => void): () => void;
  close(): void;
}

/** Where a position stands in the order: its number, and who said it. */
interface Place {
  n: number;
  from: string;
}

const later = (a: Place, b: Place): boolean => a.n > b.n || (a.n === b.n && a.from > b.from);

let made = 0;

/** A name for a window's end of a link, different from every other's. */
export function newName(): string {
  made += 1;
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${made}`;
}

function placeOf(payload: unknown): Place {
  const record = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  return {
    n: typeof record.n === "number" && Number.isFinite(record.n) ? record.n : 0,
    from: typeof record.from === "string" ? record.from : "",
  };
}

/** The link of one window over `wire`. `name` is this end's own; a name is made when none is given. */
export function linkOver(wire: Wire, name: string = newName()): PresentSync {
  const listeners = new Set<(message: PresentMessage) => void>();
  let clock = 0;
  // The last position seen or said. A deck or a goodbye starts the order again: a talk that begins anew (a window that was
  // reloaded counts from nothing) is not mistaken for an old one.
  let last: Place | null = null;
  const stop = wire.listen((payload) => {
    const place = placeOf(payload);
    // A name is only on words from a window; the core's own word that a window closed has none.
    if (place.from === name) return;
    const message = readMessage(payload);
    if (!message) return;
    if (message.type === "state") {
      if (last && !later(place, last)) return;
      last = place;
      clock = Math.max(clock, place.n);
    } else if (message.type === "deck" || message.type === "bye") {
      last = null;
    }
    for (const listener of [...listeners]) listener(message);
  });
  return {
    post(message) {
      if (message.type === "state") {
        clock += 1;
        last = { n: clock, from: name };
        wire.send({ ...message, from: name, n: clock });
        return;
      }
      if (message.type === "deck" || message.type === "bye") last = null;
      wire.send({ ...message, from: name });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    close() {
      stop();
      listeners.clear();
      wire.close();
    },
  };
}

/**
 * A wire inside one page, for tests, that does what the core's global listener does: what one end sends reaches both (after the
 * current task, in the order sent), the sender's own included. `end` makes a window's end; `inject` is a word from the core.
 */
export function echoBus(): { end(name: string): PresentSync; inject(payload: unknown): void } {
  const ends = new Set<(payload: unknown) => void>();
  const deliver = (payload: unknown): void => {
    const copy = structuredClone(payload);
    queueMicrotask(() => {
      for (const hear of [...ends]) hear(copy);
    });
  };
  return {
    inject: deliver,
    end(name) {
      const mine = new Set<(payload: unknown) => void>();
      const hear = (payload: unknown): void => {
        for (const handler of [...mine]) handler(payload);
      };
      ends.add(hear);
      return linkOver(
        {
          send: deliver,
          listen(handler) {
            mine.add(handler);
            return () => void mine.delete(handler);
          },
          close() {
            mine.clear();
            ends.delete(hear);
          },
        },
        name,
      );
    },
  };
}

/** Two ends over a wire that echoes. */
export function echoingPair(): [PresentSync, PresentSync] {
  const bus = echoBus();
  return [bus.end("a"), bus.end("b")];
}
