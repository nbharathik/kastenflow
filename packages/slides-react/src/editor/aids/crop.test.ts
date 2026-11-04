import { describe, expect, it } from "vitest";

import { cropEdge, wholePicture } from "./crop.ts";

const box = { x: 100, y: 50, w: 400, h: 200 };

describe("cropping by dragging an edge", () => {
  it("hides more of the picture and shrinks the box to what shows, the opposite edge staying put", () => {
    const out = cropEdge(box, null, "left", 200);
    expect(out.crop).toEqual({ left: 0.25, top: 0, right: 0, bottom: 0 });
    expect(out.box).toEqual({ x: 200, y: 50, w: 300, h: 200 });
  });

  it("keeps the picture's size when a second crop follows the first", () => {
    const first = cropEdge(box, null, "left", 200);
    const second = cropEdge(first.box, first.crop, "right", 400);
    expect(second.box).toEqual({ x: 200, y: 50, w: 200, h: 200 });
    expect(wholePicture(second.box, second.crop)).toEqual(box);
  });

  it("shows more again when the edge is dragged out, and no crop is none", () => {
    const first = cropEdge(box, null, "top", 100);
    const back = cropEdge(first.box, first.crop, "top", 0);
    expect(back.crop).toBeNull();
    expect(back.box).toEqual(box);
  });

  it("leaves a sliver of the picture whatever the drag", () => {
    const out = cropEdge(box, null, "right", -5000);
    expect(out.crop?.right).toBe(0.95);
    expect(out.box.w).toBe(20);
  });
});
