import type { Deck, Slide } from "@kasten-slides/wasm";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { plainDeck } from "../render/testing/decks.ts";
import { Presenter } from "./Presenter.tsx";
import { elapsedAt, stopwatchFrom, toggled } from "./stopwatch.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const drawn = vi.hoisted(() => ({ slides: 0 }));
vi.mock("../render/index.ts", async (original) => {
  const real = await original<typeof import("../render/index.ts")>();
  return {
    ...real,
    SlideView: (props: React.ComponentProps<typeof real.SlideView>) => {
      drawn.slides += 1;
      return createElement(real.SlideView, props);
    },
  };
});

const slide = (id: string): Slide => ({ id, layout: "blank", elements: [] });
const deck: Deck = { ...plainDeck([]).deck, title: "The talk", slides: [slide("a"), slide("b")] };

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  drawn.slides = 0;
});

afterEach(async () => {
  vi.useRealTimers();
  await act(async () => root.unmount());
  host.remove();
});

describe("the clock of the presenter's view", () => {
  it("moves on each second without drawing the two slides again", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 29, 10, 0, 0));
    const since = Date.now();
    await act(async () => root.render(<Presenter deck={deck} imageUrl={() => undefined} position={{ h: 0, v: 0, f: -1 }} paused={false} since={since} onGo={() => {}} />));
    const first = drawn.slides;
    expect(first).toBeGreaterThan(0);
    await act(async () => void vi.advanceTimersByTime(5000));
    expect(host.querySelector('[data-fact="timer"]')?.textContent).toContain("00:05");
    expect(drawn.slides).toBe(first);
  });
});

describe("the stopwatch", () => {
  it("counts from its start, stops, goes on without the time it was stopped, and can be started again", () => {
    const watch = stopwatchFrom(1000);
    expect(elapsedAt(watch, 4000)).toBe(3000);
    const stopped = toggled(watch, 4000);
    expect(elapsedAt(stopped, 90_000)).toBe(3000);
    const going = toggled(stopped, 10_000);
    expect(elapsedAt(going, 12_000)).toBe(5000);
    expect(elapsedAt(stopwatchFrom(500), 100)).toBe(0);
  });
});
