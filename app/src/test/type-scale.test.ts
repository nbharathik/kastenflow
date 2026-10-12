// Sizes are written in rem (and em for the page's title and icon) so they
// follow the root and the page's text, and at the usual 16px root they come
// to the same pixels they always did. The text sizes of a page are 14, 16,
// 18 and 20 pixels.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { TEXT_PX, pageFontSize } from "../features/workspace/page/text-size";
import { TEXT_SIZES } from "../features/workspace/prefs";

const SRC = [join(process.cwd(), "src"), join(process.cwd(), "app", "src")].find((dir) => existsSync(join(dir, "main.tsx")))!;
const read = (path: string) => readFileSync(join(SRC, path), "utf8");

/** The usual root font size, which a rem is. */
const ROOT = 16;

const styles = read("styles.css");
const page = read("features/pages/page/page.css");

describe("the type scale", () => {
  const tokens = [...styles.matchAll(/--text-(\d+):\s*([\d.]+)(px|rem);/g)];

  it("has the nine steps, each named by the pixels it comes to at a 16px root", () => {
    expect(tokens.map((t) => Number(t[1]))).toEqual([11, 12, 13, 14, 16, 20, 24, 28, 40]);
    for (const [, name, value, unit] of tokens) {
      expect(unit, `--text-${name}`).toBe("rem");
      expect(Number(value) * ROOT, `--text-${name}`).toBe(Number(name));
    }
  });

  it("leaves no size in pixels in the scale", () => {
    expect(styles).not.toMatch(/--text-\d+:\s*[\d.]+px/);
  });
});

describe("the page's sizes", () => {
  /** The declarations of the rule whose selector is `selector`. */
  const rule = (selector: string) => page.match(new RegExp(`^${selector.replace(/[.]/g, "\\.")}\\s*\\{([^{}]*)`, "m"))?.[1] ?? "";
  const value = (declarations: string, property: string) => declarations.match(new RegExp(`(?:^|\\s)${property}:\\s*([^;]+);`))?.[1];

  it("has a column of 708px that is in rem, so a smaller or larger text does not move it", () => {
    const width = value(page, "--page-width");
    expect(width).toBe("44.25rem");
    expect(parseFloat(width!) * ROOT).toBe(708);
  });

  it("draws the title at 40px and the icon at 72px in an 84px box, half of it over a cover, at 16px text", () => {
    const text = ROOT;
    expect(value(rule(".kasten-page-title"), "font-size")).toBe("2.5em");
    expect(2.5 * text).toBe(40);
    const icon = rule(".kasten-page-icon");
    expect(value(icon, "font-size")).toBe("4.5em");
    const font = 4.5 * text;
    expect(font).toBe(72);
    expect(value(icon, "width")).toBe("calc(7em / 6)");
    expect((7 / 6) * font).toBeCloseTo(84, 9);
    expect(value(rule(".kasten-page-header.has-cover .kasten-page-icon"), "margin-top")).toBe("calc(-7em / 12)");
    expect((-7 / 12) * font).toBeCloseTo(-42, 9);
  });

  it("sets the page text from the size, in rem", () => {
    expect(value(rule(".kasten-page"), "font-size")).toBe("var(--page-font-size, 1rem)");
    expect(TEXT_SIZES.map((size) => TEXT_PX[size])).toEqual([14, 16, 18, 20]);
    expect(TEXT_SIZES.map(pageFontSize)).toEqual(["0.875rem", "1rem", "1.125rem", "1.25rem"]);
    for (const size of TEXT_SIZES) expect(parseFloat(pageFontSize(size)) * ROOT).toBe(TEXT_PX[size]);
  });
});
