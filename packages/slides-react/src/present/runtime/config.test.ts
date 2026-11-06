import { describe, expect, it } from "vitest";

import { revealConfig } from "./config.js";

describe("the settings a show starts with", () => {
  const size = { w: 960, h: 540 };

  it("hides the mouse after 2 s at rest, and stops at the last slide, until the deck says otherwise", () => {
    const plain = revealConfig(size) as Record<string, unknown>;
    expect(plain.hideInactiveCursor).toBe(true);
    expect(plain.hideCursorTime).toBe(2000);
    expect(plain.loop).toBe(false);
    expect(plain.autoSlide).toBe(0);
  });

  it("takes a deck's loop and its seconds per slide (a kiosk)", () => {
    const kiosk = revealConfig(size, { loop: true, autoSlide: 8000 }) as Record<string, unknown>;
    expect(kiosk.loop).toBe(true);
    expect(kiosk.autoSlide).toBe(8000);
  });
});
