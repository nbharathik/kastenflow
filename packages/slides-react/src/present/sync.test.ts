import type { Deck } from "@kasten-slides/wasm";
import { describe, expect, it } from "vitest";

import { plainDeck } from "../render/testing/decks.ts";
import { type PresentMessage, broadcastSync, memorySyncPair, readMessage } from "./sync.ts";

const deck = (): Deck => plainDeck([]).deck;

describe("messages between the two windows", () => {
  it("reads the four kinds and nothing else", () => {
    expect(readMessage({ type: "hello" })).toEqual({ type: "hello" });
    expect(readMessage({ type: "bye" })).toEqual({ type: "bye" });
    expect(readMessage({ type: "screen", target: "swap" })).toEqual({ type: "screen", target: "swap" });
    expect(readMessage({ type: "screen" })).toBeNull();
    expect(readMessage({ type: "screen", target: "" })).toBeNull();
    expect(readMessage({ type: "state", state: { indexh: 2, indexv: 1, indexf: 0, paused: true, overview: false } })).toEqual({ type: "state", state: { indexh: 2, indexv: 1, indexf: 0, paused: true, overview: false } });
    const sent = { type: "deck", deck: deck(), images: { "a.png": "blob:x" }, state: { indexh: 0, indexv: 0 }, since: 5 };
    expect(readMessage(sent)).toMatchObject({ type: "deck", since: 5, images: { "a.png": "blob:x" } });
    for (const other of [null, 3, "state", {}, { type: "run" }, { type: "state" }, { type: "state", state: { indexh: "1", indexv: 0 } }, { type: "deck", deck: {}, images: {}, state: { indexh: 0, indexv: 0 }, since: 1 }, { type: "deck", deck: deck(), images: null, state: { indexh: 0, indexv: 0 }, since: 1 }]) {
      expect(readMessage(other), JSON.stringify(other)).toBeNull();
    }
  });

  it("keeps only the parts of a state it knows", () => {
    const message = readMessage({ type: "state", state: { indexh: 1, indexv: 0, indexf: "x", paused: "yes", extra: 1 } });
    expect(message).toEqual({ type: "state", state: { indexh: 1, indexv: 0 } });
  });
});

describe("a link between two ends", () => {
  it("passes what one says to the other, and not back", async () => {
    const [a, b] = memorySyncPair();
    const heard: string[] = [];
    const echoed: string[] = [];
    b.subscribe((m) => heard.push(m.type));
    a.subscribe((m) => echoed.push(m.type));
    a.post({ type: "hello" });
    await Promise.resolve();
    expect(heard).toEqual(["hello"]);
    expect(echoed).toEqual([]);
    b.post({ type: "bye" });
    await Promise.resolve();
    expect(echoed).toEqual(["bye"]);
  });

  it("stops listening when asked, and when closed", async () => {
    const [a, b] = memorySyncPair();
    const heard: PresentMessage[] = [];
    const stop = b.subscribe((m) => heard.push(m));
    stop();
    a.post({ type: "hello" });
    await Promise.resolve();
    expect(heard).toEqual([]);
    b.subscribe((m) => heard.push(m));
    b.close();
    a.post({ type: "hello" });
    await Promise.resolve();
    expect(heard).toEqual([]);
  });

  it("drops a message that is not one", async () => {
    const [a, b] = memorySyncPair();
    const heard: PresentMessage[] = [];
    b.subscribe((m) => heard.push(m));
    a.post({ type: "run" } as unknown as PresentMessage);
    await Promise.resolve();
    expect(heard).toEqual([]);
  });
});

describe("windows of one address", () => {
  it("hear each other on a channel of the same name, and not one of another", async () => {
    const one = broadcastSync("talk");
    const two = broadcastSync("talk");
    const other = broadcastSync("elsewhere");
    const heard: string[] = [];
    const strangers: string[] = [];
    two.subscribe((m) => heard.push(m.type));
    other.subscribe((m) => strangers.push(m.type));
    one.post({ type: "hello" });
    await new Promise((done) => setTimeout(done, 50));
    expect(heard).toEqual(["hello"]);
    expect(strangers).toEqual([]);
    for (const end of [one, two, other]) end.close();
  });
});
