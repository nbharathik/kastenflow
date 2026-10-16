import { beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspace } from "../../workspace/store";
import { excerptsOf, MAX_CHARS, MAX_PAGES, pageText, pagesLabel, parsePages, pdfChip, readPages } from "./ai-context";

// A PDF of `texts`, one string (or list of text items) per page.
type Item = { str: string; hasEOL?: boolean };
const destroyed: string[] = [];
const doc = (pages: (string | Item[])[], name = "doc") =>
  ({
    numPages: pages.length,
    getPage: async (n: number) => ({ getTextContent: async () => ({ items: typeof pages[n - 1] === "string" ? [{ str: pages[n - 1] as string }] : (pages[n - 1] as Item[]) }) }),
    loadingTask: { destroy: async () => void destroyed.push(name) },
  }) as never;

const bytes = vi.hoisted(() => ({ pdfs: new Map<string, unknown>(), opened: [] as string[] }));
const opened = bytes.opened;
vi.mock("../pdf/load", () => ({
  openPdf: async (data: Uint8Array) => {
    const name = new TextDecoder().decode(data);
    bytes.opened.push(name);
    return bytes.pdfs.get(name);
  },
}));

beforeEach(() => {
  opened.length = 0;
  destroyed.length = 0;
  bytes.pdfs.clear();
});

describe("pages", () => {
  it("are read from a list, sorted and counted once", () => {
    expect(parsePages("3-5, 8,8 , 10")).toEqual([3, 4, 5, 8, 10]);
    expect(parsePages("2")).toEqual([2]);
    expect(parsePages("  ")).toEqual([]);
    for (const bad of ["x", "0", "5-3", "1-", "-4", "1-2-3", "1,,2", "1-100000", "99999999999"]) expect(() => parsePages(bad), bad).toThrow();
    expect(() => parsePages("5-3")).toThrow("“5-3” runs backwards");
  });

  it("are written short again", () => {
    expect(pagesLabel([1, 2, 3, 7, 9, 10])).toBe("1-3, 7, 9-10");
    expect(pagesLabel([4])).toBe("4");
    expect(pagesLabel([])).toBe("");
  });

  it("make a chip the backend reads: source, pages, highlights", () => {
    expect(pdfChip("sources/primer.pdf", "A primer", [1, 2, 3, 7], ["h1", "h7"])).toEqual({
      kind: "pdf",
      label: "A primer · pp. 1-3, 7 + 2 highlights",
      ref: ["sources/primer.pdf", "pages:1-3,7", "highlights:h1,h7"],
    });
    expect(pdfChip("sources/primer.pdf", "A primer", [4])).toEqual({ kind: "pdf", label: "A primer · p. 4", ref: ["sources/primer.pdf", "pages:4"] });
    expect(pdfChip("sources/primer.pdf", "A primer", [], "all")).toEqual({ kind: "pdf", label: "A primer · highlights", ref: ["sources/primer.pdf", "highlights:all"] });
    expect(pdfChip("sources/primer.pdf", "A primer", [2], ["h1"]).label).toBe("A primer · p. 2 + 1 highlight");
  });
});

describe("a page's text", () => {
  it("keeps the lines pdf.js ends and collapses the spaces", async () => {
    const page = doc([[{ str: "A note should", hasEOL: false }, { str: "hold  one idea.", hasEOL: true }, { str: "  " }, { str: "Second   line", hasEOL: true }, { str: "", hasEOL: true }]]);
    expect(await pageText(page, 1)).toBe("A note should hold one idea.\nSecond line");
  });
});

describe("reading pages", () => {
  it("returns each page's text under its number", async () => {
    const pdf = doc(["One.", "Two.", "Three."]);
    expect(await readPages(pdf, "sources/a.pdf", [1, 3])).toEqual([
      { source: "sources/a.pdf", page: 1, text: "One." },
      { source: "sources/a.pdf", page: 3, text: "Three." },
    ]);
  });

  it("refuses more than the most pages, and a page the PDF does not have", async () => {
    const pdf = doc(Array.from({ length: 30 }, (_, i) => `Page ${i + 1}`));
    const many = Array.from({ length: MAX_PAGES + 1 }, (_, i) => i + 1);
    await expect(readPages(pdf, "a.pdf", many)).rejects.toThrow(`Choose at most ${MAX_PAGES} pages at a time; ${MAX_PAGES + 1} were named`);
    expect(await readPages(pdf, "a.pdf", many.slice(0, MAX_PAGES))).toHaveLength(MAX_PAGES);
    await expect(readPages(doc(["One."]), "a.pdf", [2])).rejects.toThrow("This PDF has 1 page, so there is no page 2");
  });

  it("cuts the text at the most characters, across pages", async () => {
    const long = "§".repeat(MAX_CHARS / 2 + 5_000);
    const out = await readPages(doc([long, long, "LATE"]), "a.pdf", [1, 2, 3]);
    expect(out.map((e) => e.page)).toEqual([1, 2]);
    expect(out.reduce((sum, e) => sum + e.text.length, 0)).toBe(MAX_CHARS);
  });
});

describe("the pages a chat's chips name", () => {
  const encode = (name: string) => new TextEncoder().encode(name);
  const vault = () => useWorkspace.setState({ client: { readSource: async (path: string) => encode(path) } as never });

  it("opens each PDF once, reads only the pages named, and lets the PDF go", async () => {
    vault();
    bytes.pdfs.set("sources/a.pdf", doc(["A1", "A2", "A3"], "a"));
    bytes.pdfs.set("sources/b.pdf", doc(["B1", "B2"], "b"));
    const out = await excerptsOf([
      pdfChip("sources/a.pdf", "A", [1, 3]),
      pdfChip("sources/b.pdf", "B", [2]),
      pdfChip("sources/a.pdf", "A again", [2]),
      // Highlights alone need no page text; other chips are not PDFs.
      pdfChip("sources/a.pdf", "A", [], "all"),
      { kind: "note", label: "Plan", ref: ["library/plan.md"] },
    ]);
    expect(out.map((e) => `${e.source}:${e.page}:${e.text}`)).toEqual(["sources/a.pdf:1:A1", "sources/a.pdf:3:A3", "sources/b.pdf:2:B2", "sources/a.pdf:2:A2"]);
    expect(opened).toEqual(["sources/a.pdf", "sources/b.pdf"]);
    expect(destroyed.sort()).toEqual(["a", "b"]);
  });

  it("reads nothing when no chip names a page, and says when a PDF cannot be read", async () => {
    vault();
    expect(await excerptsOf([{ kind: "note", label: "Plan", ref: ["library/plan.md"] }, pdfChip("sources/a.pdf", "A", [], "all")])).toEqual([]);
    expect(opened).toEqual([]);

    bytes.pdfs.set("sources/a.pdf", doc(["A1"], "a"));
    await expect(excerptsOf([pdfChip("sources/a.pdf", "A", [5])])).rejects.toThrow("no page 5");
    // A chip with too many pages is refused, and the PDF is let go all the same.
    expect(destroyed).toEqual(["a"]);
    useWorkspace.setState({ client: null });
    await expect(excerptsOf([pdfChip("sources/a.pdf", "A", [1])])).rejects.toThrow("No vault is open");
  });
});
