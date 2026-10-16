// A day nobody wrote in is laid out like a page: its column follows the width
// preference instead of a width of its own.

import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { usePrefs } from "../workspace/prefs";
import { BlankDay } from "./BlankDay";

afterEach(() => usePrefs.setState({ fullWidth: false }));

describe("a blank journal day", () => {
  it("has the page column, and the whole width when pages are set to use it", () => {
    const { container, rerender } = render(<BlankDay day="2026-10-02" />);
    const blank = () => container.querySelector<HTMLElement>(".kasten-journal-blank")!;
    expect(blank().classList.contains("is-full-width")).toBe(false);
    usePrefs.setState({ fullWidth: true });
    rerender(<BlankDay day="2026-10-02" />);
    expect(blank().classList.contains("is-full-width")).toBe(true);
  });

  it("sets no width in pixels of its own", () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "blank-day.css"), "utf8");
    expect(css).not.toMatch(/--page-width:\s*\d+px/);
    expect(css).toMatch(/is-full-width/);
  });
});
