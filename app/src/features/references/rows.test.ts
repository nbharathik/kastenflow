import { describe, expect, it } from "vitest";

import { MANAGED_BIB, type BibEntry, type BibFile, type Bibliography } from "../../lib/vault/reference-types";
import { buildRows, filterRows, pdfFor, sortRows } from "./rows";

const file = (path: string, entries: BibEntry[], managed = false): BibFile => ({ path, managed, exists: true, hash: `h-${path}`, bytes: 0, problem: null, entries });
const entry = (key: string, fields: Record<string, string>, type = "article"): BibEntry => ({ key, type, fields });

const VASWANI = entry("vaswani2017attention", { author: "Vaswani, Ashish and Shazeer, Noam and Parmar, Niki", title: "Attention is all you need", year: "2017", journal: "NeurIPS", doi: "10.5555/3295222.3295349", file: "sources/attention.pdf" });
const DEVLIN = entry("devlin2019bert", { author: "Devlin, Jacob and Chang, Ming-Wei", title: "{BERT}: Pre-training of deep bidirectional transformers", year: "2019", journal: "NAACL", eprint: "1810.04805", archiveprefix: "arXiv" });
const THIN = entry("thin", { title: "Only a title" }, "misc");
const EXTERNAL = entry("lecun2015deep", { author: "LeCun, Yann", title: "Deep learning", year: "2015", journal: "Nature", url: "https://example.org/deep" });

const bib = (): Bibliography => ({
  managed: file(MANAGED_BIB, [VASWANI, DEVLIN, THIN], true),
  external: [file("zotero/library.bib", [EXTERNAL, entry("vaswani2017attention", { title: "Attention is all you need", year: "2017" })])],
  duplicates: [{ by: "key", value: "vaswani2017attention", entries: [{ file: MANAGED_BIB, key: "vaswani2017attention" }, { file: "zotero/library.bib", key: "vaswani2017attention" }] }],
});

describe("the table's rows", () => {
  const rows = buildRows(bib(), ["sources/attention.pdf", "sources/other.pdf"]);

  it("lists the managed file's entries first and then the external files', each once", () => {
    expect(rows.map((r) => [r.key, r.managed])).toEqual([
      ["vaswani2017attention", true],
      ["devlin2019bert", true],
      ["thin", true],
      ["lecun2015deep", false],
      ["vaswani2017attention", false],
    ]);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });

  it("shows authors as people say them, the year, the plain title and the link that opens it", () => {
    const [first, second, third, fourth] = rows;
    expect(first).toMatchObject({ authors: "Vaswani et al.", year: "2017", title: "Attention is all you need" });
    expect(first!.link).toEqual({ href: "https://doi.org/10.5555/3295222.3295349", text: "doi:10.5555/3295222.3295349" });
    expect(second).toMatchObject({ authors: "Devlin and Chang", title: "BERT: Pre-training of deep bidirectional transformers" });
    expect(second!.link).toEqual({ href: "https://arxiv.org/abs/1810.04805", text: "arXiv:1810.04805" });
    expect(third).toMatchObject({ authors: "", year: "" });
    expect(third!.link).toBeNull();
    expect(fourth!.link).toEqual({ href: "https://example.org/deep", text: "example.org/deep" });
  });

  it("marks what an entry lacks and never invents it", () => {
    expect(rows[0]!.missing).toEqual([]);
    expect(rows[2]!.missing).toEqual(["author", "year"]);
  });

  it("marks entries the bibliography repeats, and finds the PDF that goes with one", () => {
    expect(rows.filter((r) => r.duplicate).map((r) => r.id)).toEqual([rows[0]!.id, rows[4]!.id]);
    expect(rows[0]!.pdf).toBe("sources/attention.pdf");
    expect(rows[1]!.pdf).toBeNull();
  });
});

describe("a PDF that goes with a reference", () => {
  const pdfs = ["sources/attention.pdf", "sources/Devlin2019BERT.pdf", "sources/papers/x.pdf"];
  it("is the file named in the entry, in BibTeX or Zotero form", () => {
    expect(pdfFor(entry("a", { file: "sources/attention.pdf" }), pdfs)).toBe("sources/attention.pdf");
    expect(pdfFor(entry("a", { file: "Full Text:sources/papers/x.pdf:application/pdf" }), pdfs)).toBe("sources/papers/x.pdf");
    expect(pdfFor(entry("a", { file: "notes.txt;x.pdf" }), pdfs)).toBe("sources/papers/x.pdf");
  });

  it("is the PDF named like the key when the entry names none", () => {
    expect(pdfFor(entry("devlin2019bert", {}), pdfs)).toBe("sources/Devlin2019BERT.pdf");
    expect(pdfFor(entry("nothing", {}), pdfs)).toBeNull();
  });
});

describe("an auto-export of Zotero's Better BibTeX in the vault", () => {
  // The fields it writes: a date and a journal title (BibLaTeX), a key of its own style and a file outside the vault.
  const exported = entry("vaswani_attention_2017", {
    title: "Attention is all you need",
    author: "Vaswani, Ashish and Shazeer, Noam and Parmar, Niki",
    date: "2017-06-12",
    journaltitle: "Advances in Neural Information Processing Systems",
    file: "Full Text PDF:C\\:\\\\Users\\\\me\\\\Zotero\\\\storage\\\\ABC\\\\Vaswani et al. - 2017.pdf:application/pdf",
    keywords: "transformers, attention",
  });
  const rows = buildRows({ managed: { ...file(MANAGED_BIB, [], true), exists: false }, external: [file("exports/Zotero Library.bib", [exported])], duplicates: [] }, ["sources/attention.pdf"]);

  it("is an external source, complete by its date and journal title, read only", () => {
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: "vaswani_attention_2017", managed: false, authors: "Vaswani et al.", year: "2017", missing: [], pdf: null });
  });
});

describe("filters, search and order", () => {
  const rows = buildRows(bib(), []);
  const keys = (list: typeof rows) => list.map((r) => `${r.managed ? "m" : "x"}:${r.key}`);

  it("keeps managed, external, incomplete or repeated entries", () => {
    expect(keys(filterRows(rows, { filter: "managed", query: "" }))).toEqual(["m:vaswani2017attention", "m:devlin2019bert", "m:thin"]);
    expect(keys(filterRows(rows, { filter: "external", query: "" }))).toEqual(["x:lecun2015deep", "x:vaswani2017attention"]);
    expect(keys(filterRows(rows, { filter: "incomplete", query: "" }))).toEqual(["m:thin", "x:vaswani2017attention"]);
    expect(keys(filterRows(rows, { filter: "duplicate", query: "" }))).toEqual(["m:vaswani2017attention", "x:vaswani2017attention"]);
  });

  it("finds words in the key, authors, year, title, venue and DOI, whatever the case", () => {
    expect(keys(filterRows(rows, { filter: "all", query: "SHAZEER" }))).toEqual(["m:vaswani2017attention"]);
    expect(keys(filterRows(rows, { filter: "all", query: "bert 2019" }))).toEqual(["m:devlin2019bert"]);
    expect(keys(filterRows(rows, { filter: "all", query: "nature" }))).toEqual(["x:lecun2015deep"]);
    expect(keys(filterRows(rows, { filter: "all", query: "10.5555" }))).toEqual(["m:vaswani2017attention"]);
    expect(filterRows(rows, { filter: "all", query: "zzz" })).toEqual([]);
  });

  it("sorts by key, authors, year or title, either way, with the entries that lack it last", () => {
    expect(keys(sortRows(rows, "year", "asc"))).toEqual(["x:lecun2015deep", "m:vaswani2017attention", "x:vaswani2017attention", "m:devlin2019bert", "m:thin"]);
    expect(keys(sortRows(rows, "year", "desc"))).toEqual(["m:devlin2019bert", "m:vaswani2017attention", "x:vaswani2017attention", "x:lecun2015deep", "m:thin"]);
    expect(sortRows(rows, "key", "asc").map((r) => r.key)).toEqual(["devlin2019bert", "lecun2015deep", "thin", "vaswani2017attention", "vaswani2017attention"]);
    expect(sortRows(rows, "title", "asc")[0]!.key).toBe("vaswani2017attention");
  });
});
