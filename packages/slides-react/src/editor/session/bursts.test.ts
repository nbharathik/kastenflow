// A burst of nudges is one step of undo; a command that puts elements elsewhere says so, so the canvas can glide them there.

import { afterEach, describe, expect, it, vi } from "vitest";

import { newDeck } from "../../test/engine.ts";
import { shape } from "../factory.ts";
import { MemoryHost } from "../memory-host.ts";
import { BURST_MS } from "./elements.ts";
import { EditorSession } from "./session.ts";

afterEach(() => vi.useRealTimers());

async function open() {
  const session = new EditorSession(await newDeck("Talk"), new MemoryHost(), { saveDelay: 60_000 });
  session.slides.add({ layout: "blank" });
  const [a, b, c] = session.elements.insert([
    shape("rect", { x: 100, y: 100, w: 100, h: 50 }),
    shape("rect", { x: 300, y: 200, w: 100, h: 50 }),
    shape("rect", { x: 500, y: 300, w: 100, h: 50 }),
  ]) as [string, string, string];
  const at = (id: string) => session.slide.elements.find((e) => e.id === id) as { x: number; y: number };
  return { session, a, b, c, at };
}

describe("nudging", () => {
  it("makes the taps of an arrow key that follow one another one step of undo", async () => {
    const { session, a, at } = await open();
    session.select([a]);
    const steps = session.state.revision;
    for (let i = 0; i < 5; i += 1) session.elements.nudge(1, 0);
    expect(at(a).x).toBe(105);
    // Each tap changes the deck, so each is a revision; undo takes them all back at once.
    expect(session.state.revision).toBe(steps + 5);
    session.undo();
    expect(at(a).x).toBe(100);
    session.redo();
    expect(at(a).x).toBe(105);
  });

  it("starts a new step after a pause", async () => {
    vi.useFakeTimers();
    const { session, a, at } = await open();
    session.select([a]);
    session.elements.nudge(10, 0);
    vi.advanceTimersByTime(BURST_MS + 50);
    session.elements.nudge(10, 0);
    expect(at(a).x).toBe(120);
    session.undo();
    expect(at(a).x).toBe(110);
  });

  it("starts a new step for other elements, and after anything else was done between the taps", async () => {
    const { session, a, b, at } = await open();
    session.select([a]);
    session.elements.nudge(5, 0);
    session.select([b]);
    session.elements.nudge(5, 0);
    session.undo();
    expect(at(b).x).toBe(300);
    expect(at(a).x).toBe(105);

    session.select([a]);
    session.elements.nudge(5, 0);
    session.elements.style({ fill: { color: "accent2" } });
    session.elements.nudge(5, 0);
    session.undo();
    expect(at(a).x).toBe(110);
    // The step between them is its own: the colour goes, the first tap stays until the next undo.
    session.undo();
    expect(at(a).x).toBe(110);
    session.undo();
    expect(at(a).x).toBe(105);
  });

  it("does not take a step of something else into the burst", async () => {
    const { session, a, at } = await open();
    session.select([a]);
    session.elements.style({ fill: { color: "accent2" } });
    session.elements.nudge(5, 0);
    session.undo();
    expect(at(a).x).toBe(100);
    expect(session.slide.elements.find((e) => e.id === a)).toHaveProperty("style.fill.color", "accent2");
  });
});

describe("what comes to rest", () => {
  it("says an undo, a redo, an align and a quarter turn glide, and a drag or a nudge does not", async () => {
    const { session, a, b, c } = await open();
    expect(session.state.settle).toBeNull();
    session.elements.place(new Map([[a, { x: 150, y: 100, w: 100, h: 50 }]]));
    expect(session.state.settle).toBeNull();
    session.elements.nudge(1, 0, [b]);
    expect(session.state.settle).toBeNull();
    session.elements.align("left", [a, b, c]);
    expect(session.state.settle).toBe("glide");
    session.elements.rotateBy(90, [a]);
    expect(session.state.settle).toBe("glide");
    session.undo();
    expect(session.state.settle).toBe("undo");
    session.redo();
    expect(session.state.settle).toBe("redo");
    session.elements.nudge(1, 0, [b]);
    expect(session.state.settle).toBeNull();
  });
});
