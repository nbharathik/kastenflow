import type { Deck } from "@kasten-slides/wasm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MATTES, MATTE_KEY, matteColor, readMatte, writeMatte } from "./matte.ts";

const deckWith = (colors: Record<string, string>): Deck => ({ theme: { colors } }) as unknown as Deck;
const light = deckWith({ text1: "#202124", text2: "#5f6368", bg1: "#ffffff", bg2: "#f1f3f4" });
const dark = deckWith({ text1: "#f1f3f4", text2: "#9aa0a6", bg1: "#0f1115", bg2: "#1b1f27" });

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("the matte round a slide", () => {
  it("is black, the theme's background, or the theme's dark colour", () => {
    expect(MATTES.map((matte) => matte.value)).toEqual(["black", "paper", "dark"]);
    expect(matteColor(light, "black")).toBe("#000000");
    expect(matteColor(light, "paper")).toBe("#ffffff");
    expect(matteColor(dark, "paper")).toBe("#0f1115");
  });

  it("takes the darker of the paper and the ink as the theme's dark colour: the ink of a light theme, the paper of a dark one", () => {
    expect(matteColor(light, "dark")).toBe("#202124");
    expect(matteColor(dark, "dark")).toBe("#0f1115");
  });

  it("reads a short hex value as the long one", () => {
    const short = deckWith({ text1: "#123", bg1: "#fff" });
    expect(matteColor(short, "paper")).toBe("#ffffff");
    expect(matteColor(short, "dark")).toBe("#112233");
  });
});

describe("the matte chosen", () => {
  it("is black until another is chosen, and is kept in this browser", () => {
    expect(readMatte()).toBe("black");
    writeMatte("paper");
    expect(localStorage.getItem(MATTE_KEY)).toBe("paper");
    expect(readMatte()).toBe("paper");
  });

  it("is black when what is kept is not a matte", () => {
    localStorage.setItem(MATTE_KEY, "chartreuse");
    expect(readMatte()).toBe("black");
  });

  it("is black, and nothing throws, when the browser keeps nothing", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readMatte()).toBe("black");
    expect(() => writeMatte("dark")).not.toThrow();
  });
});
