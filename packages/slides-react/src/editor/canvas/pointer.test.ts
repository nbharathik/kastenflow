import { describe, expect, it } from "vitest";

import { EditorUi } from "../ui-state.ts";
import { PointerTrack, pointerOf } from "./pointer.ts";

/** A page whose top left is at (100, 50) in the window, drawn at twice the size, 960 by 540 units. */
const page = (cx: number, cy: number) => {
  const x = (cx - 100) / 2;
  const y = (cy - 50) / 2;
  return x >= 0 && y >= 0 && x <= 960 && y <= 540 ? { x, y } : null;
};

describe("the pointer over the slide", () => {
  it("is not known until it has moved over the slide, and not once it has left", () => {
    const track = new PointerTrack();
    track.attach(page);
    expect(track.slidePoint()).toBeNull();
    track.moved(300, 250);
    expect(track.slidePoint()).toEqual({ x: 100, y: 100 });
    track.left();
    expect(track.slidePoint()).toBeNull();
    track.moved(320, 250);
    expect(track.slidePoint()).toEqual({ x: 110, y: 100 });
  });

  it("is read from where the page is when it is asked, not when the pointer moved", () => {
    const track = new PointerTrack();
    let left = 100;
    track.attach((cx, cy) => ({ x: cx - left, y: cy }));
    track.moved(400, 10);
    expect(track.slidePoint()).toEqual({ x: 300, y: 10 });
    // The page scrolled 40 px under a pointer that stayed where it was.
    left = 60;
    expect(track.slidePoint()).toEqual({ x: 340, y: 10 });
  });

  it("is nowhere when the pointer is in the window but off the slide", () => {
    const track = new PointerTrack();
    track.attach(page);
    track.moved(20, 20);
    expect(track.slidePoint()).toBeNull();
  });

  it("is nowhere without a canvas to read it, and again once the canvas is gone", () => {
    const track = new PointerTrack();
    track.moved(300, 250);
    expect(track.slidePoint()).toBeNull();
    const detach = track.attach(page);
    expect(track.slidePoint()).not.toBeNull();
    detach();
    expect(track.slidePoint()).toBeNull();
  });

  it("is not taken away by an older canvas letting go after a newer one has come", () => {
    const track = new PointerTrack();
    const older = track.attach(page);
    track.attach((cx, cy) => ({ x: cx, y: cy }));
    older();
    track.moved(5, 6);
    expect(track.slidePoint()).toEqual({ x: 5, y: 6 });
  });

  it("is remembered as the last spot on the slide after the pointer has gone off it, to a menu or the filmstrip", () => {
    const track = new PointerTrack();
    track.attach(page);
    expect(track.lastSlidePoint()).toBeNull();
    track.moved(300, 250);
    track.left();
    expect(track.slidePoint()).toBeNull();
    expect(track.lastSlidePoint()).toEqual({ x: 100, y: 100 });
    // Where the page is when asked: it may have been scrolled or zoomed since.
    const scrolled = new PointerTrack();
    let left = 100;
    scrolled.attach((cx, cy) => ({ x: cx - left, y: cy }));
    scrolled.moved(400, 10);
    scrolled.left();
    left = 60;
    expect(scrolled.lastSlidePoint()).toEqual({ x: 340, y: 10 });
  });

  it("has no last spot once that place is off the slide, or without a canvas to read it", () => {
    const track = new PointerTrack();
    track.moved(300, 250);
    expect(track.lastSlidePoint()).toBeNull();
    let shown = true;
    track.attach((cx, cy) => (shown ? { x: cx, y: cy } : null));
    expect(track.lastSlidePoint()).toEqual({ x: 300, y: 250 });
    shown = false;
    expect(track.lastSlidePoint()).toBeNull();
  });

  it("is one track for each window", () => {
    const one = new EditorUi();
    const other = new EditorUi();
    expect(pointerOf(one)).toBe(pointerOf(one));
    expect(pointerOf(one)).not.toBe(pointerOf(other));
  });
});
