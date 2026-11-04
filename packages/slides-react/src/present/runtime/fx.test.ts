import { afterEach, describe, expect, it, vi } from "vitest";

import { departures, fxPlayer, playFx, schedule, startFrame } from "./fx.js";

const node = (id = "a"): HTMLElement => {
  const element = document.createElement("div");
  element.setAttribute("data-el", id);
  element.animate = vi.fn(() => ({ addEventListener: vi.fn() })) as unknown as typeof element.animate;
  return element;
};

afterEach(() => vi.unstubAllGlobals());

describe("where an effect begins", () => {
  it("starts a fly from outside the slide on the side it comes from", () => {
    const reach = { left: 100, right: 700, up: 50, down: 450 };
    expect(startFrame({ kind: "fly", direction: "left" }, reach)).toEqual({ translate: "-100px 0" });
    expect(startFrame({ kind: "fly", direction: "right" }, reach)).toEqual({ translate: "700px 0" });
    expect(startFrame({ kind: "fly", direction: "up" }, reach)).toEqual({ translate: "0 -50px" });
    expect(startFrame({ kind: "fly" }, reach)).toEqual({ translate: "0 450px" });
  });

  it("moves only what the browser can move cheaply: transform, opacity and clip-path", () => {
    const allowed = new Set(["opacity", "translate", "scale", "clipPath"]);
    for (const kind of ["fade", "fadeUp", "grow", "fly", "zoom", "wipe", "float", "pop", "path"]) {
      const frame = startFrame({ kind, dx: 10, dy: 5 }, null);
      expect(frame, kind).not.toBeNull();
      for (const key of Object.keys(frame ?? {})) expect(allowed.has(key), `${kind}: ${key}`).toBe(true);
    }
    expect(startFrame({ kind: "appear" }, null)).toBeNull();
    expect(startFrame({ kind: "pulse" }, null)).toBeNull();
  });

  it("clips a wipe from the side it comes from", () => {
    expect(startFrame({ kind: "wipe", direction: "left" }, null)).toEqual({ clipPath: "inset(0 100% 0 0)" });
    expect(startFrame({ kind: "wipe" }, null)).toEqual({ clipPath: "inset(100% 0 0 0)" });
  });

  it("starts a motion path where it says, from its own place", () => {
    expect(startFrame({ kind: "path", dx: 120, dy: -30 }, null)).toEqual({ translate: "120px -30px" });
  });
});

describe("when each effect of a click begins", () => {
  it("begins the first with the click, a 'with' effect with the one before and an 'after' effect when that ends", () => {
    const times = schedule([{ kind: "fade", duration: 0.5 }, { kind: "fade", duration: 0.25 }, { kind: "fade", duration: 1, start: "after" }, { kind: "fade", start: "with", delay: 0.1 }]);
    expect(times.map((t) => t.at)).toEqual([0, 0, 250, 350]);
    expect(times.map((t) => t.ms)).toEqual([500, 250, 1000, 400]);
  });
});

describe("playing the effects of a click", () => {
  it("plays each effect on its element, delayed to its time, and holds the start until then", () => {
    const [a, b] = [node("a"), node("b")];
    playFx([
      { element: a, role: "enter", fx: { kind: "fade", duration: 0.5 } },
      { element: b, role: "enter", fx: { kind: "fade", start: "after" } },
    ]);
    expect(a.animate).toHaveBeenCalledWith([{ opacity: 0 }], expect.objectContaining({ duration: 500, delay: 0, fill: "backwards" }));
    expect(b.animate).toHaveBeenCalledWith([{ opacity: 0 }], expect.objectContaining({ delay: 500 }));
  });

  it("plays an exit backwards and tells when it is done", () => {
    const a = node();
    const done = vi.fn();
    const listeners: Record<string, () => void> = {};
    a.animate = vi.fn(() => ({ addEventListener: (type: string, f: () => void) => (listeners[type] = f) })) as unknown as typeof a.animate;
    playFx([{ element: a, role: "exit", fx: { kind: "fade" }, done }]);
    expect(a.animate).toHaveBeenCalledWith([{ opacity: 0 }], expect.objectContaining({ direction: "reverse", fill: "both" }));
    listeners.finish?.();
    expect(done).toHaveBeenCalled();
  });

  it("an appear has nothing to play, and an exit of it is over at once", () => {
    const a = node();
    const done = vi.fn();
    playFx([{ element: a, role: "exit", fx: { kind: "appear" }, done }]);
    expect(a.animate).not.toHaveBeenCalled();
    expect(done).toHaveBeenCalled();
  });

  it("only fades for a person who asked for less movement, and does not pulse", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce") }));
    const [a, b] = [node("a"), node("b")];
    playFx([
      { element: a, role: "enter", fx: { kind: "fly", direction: "left" } },
      { element: b, role: "emph", fx: { kind: "pulse" } },
    ]);
    expect(a.animate).toHaveBeenCalledWith([{ opacity: 0 }], expect.anything());
    expect(b.animate).not.toHaveBeenCalled();
  });

  it("is not stopped by an element the browser will not animate", () => {
    const bad = node("bad");
    (bad.animate as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("no");
    });
    const good = node("good");
    expect(() =>
      playFx([
        { element: bad, role: "enter", fx: { kind: "fade" } },
        { element: good, role: "enter", fx: { kind: "fade" } },
      ]),
    ).not.toThrow();
    expect(good.animate).toHaveBeenCalled();
  });
});

describe("what goes out", () => {
  it("keeps a copy of the elements it is told will go out and gives back those that are gone", () => {
    const [a, b] = [node("a"), node("b")];
    const stage = document.createElement("div");
    stage.append(a, b);
    const gone = departures<HTMLElement>((n) => n.getAttribute("data-el") ?? "", (key) => key === "a");
    expect(gone([a, b])).toEqual([]);
    const left = gone([b]);
    expect(left.map((l) => l.key)).toEqual(["a"]);
    expect(left[0]?.parent).toBe(stage);
  });
});

describe("the player of a slide's effects", () => {
  const plan = { 1: [{ id: "a", role: "enter" as const, fx: { kind: "fade" } }], 2: [{ id: "b", role: "exit" as const, fx: { kind: "fade" } }] };

  it("learns the first time, plays the effects of a step the slide has moved on to, and says which elements it took", () => {
    const [a, b] = [node("a"), node("b")];
    const stage = document.createElement("div");
    stage.append(a, b);
    const player = fxPlayer(plan);
    expect([...player.play([a, b], stage, 0)]).toEqual([]);
    expect([...player.play([a, b], stage, 1)]).toEqual(["a"]);
    expect(a.animate).toHaveBeenCalledTimes(1);
    expect(b.animate).not.toHaveBeenCalled();
  });

  it("draws an element once more while it goes out, and takes the copy away when it has", () => {
    const [a, b] = [node("a"), node("b")];
    const stage = document.createElement("div");
    stage.append(a, b);
    // A copy is a new element: the browser's own animate is what it has.
    const holder = HTMLElement.prototype as unknown as { animate?: unknown };
    holder.animate = vi.fn(() => ({ addEventListener: vi.fn() }));
    try {
      const player = fxPlayer(plan);
      player.play([a, b], stage, 1);
      // The slide at step 2 no longer draws b.
      stage.removeChild(b);
      const taken = player.play([a], stage, 2);
      expect([...taken]).toEqual(["b"]);
      const copy = stage.querySelector('[data-el="b"]') as HTMLElement | null;
      expect(copy).not.toBeNull();
      expect(copy?.style.pointerEvents).toBe("none");
    } finally {
      delete holder.animate;
    }
  });

  it("plays nothing on a slide that is not on view, or going back", () => {
    const [a] = [node("a")];
    const stage = document.createElement("div");
    stage.append(a);
    const player = fxPlayer(plan);
    player.play([a], stage, 0, false);
    expect([...player.play([a], stage, 1, false)]).toEqual([]);
    expect(a.animate).not.toHaveBeenCalled();
    const back = fxPlayer(plan);
    back.play([a], stage, 2);
    back.play([a], stage, 1);
    expect(a.animate).not.toHaveBeenCalled();
  });
});
