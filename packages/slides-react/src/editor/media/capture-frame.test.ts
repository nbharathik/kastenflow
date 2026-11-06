import { describe, expect, it } from "vitest";

import { fitSide, frameName, withinVideo } from "./capture-frame.ts";

describe("the size of a captured frame", () => {
  it("is the video's own when it is small and is shrunk, keeping its shape, when it is big", () => {
    expect(fitSide(1280, 720)).toEqual({ w: 1280, h: 720 });
    expect(fitSide(3840, 2160)).toEqual({ w: 1920, h: 1080 });
    expect(fitSide(1080, 3840)).toEqual({ w: 540, h: 1920 });
  });

  it("is nothing for a video with no picture", () => {
    expect(fitSide(0, 0)).toEqual({ w: 0, h: 0 });
    expect(fitSide(Number.NaN, 10)).toEqual({ w: 0, h: 0 });
  });
});

describe("a moment of a video", () => {
  it("is kept inside the video, and a number that is no time is the start", () => {
    expect(withinVideo(12, 60)).toBe(12);
    expect(withinVideo(90, 60)).toBe(60);
    expect(withinVideo(-3, 60)).toBe(0);
    expect(withinVideo(Number.NaN, 60)).toBe(0);
    expect(withinVideo(5, Number.NaN)).toBe(5);
  });
});

describe("the name of a poster", () => {
  it("is the video's file name and the moment", () => {
    expect(frameName("assets/talks/Demo Final.mp4", 12.34)).toBe("Demo-Final-poster-12-3s.png");
    expect(frameName("https://example.com/v.mp4?t=3", 0)).toBe("v-poster-0s.png");
    expect(frameName("", 4)).toBe("video-poster-4s.png");
  });
});
