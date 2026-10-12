import { describe, expect, it } from "vitest";

import { DESIGNS, MAX_ZOOM, MIN_ZOOM, ZOOM_STEPS, boxFor, clampZoom, designName, frameFor, fitScale, hasShapeOf, percent, presetOf, sanitizeDesign, scaleOf, stepZoom, viewOf } from "./scale.ts";

const desktop = { w: 1280, h: 800 };
const view = (extra: Partial<Parameters<typeof frameFor>[1]> = {}) => ({ design: desktop, zoom: null, fit: "width" as const, ...extra });

describe("the scale of a page in its box", () => {
  it("fits the width of the design to the box, so a 1280 px page in a 640 box is half size", () => {
    expect(fitScale({ w: 640, h: 360 }, desktop, "width")).toBe(0.5);
    expect(fitScale({ w: 960, h: 100 }, desktop, "width")).toBe(0.75);
  });

  it("fits the whole window when asked, which is the smaller of the two ratios", () => {
    expect(fitScale({ w: 640, h: 360 }, desktop, "page")).toBeCloseTo(0.45, 5);
    expect(fitScale({ w: 640, h: 500 }, desktop, "page")).toBe(0.5);
  });

  it("covers the box when asked to fill, which is the bigger of the two", () => {
    expect(fitScale({ w: 640, h: 360 }, desktop, "fill")).toBe(0.5);
    expect(fitScale({ w: 640, h: 500 }, desktop, "fill")).toBe(0.625);
  });

  it("never divides by nothing", () => {
    expect(Number.isFinite(fitScale({ w: 0, h: 0 }, desktop, "page"))).toBe(true);
    expect(Number.isFinite(fitScale({ w: 10, h: 10 }, { w: 0, h: 0 }, "width"))).toBe(true);
  });
});

describe("the frame a page is drawn in", () => {
  it("at Fit width is laid out at the design's width and as tall as the box asks, so nothing is stretched", () => {
    const frame = frameFor({ w: 640, h: 360 }, view());
    expect(frame.scale).toBe(0.5);
    expect(frame.layout).toEqual({ w: 1280, h: 720 });
    expect(frame.at).toEqual({ x: 0, y: 0 });
    expect(frame.letterboxed).toBe(false);
  });

  it("re-scales when the box is resized, and does not re-flow: the layout width stays the design's", () => {
    const small = frameFor({ w: 320, h: 180 }, view());
    const big = frameFor({ w: 960, h: 540 }, view());
    expect(small.layout.w).toBe(big.layout.w);
    expect(big.scale / small.scale).toBe(3);
    // The shape of what is seen stays the box's: layout times scale is the box.
    expect(big.layout.h * big.scale).toBeCloseTo(540, 6);
    expect(small.layout.h * small.scale).toBeCloseTo(180, 6);
  });

  it("at Fit page lays out the whole window and centres it with bars, like a picture shown whole", () => {
    const frame = frameFor({ w: 640, h: 360 }, view({ fit: "page" }));
    expect(frame.layout).toEqual(desktop);
    expect(frame.scale).toBeCloseTo(0.45, 5);
    expect(frame.at.x).toBeCloseTo((640 - 1280 * 0.45) / 2, 5);
    expect(frame.at.y).toBeCloseTo(0, 5);
    expect(frame.letterboxed).toBe(true);
    // A box with the shape of the design has no bars.
    expect(frameFor({ w: 640, h: 400 }, view({ fit: "page" })).letterboxed).toBe(false);
  });

  it("at Fill lays out the whole window and cuts what is past the box, from the top left", () => {
    const frame = frameFor({ w: 640, h: 500 }, view({ fit: "fill" }));
    expect(frame.scale).toBe(0.625);
    expect(frame.layout).toEqual(desktop);
    expect(frame.at).toEqual({ x: 0, y: 0 });
  });

  it("with a zoom is laid out as a window of the box divided by the zoom, as a browser zoomed does", () => {
    const out = frameFor({ w: 640, h: 360 }, view({ zoom: 0.5 }));
    expect(out.scale).toBe(0.5);
    expect(out.layout).toEqual({ w: 1280, h: 720 });
    const further = frameFor({ w: 640, h: 360 }, view({ zoom: 0.25 }));
    expect(further.layout).toEqual({ w: 2560, h: 1440 });
    const closer = frameFor({ w: 640, h: 360 }, view({ zoom: 2 }));
    expect(closer.layout).toEqual({ w: 320, h: 180 });
  });

  it("ignores the design and the fit once there is a zoom", () => {
    const a = frameFor({ w: 500, h: 300 }, view({ zoom: 1, design: { w: 390, h: 844 }, fit: "page" }));
    const b = frameFor({ w: 500, h: 300 }, view({ zoom: 1, design: desktop, fit: "fill" }));
    expect(a).toEqual(b);
  });
});

describe("the view an embed holds", () => {
  it("fills what a deck leaves out", () => {
    expect(viewOf({})).toEqual({ design: desktop, zoom: null, fit: "width" });
    expect(viewOf({ design: { w: 390, h: 844 }, zoom: 0.75, fit: "fill" })).toEqual({ design: { w: 390, h: 844 }, zoom: 0.75, fit: "fill" });
  });

  it("is not fooled by what a file or an agent wrote", () => {
    expect(viewOf({ design: { w: -5, h: Number.NaN }, zoom: 99, fit: "sideways" })).toEqual({ design: { w: 200, h: 800 }, zoom: MAX_ZOOM, fit: "width" });
    expect(viewOf({ zoom: 0 }).zoom).toBeNull();
    expect(viewOf({ zoom: Number.NaN }).zoom).toBeNull();
    expect(viewOf({ design: { w: 100000, h: 1 } }).design).toEqual({ w: 4000, h: 200 });
  });

  it("clamps a zoom to 25% and 300%", () => {
    expect(clampZoom(0.01)).toBe(MIN_ZOOM);
    expect(clampZoom(7)).toBe(MAX_ZOOM);
    expect(clampZoom(1.25)).toBe(1.25);
    expect(clampZoom(null)).toBeUndefined();
    expect(clampZoom("2")).toBeUndefined();
  });

  it("sanitizes a design to whole pixels in range, with the fallback for what is missing", () => {
    expect(sanitizeDesign({ w: 1000.6 })).toEqual({ w: 1001, h: 800 });
    expect(sanitizeDesign(null, { w: 640, h: 360 })).toEqual({ w: 640, h: 360 });
  });

  it("names a design by its preset, or by its size", () => {
    expect(designName(desktop)).toBe("Desktop");
    expect(designName({ w: 390, h: 844 })).toBe("Phone");
    expect(designName({ w: 1000, h: 700 })).toBe("Custom 1000×700");
    expect(presetOf({ w: 1280, h: 720 })?.id).toBe("slide");
    expect(DESIGNS.map((d) => d.label)).toEqual(["Desktop", "Wide", "Slide 16:9", "Tablet", "Phone", "Narrow page"]);
  });

  it("says a scale as a percentage", () => {
    expect(percent(0.625)).toBe("63%");
    expect(percent(1)).toBe("100%");
  });
});

describe("Ctrl plus and Ctrl minus", () => {
  const box = { w: 640, h: 360 };

  it("steps from the scale the page is at when it is at Fit, to the next size up or down", () => {
    expect(scaleOf(box, view())).toBe(0.5);
    // At Fit width this is 50%: the next step up is 67%, the next down 33%.
    expect(stepZoom(box, view(), 1)).toBe(0.67);
    expect(stepZoom(box, view(), -1)).toBe(0.33);
  });

  it("steps from a fixed zoom to its neighbours, and stops at the ends", () => {
    expect(stepZoom(box, view({ zoom: 1 }), 1)).toBe(1.1);
    expect(stepZoom(box, view({ zoom: 1 }), -1)).toBe(0.9);
    expect(stepZoom(box, view({ zoom: MAX_ZOOM }), 1)).toBeNull();
    expect(stepZoom(box, view({ zoom: MIN_ZOOM }), -1)).toBeNull();
  });

  it("goes in steps that are all inside the range and rise", () => {
    expect(ZOOM_STEPS[0]).toBe(MIN_ZOOM);
    expect(ZOOM_STEPS.at(-1)).toBe(MAX_ZOOM);
    expect([...ZOOM_STEPS].sort((a, b) => a - b)).toEqual([...ZOOM_STEPS]);
  });
});

describe("the box a design asks for", () => {
  it("has the design's shape at the width given", () => {
    expect(boxFor(desktop, 640)).toEqual({ w: 640, h: 400 });
    expect(boxFor({ w: 390, h: 844 }, 300)).toEqual({ w: 300, h: 649 });
  });

  it("is recognised as the shape of the design, near enough", () => {
    expect(hasShapeOf({ w: 640, h: 400 }, desktop)).toBe(true);
    expect(hasShapeOf({ w: 640, h: 360 }, desktop)).toBe(false);
  });
});
