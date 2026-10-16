import { describe, expect, it } from "vitest";

import { draftFromPdf, readPdfFacts, type PdfFacts } from "./pdf-metadata";

const facts = (over: Partial<PdfFacts> = {}): PdfFacts => ({ info: {}, text: "", ...over });

describe("a paper from what a PDF says about itself", () => {
  it("takes the title and authors of the information dictionary, the DOI of the first page and links the PDF", () => {
    const draft = draftFromPdf(
      "sources/attention.pdf",
      "attention",
      facts({ info: { Title: "Attention is all you need", Author: "Ashish Vaswani; Noam Shazeer" }, text: "Published in NeurIPS. https://doi.org/10.5555/3295222.3295349 ..." }),
    );
    expect(draft.origin).toBe("pdf");
    expect(draft.fields).toEqual({ title: "Attention is all you need", author: "Vaswani, Ashish and Shazeer, Noam", doi: "10.5555/3295222.3295349", file: "sources/attention.pdf" });
    expect(draft.guessed).toEqual(["author"]);
    expect(draft.note).toMatch(/Read from the PDF itself/);
  });

  it("takes an arXiv identifier from the stamp on the first page, and the year its number carries, as a guess", () => {
    const draft = draftFromPdf("sources/x.pdf", "x", facts({ text: "arXiv:1706.03762v7 [cs.CL] 6 Dec 2017\nAttention Is All You Need" }));
    expect(draft.type).toBe("misc");
    expect(draft.fields).toMatchObject({ eprint: "1706.03762", archiveprefix: "arXiv", year: "2017", file: "sources/x.pdf" });
    expect(draft.guessed).toContain("year");
  });

  it("leaves out a title or author that is only what a tool left behind", () => {
    for (const title of ["", "Microsoft Word - draft.docx", "Untitled", "paper.pdf", "ab"]) {
      expect(draftFromPdf("sources/p.pdf", "My paper", facts({ info: { Title: title } })).fields.title, title).toBe("My paper");
    }
    expect(draftFromPdf("sources/p.pdf", "p", facts({ info: { Author: "Administrator" } })).fields.author).toBeUndefined();
  });

  it("falls back to the PDF's own name as the title, marked as a guess, and says nothing was found", () => {
    const draft = draftFromPdf("sources/primer.pdf", "A primer", facts());
    expect(draft.fields).toEqual({ title: "A primer", file: "sources/primer.pdf" });
    expect(draft.guessed).toEqual(["title"]);
    expect(draft.note).toMatch(/Nothing in this PDF names its paper/);
  });

  it("does not take a DOI from far down a long page", () => {
    const draft = draftFromPdf("sources/p.pdf", "p", facts({ text: `${"word ".repeat(4000)} 10.1000/late` }));
    expect(draft.fields.doi).toBeUndefined();
  });
});

describe("reading a PDF", () => {
  const doc = (info: Record<string, unknown>, lines: string[]) =>
    ({
      getMetadata: async () => ({ info }),
      getPage: async () => ({ getTextContent: async () => ({ items: lines.map((str) => ({ str, hasEOL: true })) }) }),
      numPages: 3,
    }) as never;

  it("gives its information dictionary and the text of its first page", async () => {
    const read = await readPdfFacts(doc({ Title: "T", Author: "A", Producer: "tool", Trapped: 5 }, ["First line", "arXiv:1706.03762"]));
    expect(read.info).toEqual({ Title: "T", Author: "A", Producer: "tool" });
    expect(read.text).toBe("First line\narXiv:1706.03762");
  });

  it("gives what it could, when the information or the page cannot be read", async () => {
    const broken = { getMetadata: async () => Promise.reject(new Error("bad")), getPage: async () => Promise.reject(new Error("bad")), numPages: 1 } as never;
    expect(await readPdfFacts(broken)).toEqual({ info: {}, text: "" });
  });
});
