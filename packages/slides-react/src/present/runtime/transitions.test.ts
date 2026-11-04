import { afterEach, describe, expect, it, vi } from "vitest";

import { KINDS, framesOf, playTransition, specOf, transitionListener } from "./transitions.js";

afterEach(() => vi.unstubAllGlobals());

const slide = (attrs: Record<string, string> = {}): HTMLElement => {
  const section = document.createElement("section");
  for (const [k, v] of Object.entries(attrs)) section.setAttribute(k, v);
  section.animate = vi.fn(() => ({ addEventListener: vi.fn() })) as unknown as typeof section.animate;
  return section;
};

describe("how each kind moves", () => {
  it("pushes both slides along the same line, the new one in from the side it comes from", () => {
    const f = framesOf("push", "left", false, false);
    expect(f?.enter[0]).toEqual({ translate: "-100% 0%" });
    expect(f?.leave[1]).toEqual({ translate: "100% 0%" });
  });

  it("turns the motion round going back", () => {
    expect(framesOf("push", "left", true, false)?.enter[0]).toEqual({ translate: "100% 0%" });
    expect(framesOf("cover", "up", true, false)?.enter[0]).toEqual({ translate: "0% 100%" });
  });

  it("covers with the new slide on top and uncovers with the old one", () => {
    expect(framesOf("cover", "right", false, false)?.top).toBe("enter");
    expect(framesOf("uncover", "right", false, false)?.top).toBe("leave");
    expect(framesOf("uncover", "right", false, false)?.leave[1]).toEqual({ translate: "100% 0%" });
  });

  it("wipes the new slide in from a side with a clip path", () => {
    expect(framesOf("wipe", "right", false, false)?.enter[0]).toEqual({ clipPath: "inset(0 0 0 100%)" });
    expect(framesOf("wipe", "up", false, false)?.enter[0]).toEqual({ clipPath: "inset(0 0 100% 0)" });
  });

  it("moves only transform, opacity and clip-path", () => {
    const allowed = new Set(["translate", "scale", "transform", "opacity", "clipPath", "offset"]);
    for (const kind of KINDS) {
      const f = framesOf(kind, "right", false, false);
      expect(f, kind).not.toBeNull();
      for (const frame of [...(f?.enter ?? []), ...(f?.leave ?? [])]) for (const key of Object.keys(frame)) expect(allowed.has(key), `${kind}: ${key}`).toBe(true);
    }
  });

  it("is a cross-fade for a person who asked for less movement, and does not know other kinds", () => {
    for (const kind of KINDS) expect(framesOf(kind, "left", false, true)?.enter).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    expect(framesOf("slide", "left", false, false)).toBeNull();
  });
});

describe("playing a transition", () => {
  it("animates both slides, holds the old one on view and raises the one on top", () => {
    const [to, from] = [slide(), slide()];
    const started = playTransition(to, from, { kind: "cover", direction: "right", seconds: 0.5 });
    expect(started).toHaveLength(2);
    expect(to.animate).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ visibility: "visible" })]), expect.objectContaining({ duration: 500 }));
    expect(to.style.zIndex).toBe("2");
    expect(from.style.zIndex).toBe("1");
  });

  it("plays nothing for no time, or for a kind reveal.js plays", () => {
    const [to, from] = [slide(), slide()];
    expect(playTransition(to, from, { kind: "push", seconds: 0 })).toEqual([]);
    expect(playTransition(to, from, { kind: "fade", seconds: 1 })).toEqual([]);
    expect(to.animate).not.toHaveBeenCalled();
  });

  it("is not stopped by a slide the browser will not animate", () => {
    const [to, from] = [slide(), slide()];
    (to.animate as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("no");
    });
    expect(() => playTransition(to, from, { kind: "zoom", seconds: 1 })).not.toThrow();
    expect(from.animate).toHaveBeenCalled();
  });
});

describe("what a section says", () => {
  it("is a kind, a side and a time, for the kinds that are played here only", () => {
    expect(specOf(slide({ "data-ks-fx": "push", "data-ks-dir": "up", "data-ks-seconds": "0.7" }))).toEqual({ kind: "push", direction: "up", seconds: 0.7 });
    expect(specOf(slide({ "data-ks-fx": "fade" }))).toBeNull();
    expect(specOf(slide())).toBeNull();
  });

  it("plays when the person arrives, and turns round when they go back", () => {
    const listen = transitionListener();
    const [a, b] = [slide({ "data-ks-fx": "push", "data-ks-dir": "left", "data-ks-seconds": "0.5" }), slide({ "data-ks-fx": "push", "data-ks-dir": "left", "data-ks-seconds": "0.5" })];
    expect(listen({ indexh: 0, indexv: 0, currentSlide: a })).toEqual([]);
    listen({ indexh: 1, indexv: 0, currentSlide: b, previousSlide: a });
    expect(b.animate).toHaveBeenCalledWith([{ visibility: "visible", translate: "-100% 0%" }, { visibility: "visible", translate: "0% 0%" }], expect.anything());
    listen({ indexh: 0, indexv: 0, currentSlide: a, previousSlide: b });
    expect(a.animate).toHaveBeenCalledWith([{ visibility: "visible", translate: "100% 0%" }, { visibility: "visible", translate: "0% 0%" }], expect.anything());
  });
});
