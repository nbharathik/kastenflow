import { describe, expect, it } from "vitest";

import { MAX_ZOOM, MIN_ZOOM, between, boundsOf, centreOn, fitBounds, panBy, toScreen, toWorld, zoomAt } from "./camera";

describe("the graph's camera", () => {
  it("maps points both ways", () => {
    const cam = { x: 100, y: 50, k: 2 };
    expect(toScreen(cam, 10, 20)).toEqual([120, 90]);
    expect(toWorld(cam, 120, 90)).toEqual([10, 20]);
  });

  it("zooms about a point, which stays where it is", () => {
    const cam = { x: 30, y: -20, k: 1 };
    const [wx, wy] = toWorld(cam, 200, 150);
    const zoomed = zoomAt(cam, 2, 200, 150);
    expect(zoomed.k).toBe(2);
    expect(toScreen(zoomed, wx, wy)).toEqual([200, 150]);
    expect(zoomAt(cam, 1e9, 0, 0).k).toBe(MAX_ZOOM);
    expect(zoomAt(cam, 1e-9, 0, 0).k).toBe(MIN_ZOOM);
  });

  it("pans", () => {
    expect(panBy({ x: 1, y: 2, k: 3 }, 10, -5)).toEqual({ x: 11, y: -3, k: 3 });
  });

  it("finds the box round places, leaving out any that are not numbers", () => {
    expect(boundsOf([0, 0, 10, -4, Number.NaN, 5, 3, 8], 4)).toEqual({ minX: 0, minY: -4, maxX: 10, maxY: 8 });
    expect(boundsOf([], 0)).toBeNull();
    expect(boundsOf([Number.NaN, Number.NaN], 1)).toBeNull();
  });

  it("fits a box whole in the canvas, centred, and never closer than asked", () => {
    const box = { minX: -100, minY: -50, maxX: 100, maxY: 50 };
    const cam = fitBounds(box, 500, 300, 50);
    // Room for it twice over, but not closer than 1.6.
    expect(cam.k).toBe(1.6);
    const [left] = toScreen(cam, box.minX, 0);
    const [right] = toScreen(cam, box.maxX, 0);
    expect((left + right) / 2).toBeCloseTo(250);
    // A wide box is fitted by its width, a tall one by its height.
    expect(fitBounds({ minX: 0, minY: 0, maxX: 1000, maxY: 10 }, 500, 500, 50).k).toBeCloseTo(0.4);
    expect(fitBounds({ minX: 0, minY: 0, maxX: 10, maxY: 1000 }, 500, 500, 50).k).toBeCloseTo(0.4);
    // A single point is not zoomed in on without end.
    expect(fitBounds({ minX: 5, minY: 5, maxX: 5, maxY: 5 }, 500, 500).k).toBe(1.6);
    expect(fitBounds(null, 400, 200)).toEqual({ x: 200, y: 100, k: 1 });
  });

  it("centres on a point", () => {
    const cam = centreOn({ x: 0, y: 0, k: 1 }, 40, 10, 300, 200, 2);
    expect(toScreen(cam, 40, 10)).toEqual([150, 100]);
    expect(centreOn({ x: 0, y: 0, k: 1.5 }, 0, 0, 100, 100).k).toBe(1.5);
  });

  it("moves between two cameras", () => {
    const [a, b] = [{ x: 0, y: 0, k: 1 }, { x: 100, y: 200, k: 4 }];
    expect(between(a, b, 0)).toEqual(a);
    expect(between(a, b, 1)).toEqual(b);
    const half = between(a, b, 0.5);
    expect(half.k).toBeCloseTo(2);
    expect(half.x).toBe(50);
  });
});
