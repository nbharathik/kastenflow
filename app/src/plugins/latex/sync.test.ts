import { describe, expect, it, vi } from "vitest";

import { syncForward, syncInverse } from "./sync";
import type { DocFile, SyncHit } from "./types";

const HIT: SyncHit = { page: 2, x: 72, y: 300, width: 200, height: 10, depth: 2 };
const FOLDER = "projects/p/latex/paper";

describe("source to PDF", () => {
  it("finds the place for a line and shows it", async () => {
    const where = vi.fn(() => Promise.resolve(HIT));
    const show = vi.fn(() => Promise.resolve());
    const say = vi.fn();
    expect(await syncForward({ where, show, say }, `${FOLDER}/main.tex`, 12)).toBe(true);
    expect(where).toHaveBeenCalledWith(`${FOLDER}/main.tex`, 12);
    expect(show).toHaveBeenCalledWith(HIT);
    expect(say).not.toHaveBeenCalled();
  });

  it("says in a sentence when the line has no place yet", async () => {
    const say = vi.fn();
    const show = vi.fn();
    expect(await syncForward({ where: () => Promise.resolve(null), show, say }, "a.tex", 1)).toBe(false);
    expect(say).toHaveBeenCalledWith("There is no place in the PDF for that line yet. Build the document first.");
    expect(show).not.toHaveBeenCalled();
  });

  it("passes on the app's reason when it cannot answer, and does nothing without a file", async () => {
    const say = vi.fn();
    expect(await syncForward({ where: () => Promise.reject("There is no PDF yet: build the document first"), show: vi.fn(), say }, "a.tex", 1)).toBe(false);
    expect(say).toHaveBeenCalledWith("There is no PDF yet: build the document first");
    say.mockClear();
    expect(await syncForward({ where: vi.fn(), show: vi.fn(), say }, null, 1)).toBe(false);
    expect(say).not.toHaveBeenCalled();
  });
});

describe("PDF to source", () => {
  const files: DocFile[] = [
    { path: `${FOLDER}/main.tex`, editable: true, size: 1 },
    { path: `${FOLDER}/sections/intro.tex`, editable: true, size: 1 },
    { path: `${FOLDER}/fig.pdf`, editable: false, size: 1 },
  ];
  const deps = (inverse: (page: number, x: number, y: number) => Promise<{ file: string; line: number }>) => ({ folder: FOLDER, files: () => files, inverse, goTo: vi.fn(), say: vi.fn() });

  it("opens the file the place was typeset from, on that line", async () => {
    const d = deps(() => Promise.resolve({ file: "sections/intro.tex", line: 7 }));
    const inverse = vi.spyOn(d, "inverse");
    expect(await syncInverse(d, { page: 3, x: 100, y: 200 })).toBe(true);
    expect(inverse).toHaveBeenCalledWith(3, 100, 200);
    expect(d.goTo).toHaveBeenCalledWith(`${FOLDER}/sections/intro.tex`, 7);
  });

  it("says why when the place comes from a file the editor cannot open", async () => {
    const d = deps(() => Promise.resolve({ file: "fig.pdf", line: 1 }));
    expect(await syncInverse(d, { page: 1, x: 0, y: 0 })).toBe(false);
    expect(d.goTo).not.toHaveBeenCalled();
    expect(d.say).toHaveBeenCalledWith("That part of the PDF comes from fig.pdf, which cannot be edited here.");
  });

  it("says the app's reason when there is no source for the point", async () => {
    const d = deps(() => Promise.reject(new Error("Nothing at that place in the PDF.")));
    expect(await syncInverse(d, { page: 1, x: 0, y: 0 })).toBe(false);
    expect(d.say).toHaveBeenCalledWith("Nothing at that place in the PDF.");
  });
});
