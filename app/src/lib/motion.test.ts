// Motion follows the setting: System follows the computer's "reduce
// motion", On and Off overrule it, and scripted animations take no time
// while it is off.

import { afterEach, describe, expect, it, vi } from "vitest";

import { applyMotion, motionMs, motionOn, watchSystemMotion } from "./motion";

/** The computer asks for less motion, or not, and says when that changes. */
function system(reduce: boolean) {
  const listeners = new Set<() => void>();
  const query = { matches: reduce, addEventListener: (_: string, f: () => void) => listeners.add(f), removeEventListener: (_: string, f: () => void) => listeners.delete(f) };
  vi.stubGlobal("matchMedia", (q: string) => (q.includes("reduced-motion") ? query : { matches: false, addEventListener() {}, removeEventListener() {} }));
  return {
    change(to: boolean) {
      query.matches = to;
      for (const f of listeners) f();
    },
    listening: () => listeners.size,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.motion;
  delete document.documentElement.dataset.motionReduced;
});

describe("motion", () => {
  it("follows the computer on System, and the setting on On or Off", () => {
    system(true);
    expect(motionOn("system")).toBe(false);
    expect(motionOn("on")).toBe(true);
    expect(motionOn("off")).toBe(false);
    system(false);
    expect(motionOn("system")).toBe(true);
    expect(motionOn("off")).toBe(false);
  });

  it("marks the page, and scripted animations take no time while it is off", () => {
    system(false);
    expect(motionMs(240)).toBe(240);
    applyMotion("off");
    expect(document.documentElement.dataset.motion).toBe("off");
    expect(motionMs(240)).toBe(0);
    applyMotion("system");
    expect(document.documentElement.dataset.motion).toBe("on");
    expect(motionMs(240)).toBe(240);
  });

  it("tells the computer's request for less motion from the setting being Off", () => {
    system(true);
    applyMotion("system");
    expect(document.documentElement.dataset.motion).toBe("off");
    expect(document.documentElement.dataset.motionReduced).toBeDefined();
    applyMotion("off");
    expect(document.documentElement.dataset.motion).toBe("off");
    expect(document.documentElement.dataset.motionReduced).toBeUndefined();
  });

  it("hears the computer change its mind while on System", () => {
    const computer = system(false);
    let pref: "system" | "on" = "system";
    const stop = watchSystemMotion(() => pref);
    applyMotion(pref);
    computer.change(true);
    expect(document.documentElement.dataset.motion).toBe("off");
    pref = "on";
    computer.change(true);
    expect(document.documentElement.dataset.motion).toBe("on");
    stop();
    expect(computer.listening()).toBe(0);
  });
});
