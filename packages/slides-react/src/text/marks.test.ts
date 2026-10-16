// @vitest-environment node

import type { Paragraph, Run, Theme } from "@kasten-slides/wasm";
import { beforeAll, describe, expect, it } from "vitest";

import { MARK_ORDER, flattenWraps, isBlankWrap, markInputsOf, runExtra, wrapOf, wrapsOfRun } from "./marks.ts";
import { themeNamed } from "./test-support.ts";
import { paragraphBlockCss, paragraphCss, runCss } from "./text-style.ts";

let light: Theme;
let dark: Theme;

beforeAll(async () => {
  light = await themeNamed("Light");
  dark = await themeNamed("Dark");
});

describe("markInputsOf", () => {
  it("lists the marks of a run in schema order", () => {
    const run: Run = { t: "x", s: true, field: "slideNumber", u: true, link: "https://x.y", color: "accent1", highlight: "accent3", math: true, i: true, b: true, font: "Georgia", code: true, size: 12, script: "super", smallCaps: true, allCaps: true, spacing: 1 };
    expect(markInputsOf(run).map((input) => input.name)).toEqual(["size", "code", "font", "bold", "italic", "math", "script", "smallCaps", "allCaps", "spacing", "highlight", "color", "link", "underline", "strike", "field"]);
    expect(markInputsOf(run).map((input) => input.name)).toEqual(MARK_ORDER.filter((name) => name !== "extra"));
  });

  it("leaves out what is not set or makes no sense", () => {
    expect(markInputsOf({ t: "x" })).toEqual([]);
    expect(markInputsOf({ t: "x", b: false, size: 0, color: "", font: "", link: "", field: "", code: false } as Run)).toEqual([]);
    expect(markInputsOf({ t: "x", size: Number.NaN })).toEqual([]);
    expect(markInputsOf({ t: "x", color: null, font: null, link: null, field: null, size: null })).toEqual([]);
    expect(markInputsOf({ t: "x", highlight: null })).toEqual([]);
    expect(markInputsOf({ t: "x", highlight: "" })).toEqual([]);
  });

  it("does not take a highlight for a field the format does not define", () => {
    expect(runExtra({ t: "x", highlight: "accent3" })).toBeNull();
    expect(markInputsOf({ t: "x", highlight: "#ffee00" })).toEqual([{ name: "highlight", value: "#ffee00" }]);
  });

  it("carries what the format does not define as one mark", () => {
    const run = { t: "x", lang: "en", note: { a: [1] } } as Run;
    expect(runExtra(run)).toEqual({ lang: "en", note: { a: [1] } });
    expect(markInputsOf(run)).toEqual([{ name: "extra", value: '{"lang":"en","note":{"a":[1]}}' }]);
    expect(runExtra({ t: "x", b: true })).toBeNull();
  });
});

describe("wrapOf", () => {
  it("draws a mark as an element with only what the mark changes", () => {
    expect(wrapOf(light, { name: "bold" })).toEqual({ tag: "span", style: { fontWeight: 700 }, attrs: {} });
    expect(wrapOf(light, { name: "italic" })).toMatchObject({ style: { fontStyle: "italic" } });
    expect(wrapOf(light, { name: "underline" })).toMatchObject({ style: { textDecoration: "underline" } });
    expect(wrapOf(light, { name: "strike" })).toMatchObject({ style: { textDecoration: "line-through" } });
    expect(wrapOf(light, { name: "size", value: 22 })).toMatchObject({ style: { fontSize: "29.333px" } });
    expect(wrapOf(light, { name: "color", value: "accent1" })).toMatchObject({ style: { color: "#1a73e8" } });
    expect(wrapOf(dark, { name: "color", value: "accent1" })).toMatchObject({ style: { color: "#8ab4f8" } });
    expect(wrapOf(light, { name: "color", value: "#ABC" })).toMatchObject({ style: { color: "#aabbcc" } });
    expect(wrapOf(light, { name: "font", value: "Georgia" })).toMatchObject({ style: { fontFamily: '"Georgia", serif' } });
  });

  it("draws a highlight as a ground behind the words, of the theme's colour or a hex value, and nothing for what is not a colour", () => {
    expect(wrapOf(light, { name: "highlight", value: "accent3" })).toEqual({ tag: "span", style: { background: "#fbbc04" }, attrs: {} });
    expect(wrapOf(dark, { name: "highlight", value: "accent3" }).style.background).not.toBe("#fbbc04");
    expect(wrapOf(light, { name: "highlight", value: "#FFEE00" })).toMatchObject({ style: { background: "#ffee00" } });
    expect(isBlankWrap(wrapOf(light, { name: "highlight", value: "yellow" }))).toBe(true);
  });

  it("puts the highlight inside inline code, so it is drawn instead of the ground code has", () => {
    const names = wrapsOfRun(light, { t: "x", code: true, highlight: "#ffee00" }).map((wrap) => wrap.style.background);
    expect(names).toHaveLength(2);
    expect(names[1]).toBe("#ffee00");
    expect(runCss(light, "body", { runs: [] }, { t: "x", code: true, highlight: "#ffee00" }).background).toBe("#ffee00");
    expect(runCss(light, "body", { runs: [] }, { t: "x", code: true }).background).not.toBe("#ffee00");
    expect(runCss(light, "body", { runs: [] }, { t: "x", highlight: "yellow" }).background).toBeUndefined();
  });

  it("makes a link an `a` with its address in data-href and the theme's link colour", () => {
    expect(wrapOf(light, { name: "link", value: "https://x.y" })).toEqual({ tag: "a", className: "ks-text-link", style: { color: "#1a73e8", textDecoration: "underline" }, attrs: { "data-href": "https://x.y" } });
  });

  it("draws nothing for a colour that is not one, and nothing for extra fields", () => {
    expect(isBlankWrap(wrapOf(light, { name: "color", value: "red" }))).toBe(true);
    expect(isBlankWrap(wrapOf(light, { name: "extra", value: "{}" }))).toBe(true);
    expect(isBlankWrap(wrapOf(light, { name: "bold" }))).toBe(false);
    expect(wrapsOfRun(light, { t: "x", color: "red", lang: "en" } as Run)).toEqual([]);
  });
});

describe("the elements around a run", () => {
  it("put a run's own font inside the code font, and a link's colour inside the run's", () => {
    const wraps = wrapsOfRun(light, { t: "x", code: true, font: "Georgia", color: "accent2", link: "https://x.y" });
    const flat = flattenWraps(wraps);
    expect(flat.fontFamily).toBe('"Georgia", serif');
    expect(flat.color).toBe("#1a73e8");
    expect(flat.background).toBe("rgba(32, 33, 36, 0.08)");
  });

  it("draw a line in the colour of the text it is under", () => {
    const names = wrapsOfRun(light, { t: "x", u: true, s: true, color: "accent2" }).map((wrap) => Object.keys(wrap.style)[0]);
    expect(names).toEqual(["color", "textDecoration", "textDecoration"]);
  });

  it("add up to the look runCss gives, for any run in any paragraph", () => {
    // The paragraph's element carries the look of its text style and each run only what it changes,
    // so the two together must be the look of the run in full.
    const FLAGS = ["b", "i", "u", "s", "code", "math"] as const;
    const themes = [light, dark];
    for (let n = 0; n < 512; n++) {
      const run: Run = { t: "x" };
      FLAGS.forEach((flag, bit) => {
        if (n & (1 << bit)) run[flag] = true;
      });
      if (n & 64) run.color = n & 1 ? "accent3" : "#123456";
      if (n & 128) run.size = 14;
      if (n & 256) run.font = n & 2 ? "Georgia" : "heading";
      if (n % 7 === 0) run.link = "https://x.y";
      for (const theme of themes) {
        for (const base of ["body", "title", "quote", "caption", "code"]) {
          const paragraph: Paragraph = { runs: [run], ...(n % 5 === 0 ? { style: "caption" } : {}) };
          const cascade = { ...paragraphCss(theme, base, paragraph), ...flattenWraps(wrapsOfRun(theme, run)) };
          const full = runCss(theme, base, paragraph, run);
          for (const key of ["fontFamily", "fontSize", "fontWeight", "fontStyle", "color", "textDecoration", "background", "borderRadius"] as const) {
            expect(cascade[key], `${key} for run ${JSON.stringify(run)} in ${base}`).toEqual(full[key]);
          }
        }
      }
    }
  });

  it("add up to the same look for each run of a paragraph of several", () => {
    const paragraph: Paragraph = { runs: [{ t: "a", size: 14 }, { t: "b", size: 20, b: true }, { t: "c", size: 16, code: true }] };
    for (const run of paragraph.runs) {
      const cascade = { ...paragraphCss(light, "body", paragraph), ...flattenWraps(wrapsOfRun(light, run)) };
      const full = runCss(light, "body", paragraph, run);
      expect(cascade.fontSize).toBe(full.fontSize);
      expect(cascade.fontWeight).toBe(full.fontWeight);
      expect(cascade.fontFamily).toBe(full.fontFamily);
    }
  });

  it("leave the paragraph's own part to the paragraph", () => {
    const block = paragraphBlockCss(light, "body", { runs: [{ t: "x", size: 40 }] });
    expect(block).not.toHaveProperty("fontSize");
    expect(paragraphCss(light, "body", { runs: [{ t: "x", size: 40 }] }).fontSize).toBe("53.333px");
  });
});
