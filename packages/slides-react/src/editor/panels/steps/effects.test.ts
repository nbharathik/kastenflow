import { describe, expect, it } from "vitest";

import { EFFECTS, changed, hasSide, said, withKind } from "./effects.ts";

describe("the effects on offer", () => {
  it("has every kind the deck knows, once", () => {
    const kinds = EFFECTS.map((e) => e.value);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(kinds).toEqual(["appear", "fade", "fadeUp", "grow", "fly", "zoom", "wipe", "float", "pop", "pulse", "colour", "path"]);
  });

  it("has a side for a fly, a wipe and a float only", () => {
    expect(EFFECTS.filter((e) => hasSide(e.value)).map((e) => e.value)).toEqual(["fly", "wipe", "float"]);
  });
});

describe("changing the effect of a step", () => {
  it("keeps the time, the wait and the start, and gives what only the new kind means a first value", () => {
    const old = { kind: "fly" as const, direction: "left" as const, duration: 0.8, delay: 0.1, start: "after" as const };
    expect(withKind(old, "wipe")).toEqual({ kind: "wipe", direction: "left", duration: 0.8, delay: 0.1, start: "after" });
    expect(withKind(old, "zoom")).toEqual({ kind: "zoom", duration: 0.8, delay: 0.1, start: "after" });
    expect(withKind(undefined, "colour")).toEqual({ kind: "colour", color: "accent1" });
    expect(withKind(undefined, "path")).toEqual({ kind: "path", dx: -240, dy: 0 });
  });

  it("changes a field, and takes it away when given nothing", () => {
    const fx = { kind: "fade" as const, duration: 1, start: "after" as const };
    expect(changed(fx, { duration: 2 })).toEqual({ kind: "fade", duration: 2, start: "after" });
    expect(changed(fx, { start: null })).toEqual({ kind: "fade", duration: 1 });
  });

  it("says an effect in words", () => {
    expect(said({ kind: "fly", direction: "left", duration: 0.5 })).toBe("Fly in from the left, 0.5 seconds");
    expect(said({ kind: "appear" })).toBe("Appear");
    expect(said({ kind: "zoom" })).toBe("Zoom, 0.4 seconds");
  });
});
