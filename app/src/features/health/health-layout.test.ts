// The health page lines up on the card's left edge. The test environment draws
// no layout, so this reads the rules themselves: every section must fill the
// card instead of shrinking to its text, which a centred parent then centres.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(join(__dirname, "health.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations a selector's own block opens with, up to its first nested rule or its end. */
function declarations(selector: string): string {
  const start = CSS.search(new RegExp(`(^|\\n)${selector.replace(/[.-]/g, "\\$&")}\\s*\\{`));
  expect(start, `${selector} has a rule`).toBeGreaterThanOrEqual(0);
  const open = CSS.indexOf("{", start) + 1;
  return CSS.slice(open, CSS.slice(open).search(/[{}]/) + open);
}

describe("health page layout", () => {
  it("stretches its children across the card", () => {
    const page = declarations(".kasten-health");
    expect(page).toMatch(/align-items:\s*stretch/);
    expect(page).toMatch(/width:\s*100%/);
  });

  it("makes every section full width and left-aligned", () => {
    const section = declarations(".kasten-health-section");
    expect(section).toMatch(/align-self:\s*stretch/);
    expect(section).toMatch(/width:\s*100%/);
    expect(section).toMatch(/justify-items:\s*start/);
    expect(section).toMatch(/text-align:\s*left/);
  });

  it("puts the summary and issues under the dot and title, across both columns", () => {
    expect(CSS).toMatch(/&\s*>\s*:not\(\.kasten-health-dot,\s*\.kasten-health-title\)\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/);
  });
});
