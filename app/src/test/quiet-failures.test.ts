// Things the person asked for never fail in silence, and nothing polls
// behind a hidden window.
//
// - A click that opens a link, changes a size or keeps agent writing says so
//   when it fails (`said(...)`), so none of those ends in `.catch(() => {})`.
// - No catch has an empty body: a reason is written in it.
// - A `.catch(() => {})` on background work carries its reason in a comment
//   beside it; the number without one only goes down (a new one needs a reason).
// - Every timer that repeats goes through lib/use-interval, which rests while
//   the window is hidden and starts over after a sleep.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = [join(process.cwd(), "src"), join(process.cwd(), "app", "src")].find((dir) => existsSync(join(dir, "main.tsx")))!;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "smart-kit" ? [] : sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const files = sources(SRC).map((path) => ({ name: relative(SRC, path).replaceAll("\\", "/"), lines: readFileSync(path, "utf8").split("\n") }));

describe("failures are not silent", () => {
  it("a click that opens, resizes or keeps says why it failed", () => {
    const ASKED = /\b(openUrl|chooseZoom|zoomBy|accept)\([^)]*\)\s*\.catch\(\(\) => \{\}\)/;
    const found = files.flatMap((f) => f.lines.flatMap((line, i) => (ASKED.test(line) ? [`${f.name}:${i + 1}`] : [])));
    expect(found).toEqual([]);
  });

  it("no catch has an empty body", () => {
    const EMPTY = /catch(\s*\(\w+\))?\s*\{\s*\}/;
    const found = files.flatMap((f) => (EMPTY.test(f.lines.join("\n")) ? [f.name] : []));
    expect(found).toEqual([]);
  });

  it("a quiet .catch on background work is explained, and the unexplained ones do not grow", () => {
    const QUIET = /\.catch\(\(\) => \{\}\)/;
    const bare = files.flatMap((f) =>
      f.lines.flatMap((line, i) => {
        if (!QUIET.test(line)) return [];
        // On the line, or in the comment just above it (a group of calls shares one).
        const near = [line, ...f.lines.slice(Math.max(0, i - 6), i)].some((l) => /\/\/\s*\S/.test(l));
        return near ? [] : [`${f.name}:${i + 1}`];
      }),
    );
    // Brought down by the sweep; a new quiet catch needs its reason beside it.
    expect(bare.length, bare.join("\n")).toBeLessThanOrEqual(BUDGET);
  });
});

const BUDGET = 0;

describe("polls rest while the window is hidden", () => {
  it("only lib/use-interval and lib/wake call setInterval", () => {
    const allowed = new Set(["lib/use-interval.ts", "lib/wake.ts"]);
    const found = files
      .filter((f) => !allowed.has(f.name))
      .flatMap((f) => f.lines.flatMap((line, i) => (/\bsetInterval\(/.test(line) ? [`${f.name}:${i + 1}`] : [])));
    expect(found).toEqual([]);
  });
});
