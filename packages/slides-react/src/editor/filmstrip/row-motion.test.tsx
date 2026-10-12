import { act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ROW, setup } from "./list-support.tsx";
import { idsOf } from "./test-support.ts";
import { planMotion } from "./row-motion.ts";

/** What the page is given to animate, as the browser's `Element.animate` takes it. */
const animate = vi.fn((..._args: unknown[]) => ({ cancel: () => {}, finished: Promise.resolve() }));

const calls = () => animate.mock.calls.map(([keyframes]) => keyframes as Keyframe[]);
/** The rows that were moved to their places (a row that slides in starts faded out, and is not one of them). */
const moved = () =>
  calls().flatMap((frames) => {
    const first = frames[0];
    const transform = first?.transform;
    return first?.opacity === undefined && typeof transform === "string" ? [transform] : [];
  });

beforeEach(() => {
  animate.mockClear();
  Object.defineProperty(Element.prototype, "animate", { value: animate, configurable: true, writable: true });
  document.documentElement.dataset.motion = "on";
});
afterEach(() => {
  cleanup();
  delete (Element.prototype as { animate?: unknown }).animate;
  delete document.documentElement.dataset.motion;
});

describe("what moves when the list changes", () => {
  it("is every row that is somewhere else, by how far it was above its new place, and every row that is new", () => {
    const before = new Map([
      ["a", 6],
      ["b", 110],
      ["c", 214],
    ]);
    const after = new Map([
      ["b", 6],
      ["c", 110],
      ["a", 214],
      ["d", 318],
    ]);
    const plan = planMotion(before, after);
    expect([...plan.moved]).toEqual([
      ["b", 104],
      ["c", 104],
      ["a", -208],
    ]);
    expect(plan.added).toEqual(["d"]);
    expect(planMotion(before, before)).toEqual({ moved: new Map(), added: [] });
  });
});

describe("the filmstrip", () => {
  it("does not move anything when it is first drawn, or when a slide only changes inside", async () => {
    const { session } = await setup({ slides: 3 });
    expect(animate).not.toHaveBeenCalled();
    const [, second] = idsOf(session);
    act(() => session.slides.setNotes("A note", second!));
    expect(animate).not.toHaveBeenCalled();
  });

  it("moves the rows of a slide that was dragged to another place, from where they were", async () => {
    const { session } = await setup({ slides: 4 });
    const ids = idsOf(session);
    act(() => session.slides.move([ids[0]!], 2));
    expect(idsOf(session)).toEqual([ids[1], ids[2], ids[0], ids[3]]);
    // The slide moved goes two rows down, so it starts two rows above its place; the two it passed started one below theirs.
    expect(moved().sort()).toEqual([`translateY(${-2 * ROW}px)`, `translateY(${ROW}px)`, `translateY(${ROW}px)`].sort());
    // Each goes to where it is: the animation ends with no transform.
    expect(calls().every((frames) => frames.at(-1)?.transform === "none")).toBe(true);
  });

  it("moves them back when the move is undone", async () => {
    const { session } = await setup({ slides: 3 });
    const ids = idsOf(session);
    act(() => session.slides.move([ids[2]!], 0));
    animate.mockClear();
    act(() => session.undo());
    expect(moved()).toHaveLength(3);
  });

  it("slides a new slide in, and moves nothing that was above it", async () => {
    const { session } = await setup({ slides: 3 });
    act(() => void session.slides.add({ after: idsOf(session)[2]! }));
    const frames = calls();
    expect(frames).toHaveLength(1);
    expect(frames[0]?.[0]).toMatchObject({ opacity: 0 });
    expect(frames[0]?.[1]).toMatchObject({ opacity: 1, transform: "none" });
  });

  it("moves the rows below a new slide down to make room", async () => {
    const { session } = await setup({ slides: 3 });
    act(() => void session.slides.add({ after: idsOf(session)[0]! }));
    // The new row slides in, and the two rows that follow it were one row higher.
    expect(moved()).toEqual([`translateY(${-ROW}px)`, `translateY(${-ROW}px)`]);
    expect(calls().filter((frames) => frames[0]?.opacity === 0)).toHaveLength(1);
  });

  it("takes its time from the host's token, and stands still when that is nothing", async () => {
    const { session, container } = await setup({ slides: 4 });
    const strip = container.querySelector<HTMLElement>(".ks-fs-list")!;
    const ids = idsOf(session);
    act(() => session.slides.move([ids[0]!], 2));
    expect(animate.mock.calls.every(([, options]) => (options as KeyframeAnimationOptions).duration === 160)).toBe(true);
    animate.mockClear();
    strip.style.setProperty("--ks-base", "300ms");
    act(() => session.undo());
    expect(animate.mock.calls.every(([, options]) => (options as KeyframeAnimationOptions).duration === 300)).toBe(true);
    expect(animate).toHaveBeenCalled();
    animate.mockClear();
    strip.style.setProperty("--ks-base", "0ms");
    act(() => session.redo());
    expect(animate).not.toHaveBeenCalled();
  });

  it("stands still while the host's motion setting is off", async () => {
    const { session } = await setup({ slides: 4 });
    document.documentElement.dataset.motion = "off";
    const ids = idsOf(session);
    act(() => session.slides.move([ids[0]!], 2));
    act(() => void session.slides.add());
    expect(animate).not.toHaveBeenCalled();
  });

  it("stands still in a browser that cannot animate", async () => {
    const { session } = await setup({ slides: 4 });
    delete (Element.prototype as { animate?: unknown }).animate;
    const ids = idsOf(session);
    expect(() => act(() => session.slides.move([ids[0]!], 2))).not.toThrow();
  });
});
