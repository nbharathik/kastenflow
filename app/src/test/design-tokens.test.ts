// The look comes from one set of tokens (styles.css): a colour, size or
// shade written straight into a feature drifts from the theme, and a dark
// window or another accent shows it. These scans keep features on the
// tokens.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/** The app's sources; the tests run from `app/`. */
const SRC = [join(process.cwd(), "src"), join(process.cwd(), "app", "src")].find((dir) => existsSync(join(dir, "main.tsx")))!;

function files(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path, pattern);
    return pattern.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Every match of `pattern` in the files, as `file:line match`. */
function found(paths: string[], pattern: RegExp, allowed: (hit: string, file: string) => boolean = () => false): string[] {
  return paths.flatMap((path) => {
    const text = readFileSync(path, "utf8");
    const file = relative(SRC, path).replaceAll("\\", "/");
    return [...text.matchAll(pattern)].filter((m) => !allowed(m[0], file)).map((m) => `${file}:${text.slice(0, m.index).split("\n").length} ${m[0]}`);
  });
}

const SCRIPTS = files(SRC, /\.tsx?$/);
const STYLES = files(SRC, /\.css$/);

const PALETTE = "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black";
/** A Tailwind colour from its own palette, or a colour written in brackets. */
const RAW_COLOUR = new RegExp(
  String.raw`\b(?:bg|text|border(?:-[trblxy])?|ring|ring-offset|fill|stroke|from|via|to|outline|decoration|divide|accent|caret|placeholder|shadow)-(?:(?:${PALETTE})(?:-\d{2,3})?(?:\/\d+)?\b|\[(?:#|rgb|hsl|oklch|color-mix)[^\]]*\])`,
  "g",
);

describe("design tokens", () => {
  it("colour features with the theme's tokens, never Tailwind's palette", () => {
    expect(found(SCRIPTS, RAW_COLOUR)).toEqual([]);
  });

  it("put text on the accent in its own colour, which dark themes change", () => {
    // A block whose background is the accent sets its text in on-accent.
    const blocks = STYLES.flatMap((path) => {
      const text = readFileSync(path, "utf8");
      return [...text.matchAll(/\{([^{}]*)\}/g)]
        .filter((m) => /background(?:-color)?:\s*var\(--(?:color|notion)-accent\)\s*;/.test(m[1]!))
        .filter((m) => /(?:^|;|\s)color:/.test(m[1]!) && !/(?:^|;|\s)color:\s*var\(--color-on-accent\)/.test(m[1]!))
        .map((m) => `${relative(SRC, path)}:${text.slice(0, m.index).split("\n").length}`);
    });
    expect(blocks).toEqual([]);
    expect(found(SCRIPTS, /\bbg-accent(?![\w/-])[^"`]*?\btext-(?!on-accent\b|\d)[a-z-]+/g)).toEqual([]);
  });

  it("size text on the type scale", () => {
    expect(found(SCRIPTS, /\btext-\[\d[^\]]*\]/g)).toEqual([]);
    // Sizes in CSS come from the scale or are relative to the text around
    // them. The page's icon and a PDF thumbnail's lines are drawings, and so
    // are the labels inside the smart kit's charts: their sizes are in the
    // chart's own drawing units (a viewBox), not pixels on the screen. The kit is
    // served to a sandboxed page as plain files, so it cannot use the app's
    // CSS variables for these.
    const drawings = new Set([
      "features/pages/page/page.css 72px",
      "features/sources/highlights.css 6.5px",
      "smart-kit/kit.css 10px",
      "smart-kit/kit.css 7px",
      "smart-kit/kit.css 3.5px",
    ]);
    const sizes = found(STYLES, /font-size:\s*[\d.]+px|\bfont:\s*(?:\d{3}\s+)?[\d.]+px/g, (hit, file) => drawings.has(`${file} ${hit.match(/[\d.]+px/)![0]}`));
    expect(sizes).toEqual([]);
  });

  it("write no raw colours in the tables, views, menus and page styles", () => {
    const listed = new Set([
      "features/workspace/page/note-page.css",
      "features/pages/editor/styles/agent.css",
      "features/pages/editor/styles/menus.css",
      "features/pages/editor/styles/notion.css",
      "features/tags/tag-views.css",
      "features/tags/tag-schema.css",
      "features/tags/views/table/table.css",
      "features/tags/views/kanban/cards.css",
      "features/tags/views/kanban/board.css",
      "features/pages/editor/blocks/database-embed.css",
    ]);
    const paths = STYLES.filter((path) => listed.has(relative(SRC, path).replaceAll("\\", "/")));
    expect(paths).toHaveLength(listed.size);
    expect(found(paths, /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g)).toEqual([]);
  });

  it("keep labels in sentence case and surfaces free of blur", () => {
    // The smart kit's badge (a status chip inside a page's own frame, which cannot use the app's
    // styles) is the one place a style sheet may set capitals, and only text-transform there.
    const kitBadge = (hit: string, file: string) => file === "smart-kit/kit.css" && /^text-transform/.test(hit);
    expect(found(STYLES, /text-transform:\s*uppercase|backdrop-filter/g, kitBadge)).toEqual([]);
    expect(found(SCRIPTS, /(?<![\w-])(?:uppercase|backdrop-blur(?:-\w+)?)(?![\w-])(?=[^"`]*["`])/g)).toEqual([]);
  });
});
