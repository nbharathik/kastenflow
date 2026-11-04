import { describe, expect, it } from "vitest";

import { audioSource } from "./audio-file.ts";

describe("the source of a sound", () => {
  it("is a web address as typed, or the name of an audio file", () => {
    expect(audioSource("  https://example.com/a.mp3 ")).toBe("https://example.com/a.mp3");
    expect(audioSource("http://example.com/stream")).toBe("http://example.com/stream");
    expect(audioSource("assets/theme.MP3")).toBe("assets/theme.MP3");
    expect(audioSource("clip.m4a")).toBe("clip.m4a");
    expect(audioSource("notes.opus?x=1")).toBe("notes.opus?x=1");
  });

  it("is nothing for nothing, a script or mail address, a control character, or a file that is not sound", () => {
    expect(audioSource("")).toBeNull();
    expect(audioSource("   ")).toBeNull();
    expect(audioSource("javascript:alert(1)")).toBeNull();
    expect(audioSource("mailto:a@b.c")).toBeNull();
    expect(audioSource("file:///c:/a.mp3")).toBeNull();
    expect(audioSource("a\u0007.mp3")).toBeNull();
    expect(audioSource("assets/picture.png")).toBeNull();
  });
});
