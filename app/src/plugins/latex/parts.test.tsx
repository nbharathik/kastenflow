import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { rowsOf } from "./FileTree";
import { clampDelay, readPrefs, useLatexPrefs } from "./prefs";
import { LatexSection } from "./settings";
import { saveText } from "./StatusLine";

afterEach(() => {
  cleanup();
  useLatexPrefs.getState().set({ autoBuild: true, delayMs: 500 });
  vi.restoreAllMocks();
});

describe("the editor's choices", () => {
  it("mends whatever storage holds", () => {
    expect(readPrefs(null)).toMatchObject({ autoBuild: true, delayMs: 500, treeOpen: true });
    expect(readPrefs("{not json")).toMatchObject({ autoBuild: true, delayMs: 500 });
    expect(readPrefs(JSON.stringify({ autoBuild: "yes", delayMs: 99999, treeWidth: -5, previewWidth: 700 }))).toMatchObject({ autoBuild: true, delayMs: 2000, treeWidth: 120, previewWidth: 700 });
    expect(readPrefs(JSON.stringify({ autoBuild: false, delayMs: 1200 }))).toMatchObject({ autoBuild: false, delayMs: 1200 });
    expect(readPrefs("[1,2]")).toMatchObject({ delayMs: 500 });
  });

  it("keeps the wait between 300 and 2000 ms", () => {
    expect(clampDelay(100)).toBe(300);
    expect(clampDelay(300)).toBe(300);
    expect(clampDelay(2000)).toBe(2000);
    expect(clampDelay(5000)).toBe(2000);
    expect(clampDelay(Number.NaN)).toBe(500);
    expect(clampDelay("fast")).toBe(500);
  });

  it("works even when the webview's storage refuses to write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => useLatexPrefs.getState().set({ delayMs: 900 })).not.toThrow();
    expect(useLatexPrefs.getState().delayMs).toBe(900);
  });
});

describe("the file tree's rows", () => {
  const file = (path: string, editable = true) => ({ path, editable, size: 1 });
  it("lists the root's files first, then each folder's, by name", () => {
    const rows = rowsOf([file("d/sections/b.tex"), file("d/refs.bib"), file("d/main.tex"), file("d/figs/plot.png", false), file("d/sections/a.tex")], "d");
    expect(rows.map((r) => r.rel)).toEqual(["main.tex", "refs.bib", "figs/plot.png", "sections/a.tex", "sections/b.tex"]);
    expect(rows.map((r) => r.folder)).toEqual(["", "", "figs", "sections", "sections"]);
  });
});

describe("the save line", () => {
  it("says Saved, Saving…, or what is wrong", () => {
    expect(saveText({ dirty: [], saveProblem: null, conflict: null })).toEqual({ text: "Saved", bad: false });
    expect(saveText({ dirty: ["a"], saveProblem: null, conflict: null })).toEqual({ text: "Saving…", bad: false });
    expect(saveText({ dirty: ["a"], saveProblem: "full", conflict: null })).toEqual({ text: "Not saved", bad: true });
    expect(saveText({ dirty: [], saveProblem: null, conflict: { path: "a", copy: "b" } }).bad).toBe(true);
  });
});

describe("Settings → LaTeX", () => {
  it("has the build-while-typing switch and the wait, clamped, switched off with the switch", () => {
    render(<LatexSection />);
    const auto = screen.getByRole("switch", { name: "Build while I type" }) as HTMLInputElement;
    const wait = screen.getByRole("spinbutton", { name: "Wait after typing, in milliseconds" }) as HTMLInputElement;
    expect(auto.checked).toBe(true);
    expect(wait.value).toBe("500");
    fireEvent.change(wait, { target: { value: "50" } });
    expect(useLatexPrefs.getState().delayMs).toBe(300);
    fireEvent.change(wait, { target: { value: "1500" } });
    expect(useLatexPrefs.getState().delayMs).toBe(1500);
    fireEvent.click(auto);
    expect(useLatexPrefs.getState().autoBuild).toBe(false);
    expect((screen.getByRole("spinbutton") as HTMLInputElement).disabled).toBe(true);
  });
});
