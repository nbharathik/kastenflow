import { describe, expect, it } from "vitest";

import { formatAuthors, parseCitation } from "./plain-citation";

describe("author names", () => {
  it("writes names as BibTeX does: last name first, people joined with and", () => {
    expect(formatAuthors("A. Vaswani, N. Shazeer, and N. Parmar")).toBe("Vaswani, A. and Shazeer, N. and Parmar, N.");
    expect(formatAuthors("Vaswani, A., Shazeer, N., & Parmar, N.")).toBe("Vaswani, A. and Shazeer, N. and Parmar, N.");
    expect(formatAuthors("Devlin, Jacob, Ming-Wei Chang, and Kristina Toutanova")).toBe("Devlin, Jacob and Chang, Ming-Wei and Toutanova, Kristina");
    expect(formatAuthors("Ludwig van Beethoven and Ada Lovelace")).toBe("van Beethoven, Ludwig and Lovelace, Ada");
    expect(formatAuthors("Smith and Jones")).toBe("Smith and Jones");
  });

  it("keeps et al. as others", () => {
    expect(formatAuthors("Vaswani, A. et al.")).toBe("Vaswani, A. and others");
    expect(formatAuthors("Vaswani et al.")).toBe("Vaswani and others");
  });
});

describe("reading a plain citation", () => {
  it("reads an APA reference: authors, year in brackets, title, journal, volume and pages", () => {
    const draft = parseCitation("Vaswani, A., Shazeer, N., Parmar, N., & Polosukhin, I. (2017). Attention is all you need. Advances in Neural Information Processing Systems, 30, 5998–6008.");
    expect(draft.origin).toBe("citation");
    expect(draft.fields).toEqual({
      author: "Vaswani, A. and Shazeer, N. and Parmar, N. and Polosukhin, I.",
      year: "2017",
      title: "Attention is all you need",
      journal: "Advances in Neural Information Processing Systems",
      volume: "30",
      pages: "5998--6008",
    });
    expect(draft.type).toBe("article");
    // The year in brackets is sure; the rest is a guess the form marks.
    expect(draft.guessed).not.toContain("year");
    expect(draft.guessed).toEqual(expect.arrayContaining(["author", "title", "journal", "volume", "pages"]));
  });

  it("reads an IEEE reference with the title in quotes and a conference", () => {
    const draft = parseCitation('A. Vaswani, N. Shazeer, and N. Parmar, "Attention is all you need," in Proc. Adv. Neural Inf. Process. Syst., 2017, pp. 5998–6008.');
    expect(draft.type).toBe("inproceedings");
    expect(draft.fields).toEqual({
      author: "Vaswani, A. and Shazeer, N. and Parmar, N.",
      title: "Attention is all you need",
      booktitle: "Proc. Adv. Neural Inf. Process. Syst.",
      year: "2017",
      pages: "5998--6008",
    });
    // A title in quotes is sure.
    expect(draft.guessed).not.toContain("title");
  });

  it("reads a Harvard reference with the title in single quotes and et al.", () => {
    const draft = parseCitation("Vaswani, A. et al. (2017) 'Attention is all you need', Advances in Neural Information Processing Systems, 30, pp. 5998–6008.");
    expect(draft.fields).toMatchObject({ author: "Vaswani, A. and others", year: "2017", title: "Attention is all you need", journal: "Advances in Neural Information Processing Systems", volume: "30", pages: "5998--6008" });
  });

  it("reads a Chicago reference whose pages are shortened", () => {
    const draft = parseCitation('Devlin, Jacob, Ming-Wei Chang, and Kristina Toutanova. "BERT: Pre-training of Deep Bidirectional Transformers." In Proceedings of NAACL-HLT, 4171–86, 2019.');
    expect(draft.type).toBe("inproceedings");
    expect(draft.fields).toMatchObject({
      author: "Devlin, Jacob and Chang, Ming-Wei and Toutanova, Kristina",
      title: "BERT: Pre-training of Deep Bidirectional Transformers",
      booktitle: "Proceedings of NAACL-HLT",
      year: "2019",
      pages: "4171--4186",
    });
  });

  it("reads a short citation with the volume, number and pages of a journal", () => {
    const draft = parseCitation("Smith 2020. A study of things. Journal of Studies 12(3): 45-67.");
    expect(draft.fields).toMatchObject({ author: "Smith", year: "2020", title: "A study of things", journal: "Journal of Studies", volume: "12", number: "3", pages: "45--67" });
    expect(draft.guessed).toContain("year");
  });

  it("reads a book with a publisher", () => {
    const draft = parseCitation("Knuth, D. E. (1997). The Art of Computer Programming. Addison-Wesley Press.");
    expect(draft.type).toBe("book");
    expect(draft.fields).toMatchObject({ author: "Knuth, D. E.", year: "1997", title: "The Art of Computer Programming", publisher: "Addison-Wesley Press" });
  });

  it("takes the DOI, arXiv identifier and address out of the text and leaves them in their own fields", () => {
    const draft = parseCitation("Doe, J. (2020). A thing. Journal of Things, 4, 1-9. https://doi.org/10.1000/xyz123");
    expect(draft.fields).toMatchObject({ doi: "10.1000/xyz123", journal: "Journal of Things", volume: "4", pages: "1--9" });
    expect(draft.fields.url).toBeUndefined();
    const preprint = parseCitation("Brown, T. et al. (2020). Language models are few-shot learners. arXiv:2005.14165");
    expect(preprint.type).toBe("misc");
    expect(preprint.fields).toMatchObject({ title: "Language models are few-shot learners", eprint: "2005.14165", archiveprefix: "arXiv" });
  });

  it("keeps the whole text as the title when it cannot tell anything apart, and says so", () => {
    const draft = parseCitation("something I read last week");
    expect(draft.fields.title).toBe("something I read last week");
    expect(draft.guessed).toContain("title");
    expect(draft.note).toMatch(/could not tell/i);
  });

  it("makes no field up for what the text lacks", () => {
    const draft = parseCitation("Doe, J. (2020). Only a title.");
    expect(Object.keys(draft.fields).sort()).toEqual(["author", "title", "year"]);
  });
});
