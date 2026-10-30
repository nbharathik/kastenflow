// Tables scroll sideways inside their own box and let the wheel reach the page.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = [join(process.cwd(), "src"), join(process.cwd(), "app", "src")].find((dir) => {
  try {
    readFileSync(join(dir, "main.tsx"));
    return true;
  } catch {
    return false;
  }
})!;
const css = (path: string) => readFileSync(join(root, path), "utf8");

describe("table scrolling css", () => {
  it("keeps the wheel's vertical scroll reaching the page", () => {
    for (const path of ["features/tags/views/table/table.css", "features/tags/views/kanban/board.css"]) {
      expect(css(path)).toMatch(/overscroll-behavior-x:\s*contain/);
      expect(css(path)).not.toMatch(/overscroll-behavior:\s*contain/);
    }
  });

  it("scrolls a markdown table sideways in Milkdown's own wrapper", () => {
    const text = css("features/pages/editor/styles/notion.css");
    expect(text).toMatch(/\.table-wrapper,\s*&\s*\.tableWrapper\s*\{[^}]*overflow-x:\s*auto/);
    expect(text).not.toMatch(/table-layout:\s*fixed/);
  });

  it("gives an embedded database a definite height", () => {
    const text = css("features/pages/editor/blocks/database-embed.css");
    expect(text).toMatch(/\.kasten-db-embed-body\s*\{[^}]*\n\s*height:\s*min\(/);
    expect(text).toMatch(/&\s*>\s*\.kasten-tagdb\s*\{[^}]*height:\s*100%/);
  });
});
