import type { Paragraph, Run, Theme } from "@kasten-slides/wasm";
import { beforeAll, describe, expect, it } from "vitest";

import { fontStack } from "../theme/index.ts";
import { themeNamed } from "./test-support.ts";
import { codeBackground, paragraphCss, resolveAlign, resolveStyle, runCss, strutSize } from "./text-style.ts";

let light: Theme;
let dark: Theme;

beforeAll(async () => {
  light = await themeNamed("Light");
  dark = await themeNamed("Dark");
});

const para = (over: Partial<Paragraph> = {}, ...runs: Run[]): Paragraph => ({ runs: runs.length > 0 ? runs : [{ t: "x" }], ...over });

describe("resolveStyle", () => {
  it("starts from the text style of the box", () => {
    const style = resolveStyle(light, "body", para(), { t: "x" });
    expect(style).toMatchObject({ size: 22, color: "text1", font: "body", bold: false, italic: false, underline: false, strike: false, code: false, link: null });
    expect(resolveStyle(light, "title", para(), { t: "x" })).toMatchObject({ size: 36, font: "heading", bold: true });
    expect(resolveStyle(light, "quote", para(), { t: "x" })).toMatchObject({ size: 32, italic: true });
    expect(resolveStyle(light, "caption", para(), { t: "x" })).toMatchObject({ size: 14, color: "text2" });
  });

  it("falls back to body for a style the theme does not have", () => {
    expect(resolveStyle(light, "no-such-style", para(), { t: "x" })).toMatchObject({ size: 22, color: "text1" });
  });

  it("lets the paragraph's own style replace the box's", () => {
    const style = resolveStyle(light, "body", para({ style: "title" }), { t: "x" });
    expect(style).toMatchObject({ size: 36, font: "heading", bold: true });
    // A caption is not bold even in a box whose style is.
    expect(resolveStyle(light, "title", para({ style: "caption" }), { t: "x" })).toMatchObject({ size: 14, bold: false });
    // A style the theme does not have changes nothing.
    expect(resolveStyle(light, "body", para({ style: "nope" }), { t: "x" }).size).toBe(22);
  });

  it("puts the run's own size, colour, font, bold and italic on top", () => {
    const style = resolveStyle(light, "body", para(), { t: "x", size: 30, color: "accent2", font: "Georgia", b: true, i: true, u: true, s: true });
    expect(style).toMatchObject({ size: 30, color: "accent2", font: "Georgia", bold: true, italic: true, underline: true, strike: true });
  });

  it("cannot take the bold of a text style away", () => {
    expect(resolveStyle(light, "title", para(), { t: "x", b: false }).bold).toBe(true);
  });

  it("sets code in the code font unless the run names a font, and math in italics", () => {
    expect(resolveStyle(light, "body", para(), { t: "x", code: true })).toMatchObject({ font: "code", code: true });
    expect(resolveStyle(light, "body", para(), { t: "x", code: true, font: "heading" }).font).toBe("heading");
    expect(resolveStyle(light, "body", para(), { t: "x", math: true }).italic).toBe(true);
  });

  it("ignores a size or colour that makes no sense", () => {
    expect(resolveStyle(light, "body", para(), { t: "x", size: 0 }).size).toBe(22);
    expect(resolveStyle(light, "body", para(), { t: "x", size: Number.NaN }).size).toBe(22);
    expect(resolveStyle(light, "body", para(), { t: "x", color: "red" }).color).toBe("text1");
    expect(resolveStyle(light, "caption", para(), { t: "x", color: "" }).color).toBe("text2");
  });
});

describe("runCss", () => {
  it("draws the body style at 22 pt as 29.333 px in the theme's body font and text colour", () => {
    expect(runCss(light, "body", para(), { t: "x" })).toEqual({
      fontFamily: fontStack(light, "body"),
      fontSize: "29.333px",
      fontWeight: 400,
      fontStyle: "normal",
      color: "#202124",
    });
  });

  it("sizes by points times four thirds", () => {
    expect(runCss(light, "title", para(), { t: "x" }).fontSize).toBe("48px");
    expect(runCss(light, "caption", para(), { t: "x" }).fontSize).toBe("18.667px");
    expect(runCss(light, "body", para(), { t: "x", size: 12 }).fontSize).toBe("16px");
    expect(runCss(light, "body", para(), { t: "x", size: 10.5 }).fontSize).toBe("14px");
  });

  it("takes weight and slant from the style and the run's flags", () => {
    expect(runCss(light, "title", para(), { t: "x" })).toMatchObject({ fontWeight: 700, fontStyle: "normal", fontFamily: fontStack(light, "heading") });
    expect(runCss(light, "body", para(), { t: "x", b: true, i: true })).toMatchObject({ fontWeight: 700, fontStyle: "italic" });
    expect(runCss(light, "quote", para(), { t: "x" }).fontStyle).toBe("italic");
  });

  it("writes underline and strike as text-decoration", () => {
    expect(runCss(light, "body", para(), { t: "x", u: true }).textDecoration).toBe("underline");
    expect(runCss(light, "body", para(), { t: "x", s: true }).textDecoration).toBe("line-through");
    expect(runCss(light, "body", para(), { t: "x", u: true, s: true }).textDecoration).toBe("underline line-through");
    expect(runCss(light, "body", para(), { t: "x" })).not.toHaveProperty("textDecoration");
  });

  it("looks a colour token up in the theme and keeps a hex value", () => {
    expect(runCss(light, "body", para(), { t: "x", color: "accent2" }).color).toBe("#ea4335");
    expect(runCss(dark, "body", para(), { t: "x", color: "accent2" }).color).toBe("#f28b82");
    expect(runCss(light, "body", para(), { t: "x", color: "#12ab34" }).color).toBe("#12ab34");
    expect(runCss(dark, "body", para(), { t: "x" }).color).toBe("#f1f3f4");
  });

  it("sets a font by role or by family name, with fallbacks and a generic", () => {
    expect(runCss(light, "body", para(), { t: "x", font: "heading" }).fontFamily).toBe(fontStack(light, "heading"));
    expect(runCss(light, "body", para(), { t: "x", font: "Georgia" }).fontFamily).toBe('"Georgia", serif');
    expect(runCss(light, "body", para(), { t: "x", font: "code" }).fontFamily).toBe('"Roboto Mono", "Consolas", monospace');
  });

  it("sets code in the code font on a faint ground", () => {
    const css = runCss(light, "body", para(), { t: "x", code: true });
    expect(css.fontFamily).toBe('"Roboto Mono", "Consolas", monospace');
    expect(css.background).toBe("rgba(32, 33, 36, 0.08)");
    expect(css.background).toBe(codeBackground(light));
    expect(runCss(dark, "body", para(), { t: "x", code: true }).background).toBe("rgba(241, 243, 244, 0.08)");
  });

  it("underlines a link in accent1", () => {
    const css = runCss(light, "body", para(), { t: "x", link: "https://example.com", color: "accent2" });
    expect(css.color).toBe("#1a73e8");
    expect(css.textDecoration).toBe("underline");
    expect(runCss(light, "body", para(), { t: "x", link: "https://example.com", s: true }).textDecoration).toBe("underline line-through");
  });
});

describe("paragraphCss", () => {
  it("gives the body style its line height, spacing and base look", () => {
    expect(paragraphCss(light, "body", para())).toEqual({
      fontFamily: fontStack(light, "body"),
      fontWeight: 400,
      fontStyle: "normal",
      color: "#202124",
      textAlign: "left",
      lineHeight: 1.15,
      marginTop: "0px",
      marginBottom: "8px",
      fontSize: "29.333px",
    });
  });

  it("uses one line and no spacing when neither the paragraph nor the style say", () => {
    const css = paragraphCss(light, "title", para());
    expect(css).toMatchObject({ lineHeight: 1, marginTop: "0px", marginBottom: "0px", fontSize: "48px", fontWeight: 700 });
  });

  it("lets the paragraph's own spacing win over the style's", () => {
    const css = paragraphCss(light, "body", para({ lineSpacing: 1.5, spaceBefore: 12, spaceAfter: 3 }));
    expect(css).toMatchObject({ lineHeight: 1.5, marginTop: "16px", marginBottom: "4px" });
  });

  it("aligns by the paragraph, else the style, else left", () => {
    expect(paragraphCss(light, "body", para({ align: "center" })).textAlign).toBe("center");
    expect(paragraphCss(light, "body", para({ align: "justify" })).textAlign).toBe("justify");
    const centred: Theme = { ...light, textStyles: { ...light.textStyles, body: { ...light.textStyles.body!, align: "right" } } };
    expect(paragraphCss(centred, "body", para()).textAlign).toBe("right");
    expect(paragraphCss(centred, "body", para({ align: "left" })).textAlign).toBe("left");
    expect(resolveAlign(centred, "body", para())).toBe("right");
  });

  it("hangs the marker of a list item in the room it needs, left of its text", () => {
    // A bullet at 22 pt needs 28 units and its air, which is 30 in steps of 6.
    const bullet = paragraphCss(light, "body", para({ list: "bullet" }));
    expect(bullet).toMatchObject({ paddingLeft: "30px", textIndent: "-30px", "--ks-indent": "30px" });
    expect(paragraphCss(light, "body", para({ list: "bullet", level: 0 })).paddingLeft).toBe("30px");
    // Each level sits under the words of the one above: 24 for the empty first level, then what its marker needs.
    expect(paragraphCss(light, "body", para({ list: "number", level: 1 }))).toMatchObject({ paddingLeft: "60px", textIndent: "-36px" });
    expect(paragraphCss(light, "body", para({ list: "bullet", level: 2 }))).toMatchObject({ paddingLeft: "78px", textIndent: "-30px" });
  });

  it("sets the lines of a paragraph where it says, and where its list puts them for the others", () => {
    expect(paragraphCss(light, "body", para({ list: "bullet", marginLeft: 50, indent: -20 }))).toMatchObject({ paddingLeft: "50px", textIndent: "-20px", "--ks-indent": "20px" });
    expect(paragraphCss(light, "body", para({ marginLeft: 40, indent: 12 }))).toMatchObject({ paddingLeft: "40px", textIndent: "12px" });
    const alone = paragraphCss(light, "body", para({ list: "bullet" }), { geometry: { margin: 60, indent: -36 } });
    expect(alone).toMatchObject({ paddingLeft: "60px", textIndent: "-36px", "--ks-indent": "36px" });
  });

  it("sets raised and lowered words smaller, small capitals, capitals and the space between letters", () => {
    const run = (extra: Partial<Run>) => runCss(light, "body", para(), { t: "x", ...extra });
    expect(run({ script: "super" })).toMatchObject({ fontSize: "19.067px", position: "relative", top: "-0.4615em", verticalAlign: "baseline", lineHeight: 0 });
    expect(run({ script: "sub" })).toMatchObject({ top: "0.3846em" });
    expect(run({ smallCaps: true }).fontVariantCaps).toBe("small-caps");
    expect(run({ allCaps: true }).textTransform).toBe("uppercase");
    expect(run({ spacing: 3 }).letterSpacing).toBe("4px");
    expect(run({})).not.toHaveProperty("letterSpacing");
  });

  it("indents a plain paragraph by its level, without a hanging marker", () => {
    expect(paragraphCss(light, "body", para())).not.toHaveProperty("paddingLeft");
    expect(paragraphCss(light, "body", para({ level: 0 }))).not.toHaveProperty("paddingLeft");
    const indented = paragraphCss(light, "body", para({ level: 2 }));
    expect(indented.paddingLeft).toBe("48px");
    expect(indented).not.toHaveProperty("textIndent");
  });

  it("hides a paragraph of a later step but keeps its place", () => {
    expect(paragraphCss(light, "body", para({ step: 2 }), { step: 1 }).visibility).toBe("hidden");
    expect(paragraphCss(light, "body", para({ step: 2 }), { step: 2 })).not.toHaveProperty("visibility");
    expect(paragraphCss(light, "body", para({ step: 2 }), {})).not.toHaveProperty("visibility");
    expect(paragraphCss(light, "body", para(), { step: 0 })).not.toHaveProperty("visibility");
  });

  it("measures lines by the smallest run size when every run sets one", () => {
    expect(strutSize(light, "body", para({}, { t: "a", size: 16 }, { t: "b", size: 12 }))).toBe(12);
    expect(strutSize(light, "body", para({}, { t: "a", size: 16 }, { t: "b" }))).toBe(22);
    expect(strutSize(light, "body", para({}, { t: "a", size: 40 }))).toBe(40);
    // A paragraph with no words is measured by its mark, the one empty run it holds.
    expect(strutSize(light, "body", para({}, { t: "", size: 8 }))).toBe(8);
    expect(strutSize(light, "body", para({}, { t: "" }))).toBe(22);
    expect(strutSize(light, "body", para({}, { t: "a", size: 16 }, { t: "", size: 8 }))).toBe(16);
    expect(paragraphCss(light, "body", para({}, { t: "a", size: 16 })).fontSize).toBe("21.333px");
  });

  it("gives a list marker the look of the paragraph's first run", () => {
    const css = paragraphCss(light, "body", para({ list: "bullet" }, { t: "a", size: 32, color: "accent2", b: true }, { t: "b" }));
    expect(css).toMatchObject({
      "--ks-marker-size": "42.667px",
      "--ks-marker-color": "#ea4335",
      "--ks-marker-weight": "700",
      "--ks-marker-style": "normal",
      "--ks-marker-family": fontStack(light, "body"),
    });
    const plain = paragraphCss(light, "body", para({ list: "bullet" }));
    expect(plain).toMatchObject({ "--ks-marker-size": "29.333px", "--ks-marker-color": "#202124" });
    expect(paragraphCss(light, "body", para())).not.toHaveProperty("--ks-marker-size");
  });

  it("lets the marker have a colour and a size of its own", () => {
    const css = paragraphCss(light, "body", para({ list: "bullet", bulletColor: "accent2", bulletSize: 1.5 }, { t: "a", color: "accent3" }));
    expect(css).toMatchObject({ "--ks-marker-size": "44px", "--ks-marker-color": "#ea4335" });
    // A colour that is not one is not used.
    expect(paragraphCss(light, "body", para({ list: "bullet", bulletColor: "nonsense" }))).toMatchObject({ "--ks-marker-color": "#202124" });
  });
});
