import { describe, expect, it } from "vitest";

import { NOT_FETCHED, parsePaperInput } from "./parse-input";

describe("what a paste is taken for", () => {
  it("reads BibTeX into one draft for each entry, with the key as written", () => {
    const parsed = parsePaperInput("@article{a2020, title={A}, year={2020}}\n@book{b2001, title={B}, author={Doe, J.}}");
    expect(parsed.kind).toBe("bibtex");
    expect(parsed.drafts.map((d) => [d.type, d.key, d.origin])).toEqual([
      ["article", "a2020", "bibtex"],
      ["book", "b2001", "bibtex"],
    ]);
    expect(parsed.drafts[0]!.fields).toEqual({ title: "A", year: "2020" });
    expect(parsed.drafts[0]!.guessed).toEqual([]);
  });

  it("says what could not be read of BibTeX, and still offers what could", () => {
    const parsed = parsePaperInput("@article{cut, title = {Half");
    expect(parsed.drafts).toHaveLength(1);
    expect(parsed.drafts[0]!.note).toMatch(/not closed/);
  });

  it("fills only the identifier fields for a DOI, an arXiv identifier or an address, and says nothing is fetched", () => {
    const doi = parsePaperInput("https://doi.org/10.1000/xyz123");
    expect(doi.kind).toBe("identifier");
    expect(doi.drafts[0]!.fields).toEqual({ doi: "10.1000/xyz123" });
    expect(doi.drafts[0]!.note).toBe(NOT_FETCHED);

    const arxiv = parsePaperInput("arXiv:1706.03762v7");
    expect(arxiv.drafts[0]!.type).toBe("misc");
    expect(arxiv.drafts[0]!.fields).toEqual({ eprint: "1706.03762", archiveprefix: "arXiv" });

    const page = parsePaperInput("https://publisher.example/articles/42");
    expect(page.drafts[0]!.fields).toEqual({ url: "https://publisher.example/articles/42" });
  });

  it("reads anything else as a plain citation", () => {
    const parsed = parsePaperInput("Doe, J. (2020). A thing. Journal of Things, 4, 1-9.");
    expect(parsed.kind).toBe("citation");
    expect(parsed.drafts[0]!.fields).toMatchObject({ author: "Doe, J.", year: "2020", title: "A thing" });
  });

  it("offers nothing for an empty paste", () => {
    expect(parsePaperInput("  \n ")).toEqual({ kind: "empty", drafts: [] });
  });
});

describe("the words to tell the person", () => {
  it("says details are not fetched and how to fill them in", () => {
    expect(NOT_FETCHED).toBe("Details are not fetched; fill them in or paste BibTeX.");
  });
});
