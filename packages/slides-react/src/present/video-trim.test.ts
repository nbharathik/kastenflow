import { describe, expect, it } from "vitest";

import { clock, inside, pastEnd, trimOf, volumeOf } from "./video-trim.ts";

describe("the part of a video that plays", () => {
  it("is the whole file when the video names no start or end", () => {
    expect(trimOf({})).toEqual({ start: 0, end: null });
    expect(trimOf({ start: null, end: null })).toEqual({ start: 0, end: null });
  });

  it("is from the start to the end when both are named", () => {
    expect(trimOf({ start: 12, end: 60 })).toEqual({ start: 12, end: 60 });
  });

  it("ignores an end at or before the start, and numbers that are not seconds", () => {
    expect(trimOf({ start: 30, end: 30 }).end).toBeNull();
    expect(trimOf({ start: 30, end: 10 }).end).toBeNull();
    expect(trimOf({ start: -4, end: Number.NaN })).toEqual({ start: 0, end: null });
    expect(trimOf({ start: Number.POSITIVE_INFINITY })).toEqual({ start: 0, end: null });
  });

  it("stops at the end and keeps a place inside", () => {
    const trim = trimOf({ start: 5, end: 20 });
    expect(pastEnd(trim, 19.9)).toBe(false);
    expect(pastEnd(trim, 20)).toBe(true);
    expect(pastEnd(trimOf({}), 9999)).toBe(false);
    expect(inside(trim, 0)).toBe(5);
    expect(inside(trim, 12)).toBe(12);
    expect(inside(trim, 99)).toBe(20);
  });
});

describe("the volume of a video", () => {
  it("is 1 unless the deck names one, and stays between 0 and 1", () => {
    expect(volumeOf(undefined)).toBe(1);
    expect(volumeOf(null)).toBe(1);
    expect(volumeOf("loud")).toBe(1);
    expect(volumeOf(Number.NaN)).toBe(1);
    expect(volumeOf(0.4)).toBe(0.4);
    expect(volumeOf(0)).toBe(0);
    expect(volumeOf(7)).toBe(1);
    expect(volumeOf(-1)).toBe(0);
  });
});

describe("a place in a video, as a clock", () => {
  it("reads minutes and seconds, with a tenth when there is one", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(65)).toBe("1:05");
    expect(clock(7.5)).toBe("0:07.5");
    expect(clock(59.97)).toBe("0:59");
  });
});
