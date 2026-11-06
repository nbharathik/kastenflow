import type { DeckFont } from "@kasten-slides/wasm";
import { describe, expect, it } from "vitest";

import { describeFile, embeddable, familiesOf, fontFaceCss, fontFormat } from "./font-css.ts";

const font = (extra: Partial<DeckFont> & { src: string }): DeckFont => ({ family: "Inter", ...extra }) as DeckFont;
const urlOf = (path: string): string | undefined => (path.startsWith("assets/") ? `blob:${path}` : undefined);

describe("the format of a font file", () => {
  it("comes from its extension, and is null for a file that is not a font", () => {
    expect(fontFormat("assets/fonts/a.woff2")).toBe("woff2");
    expect(fontFormat("assets/fonts/A.WOFF")).toBe("woff");
    expect(fontFormat("assets/fonts/a.ttf?v=2")).toBe("truetype");
    expect(fontFormat("assets/fonts/a.otf")).toBe("opentype");
    expect(fontFormat("assets/a.png")).toBeNull();
  });
});

describe("the style rules of a deck's fonts", () => {
  it("name the family, weight, style and file of each", () => {
    const css = fontFaceCss([font({ src: "assets/fonts/Inter-Regular.woff2" }), font({ src: "assets/fonts/Inter-BoldItalic.ttf", bold: true, italic: true })], urlOf);
    const rules = css.split("\n");
    expect(rules).toHaveLength(2);
    expect(rules[0]).toContain('font-family: "Inter"');
    expect(rules[0]).toContain("font-weight: 400; font-style: normal");
    expect(rules[0]).toContain('src: url("blob:assets/fonts/Inter-Regular.woff2") format("woff2")');
    expect(rules[1]).toContain("font-weight: 700; font-style: italic");
    expect(rules[1]).toContain('format("truetype")');
  });

  it("leave out a font with no address, no family or a file that is not a font", () => {
    expect(fontFaceCss([font({ src: "elsewhere/a.woff2" }), font({ src: "assets/a.woff2", family: "  " }), font({ src: "assets/a.png" })], urlOf)).toBe("");
  });

  it("cannot be broken out of by a family name or an address", () => {
    const css = fontFaceCss([font({ family: 'A"; } body { display:none } /*', src: "assets/a.woff2" })], (path) => `blob:${path}"); } body { x: y`);
    expect(css.split("\n")).toHaveLength(1);
    expect(css).toContain('font-family: "A\\"; } body');
    expect(css).toContain('url("blob:assets/a.woff2%22); } body { x: y")');
  });
});

describe("what a deck's fonts add", () => {
  it("lists the families once, and the fonts whose licence lets them travel", () => {
    const fonts = [font({ src: "assets/a.ttf" }), font({ src: "assets/b.ttf", bold: true, embeddable: true }), font({ family: "Lato", src: "assets/c.ttf" })];
    expect(familiesOf(fonts)).toEqual(["Inter", "Lato"]);
    expect(embeddable(fonts).map((f) => f.src)).toEqual(["assets/b.ttf"]);
  });

  it("reads a family, a weight and a style from the name of a file", () => {
    expect(describeFile("Inter-Regular.woff2")).toEqual({ family: "Inter", bold: false, italic: false });
    expect(describeFile("RobotoMono-BoldItalic.ttf")).toEqual({ family: "Roboto Mono", bold: true, italic: true });
    expect(describeFile("Open Sans Bold.otf")).toEqual({ family: "Open Sans", bold: true, italic: false });
    expect(describeFile("Lobster.ttf")).toEqual({ family: "Lobster", bold: false, italic: false });
  });
});
