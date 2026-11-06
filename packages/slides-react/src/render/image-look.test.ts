import { describe, expect, it } from "vitest";

import { adjustFilter, maskClip } from "./image-look.ts";

describe("a picture's adjustments", () => {
  it("are no filter when they change nothing", () => {
    expect(adjustFilter(undefined)).toBeUndefined();
    expect(adjustFilter({ brightness: 0, greyscale: false })).toBeUndefined();
  });

  it("become the multiples CSS wants, around 1", () => {
    expect(adjustFilter({ brightness: 0.2, contrast: -0.5, saturation: -1 })).toBe("brightness(1.2) contrast(0.5) saturate(0)");
  });

  it("add greyscale and blur last", () => {
    expect(adjustFilter({ greyscale: true, blur: 3 })).toBe("grayscale(1) blur(3px)");
  });
});

describe("a mask shape", () => {
  it("is a clip path in the picture's own box", () => {
    const clip = maskClip("star5", 200, 100);
    expect(clip).toMatch(/^path\("M/);
  });

  it("is nothing without a name or a box", () => {
    expect(maskClip(undefined, 10, 10)).toBeUndefined();
    expect(maskClip("star5", 0, 10)).toBeUndefined();
  });
});
