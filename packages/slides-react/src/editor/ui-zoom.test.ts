import { describe, expect, it } from "vitest";

import { EditorUi } from "./ui-state.ts";

const ui = (fit = 1.7) => {
  const state = new EditorUi();
  state.setFitZoom(fit);
  state.setZoom(1);
  state.takeZoomIntent();
  return state;
};

describe("zooming by a factor", () => {
  it("multiplies the zoom shown, at once, about a place in the window", () => {
    const state = ui();
    state.zoomBy(1.5, { x: 300, y: 200 });
    expect(state.state.zoom).toBeCloseTo(1.5, 5);
    expect(state.takeZoomIntent()).toEqual({ about: { x: 300, y: 200 }, to: undefined, instant: true });
    // Read once.
    expect(state.takeZoomIntent()).toEqual({});
  });

  it("starts from the size of Fit while the zoom is Fit", () => {
    const state = new EditorUi();
    state.setFitZoom(0.8);
    state.zoomBy(1.25);
    expect(state.state.zoom).toBeCloseTo(1, 5);
  });

  it("stays within the least and the most", () => {
    const state = ui();
    for (let i = 0; i < 60; i += 1) state.zoomBy(1.2);
    expect(state.state.zoom).toBe(8);
    for (let i = 0; i < 100; i += 1) state.zoomBy(0.8);
    expect(state.state.zoom).toBe(0.1);
  });

  it("settles on Fit and on 100% when it comes near them", () => {
    const state = ui(1.7);
    state.zoomBy(1.01);
    expect(state.state.zoom).toBe(1);
    // A hair short of what Fit comes to.
    const fitted = ui(1.7);
    fitted.setZoom(1.69);
    fitted.zoomBy(1.001);
    expect(fitted.state.zoom).toBe("fit");
  });

  it("goes on through 100% when the steps are small, rather than sticking to it", () => {
    const state = ui();
    const seen: unknown[] = [];
    for (let i = 0; i < 6; i += 1) {
      state.zoomBy(1.01);
      seen.push(state.state.zoom);
    }
    // The first steps are held at 100%; the zoom asked for goes on growing behind them and gets out.
    expect(seen[0]).toBe(1);
    expect(seen.at(-1)).toBeGreaterThan(1.02);
  });

  it("starts again from the zoom shown when something else changed it", () => {
    const state = ui();
    state.zoomBy(1.01);
    state.setZoom(2);
    state.zoomBy(1.01);
    expect(state.state.zoom).toBeCloseTo(2.02, 5);
  });

  it("carries the place when it is given where to go", () => {
    const state = ui();
    state.zoomBy(1.2, { x: 10, y: 10 }, { x: 40, y: 30 });
    expect(state.takeZoomIntent()).toEqual({ about: { x: 10, y: 10 }, to: { x: 40, y: 30 }, instant: true });
  });

  it("glides for the menu's steps and Fit, which ask nothing of the place", () => {
    const state = ui();
    state.stepZoom(1);
    expect(state.takeZoomIntent()).toEqual({});
    state.setZoom("fit");
    expect(state.takeZoomIntent()).toEqual({});
  });
});
