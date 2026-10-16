import { describe, expect, it } from "vitest";

import type { BibEntry } from "../../../lib/vault/reference-types";
import type { Highlight, SourceInfo } from "../../../lib/vault/source-types";
import { buildRows } from "../../references/rows";
import { MANAGED_BIB } from "../../../lib/vault/reference-types";
import { papersFrom } from "./papers";

const entry = (key: string, fields: Record<string, string>): BibEntry => ({ key, type: "article", fields });
const bib = (managed: BibEntry[], external: BibEntry[] = []) => ({
  managed: { path: MANAGED_BIB, managed: true, exists: true, hash: "h", bytes: 0, problem: null, entries: managed },
  external: external.length ? [{ path: "z.bib", managed: false, exists: true, hash: "h", bytes: 0, problem: null, entries: external }] : [],
  duplicates: [],
});
const source = (path: string, title: string): SourceInfo => ({ path, title, highlights: 0, bytes: 1, modified: 0 });
const highlight = (id: string, page: number): Highlight => ({ id, page, rects: [], text: `quote ${id}`, color: "yellow", comment: null, cardId: null, created: null, card: null });

describe("the papers a comparison can be made of", () => {
  const rows = buildRows(
    bib([entry("vaswani2017attention", { author: "Vaswani, A. and Shazeer, N. and Parmar, N.", title: "Attention is all you need", year: "2017", file: "sources/attention.pdf" }), entry("nopdf", { author: "Doe, J.", title: "No file", year: "2020" })], [entry("vaswani2017attention", { title: "Repeat" })]),
    ["sources/attention.pdf", "sources/primer.pdf"],
  );
  const papers = papersFrom(rows, [source("sources/attention.pdf", "attention"), source("sources/primer.pdf", "A primer")], { "sources/attention.pdf": [highlight("a", 1), highlight("b", 4)], "sources/primer.pdf": [highlight("c", 2)] });

  it("are the references, each once, then the PDFs that no reference goes with", () => {
    expect(papers.map((p) => [p.id, p.key, p.label])).toEqual([
      ["vaswani2017attention", "vaswani2017attention", "Vaswani et al., 2017"],
      ["nopdf", "nopdf", "Doe, 2020"],
      ["pdf:sources/primer.pdf", null, "A primer"],
    ]);
  });

  it("carry the PDF and the highlights of the PDF, if they have one", () => {
    expect(papers[0]).toMatchObject({ source: "sources/attention.pdf", title: "Attention is all you need" });
    expect(papers[0]!.highlights.map((h) => h.id)).toEqual(["a", "b"]);
    expect(papers[1]).toMatchObject({ source: null, highlights: [] });
    expect(papers[2]).toMatchObject({ source: "sources/primer.pdf", title: "A primer" });
    expect(papers[2]!.highlights.map((h) => h.id)).toEqual(["c"]);
  });
});
