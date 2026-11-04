import { describe, expect, it } from "vitest";

import { type Pixels, hexAt, nudged, pointOn } from "./color-sample.ts";

/** A picture of 2 x 2 pixels: red, green / blue, nothing. */
const picture: Pixels = { width: 2, height: 2, data: [255, 0, 0, 255, 0, 128, 0, 255, 0, 0, 255, 255, 9, 9, 9, 0] };

describe("the colour under the eyedropper", () => {
  it("is the pixel's colour as #rrggbb", () => {
    expect(hexAt(picture, 0, 0)).toBe("#ff0000");
    expect(hexAt(picture, 1.9, 0.2)).toBe("#008000");
    expect(hexAt(picture, 0, 1)).toBe("#0000ff");
  });

  it("is nothing outside the picture and where nothing is drawn", () => {
    expect(hexAt(picture, 1, 1)).toBeNull();
    expect(hexAt(picture, -1, 0)).toBeNull();
    expect(hexAt(picture, 2, 0)).toBeNull();
    expect(hexAt(picture, Number.NaN, 0)).toBeNull();
  });
});

describe("finding a point on a picture that is shown scaled", () => {
  const box = { left: 100, top: 50, width: 200, height: 100 };
  it("maps the screen to the picture's pixels", () => {
    expect(pointOn(box, 100, 50, { width: 960, height: 540 })).toEqual({ x: 0, y: 0 });
    expect(pointOn(box, 200, 100, { width: 960, height: 540 })).toEqual({ x: 480, y: 270 });
  });
  it("is null outside the box or for a box with no size", () => {
    expect(pointOn(box, 99, 60, { width: 10, height: 10 })).toBeNull();
    expect(pointOn(box, 300, 60, { width: 10, height: 10 })).toBeNull();
    expect(pointOn({ ...box, width: 0 }, 100, 60, { width: 10, height: 10 })).toBeNull();
  });
});

describe("moving the eyedropper with the keyboard", () => {
  const size = { width: 100, height: 50 };
  it("steps one pixel, or ten with Shift, and stays inside the picture", () => {
    expect(nudged({ x: 5, y: 5 }, "ArrowRight", false, size)).toEqual({ x: 6, y: 5 });
    expect(nudged({ x: 5, y: 5 }, "ArrowDown", true, size)).toEqual({ x: 5, y: 15 });
    expect(nudged({ x: 0, y: 0 }, "ArrowLeft", true, size)).toEqual({ x: 0, y: 0 });
    expect(nudged({ x: 99, y: 49 }, "ArrowRight", true, size)).toEqual({ x: 99, y: 49 });
  });
  it("ignores other keys", () => {
    expect(nudged({ x: 5, y: 5 }, "a", false, size)).toBeNull();
  });
});
