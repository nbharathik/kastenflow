// The wizard's look comes from the design tokens: no raw colours in its
// styles or markup, and no file grows past about 400 lines.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(process.cwd(), "src", "features", "backup", "wizard");
const sources = readdirSync(DIR).filter((f) => /\.(css|tsx?)$/.test(f) && !/\.test\.|harness/.test(f));
const read = (file: string) => readFileSync(join(DIR, file), "utf8");
const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the backup wizard's files", () => {
  it("has a style file and sources to look at", () => {
    expect(sources).toContain("wizard.css");
    expect(sources.length).toBeGreaterThan(10);
  });

  for (const file of sources) {
    it(`${file} uses no raw colours`, () => {
      const text = strip(read(file));
      expect(text.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
      expect(text.match(/\b(?:rgba?|hsla?|oklch|oklab)\(/g) ?? []).toEqual([]);
      expect(text.match(/\b(?:text|bg|border|ring|fill|stroke)-(?:white|black|red|green|blue|gray|slate|zinc|neutral|amber|yellow|orange)\b/g) ?? []).toEqual([]);
    });

    it(`${file} stays under 400 lines`, () => {
      expect(read(file).split("\n").length).toBeLessThan(400);
    });
  }

  it("names every colour in the style file by token", () => {
    const uses = strip(read("wizard.css")).match(/(?:color|background|box-shadow|outline|accent-color)\s*:[^;]+;/g) ?? [];
    for (const use of uses) {
      expect(use, use).toMatch(/var\(--|transparent|none|inherit/);
    }
  });
});
