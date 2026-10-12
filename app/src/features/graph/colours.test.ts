import { afterEach, describe, expect, it } from "vitest";

import { css, mix, parseColour, readPalette } from "./colours";

describe("the graph's colours", () => {
  it("reads the colours the style sheet writes", () => {
    expect(parseColour("#ffffff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColour("#0075DE")).toEqual({ r: 0, g: 117, b: 222, a: 1 });
    expect(parseColour("#f80")).toEqual({ r: 255, g: 136, b: 0, a: 1 });
    expect(parseColour("rgb(199 230 253)")).toEqual({ r: 199, g: 230, b: 253, a: 1 });
    expect(parseColour("rgb(0 0 0 / 0.085)")).toEqual({ r: 0, g: 0, b: 0, a: 0.085 });
    expect(parseColour("rgb(255 255 255 / 8%)")).toEqual({ r: 255, g: 255, b: 255, a: 0.08 });
    expect(parseColour("rgba(10, 20, 30, 0.5)")).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseColour("")).toBeNull();
    expect(parseColour("var(--x)")).toBeNull();
  });

  it("mixes two colours and writes one for the canvas", () => {
    const black = { r: 0, g: 0, b: 0, a: 1 };
    const white = { r: 255, g: 255, b: 255, a: 1 };
    expect(mix(black, white, 0.5)).toEqual({ r: 127.5, g: 127.5, b: 127.5, a: 1 });
    expect(css(mix(black, white, 0.25))).toBe("rgba(64, 64, 64, 1)");
    expect(css(black, 0.3)).toBe("rgba(0, 0, 0, 0.3)");
  });

  describe("the page's palette", () => {
    afterEach(() => document.documentElement.removeAttribute("style"));

    it("is read from the theme's variables, with a fallback where there are none", () => {
      const empty = readPalette();
      expect(empty.ink.a).toBe(1);
      expect(Object.keys(empty.highlight)).toContain("blue");
      document.documentElement.style.setProperty("--color-highlight-blue", "rgb(1 2 3)");
      document.documentElement.style.setProperty("--color-ink", "#102030");
      const palette = readPalette();
      expect(palette.highlight.blue).toEqual({ r: 1, g: 2, b: 3, a: 1 });
      expect(palette.ink).toEqual({ r: 16, g: 32, b: 48, a: 1 });
    });
  });
});
