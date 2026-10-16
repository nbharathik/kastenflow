// A button that is only an icon has a name: a screen reader says what it does
// and a pointer shows a tooltip. (`IconButton` makes this impossible to forget;
// this scan covers the buttons written by hand.)

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = [join(process.cwd(), "src"), join(process.cwd(), "app", "src")].find((dir) => existsSync(join(dir, "main.tsx")))!;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });
}

/** Every `<button>` whose only content is one icon: its attributes, and where it is. */
function iconOnly(): { attrs: string; at: string }[] {
  return files(SRC).flatMap((path) => {
    const text = readFileSync(path, "utf8");
    // `<button …attributes…>` then nothing but one icon, then `</button>`. The attributes may hold an arrow ("=>").
    return [...text.matchAll(/<button\b((?:=>|[^<>])*)>\s*<(?:Icon|ToolIcon|Glyph)\b[^<]*?\/>\s*<\/button>/g)].map((m) => ({
      attrs: m[1]!,
      at: `${relative(SRC, path)}:${text.slice(0, m.index).split("\n").length}`,
    }));
  });
}

describe("icon-only buttons", () => {
  it("are found by the scan (so the test below is not empty)", () => {
    expect(iconOnly().length).toBeGreaterThan(5);
  });

  it("are named, by aria-label, aria-labelledby or a title", () => {
    expect(iconOnly().filter(({ attrs }) => !/\b(?:aria-label|aria-labelledby|title)=/.test(attrs)).map(({ at }) => at)).toEqual([]);
  });
});
