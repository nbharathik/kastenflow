import { describe, expect, it } from "vitest";

import { arxivUrl, doiUrl, findIdentifiers, onlyIdentifiers } from "./identifiers";

describe("finding a DOI", () => {
  it.each([
    ["10.1000/xyz123", "10.1000/xyz123"],
    ["doi:10.1000/xyz123", "10.1000/xyz123"],
    ["DOI: 10.1038/s41586-020-2649-2.", "10.1038/s41586-020-2649-2"],
    ["https://doi.org/10.1145/3292500.3330701", "10.1145/3292500.3330701"],
    ["http://dx.doi.org/10.1109/5.771073", "10.1109/5.771073"],
    ["https://dl.acm.org/doi/10.1145/3292500.3330701?utm_source=x#abstract", "10.1145/3292500.3330701"],
    ["see (https://onlinelibrary.wiley.com/doi/full/10.1002/asi.20317), p. 4", "10.1002/asi.20317"],
  ])("takes the DOI out of %s", (text, doi) => {
    expect(findIdentifiers(text).doi).toBe(doi);
  });

  it("finds none in text that has none", () => {
    expect(findIdentifiers("Attention is all you need, 2017").doi).toBeUndefined();
    expect(findIdentifiers("10.5 percent of 1000/xyz").doi).toBeUndefined();
  });

  it("writes a DOI as an address", () => {
    expect(doiUrl("10.1000/xyz 123")).toBe("https://doi.org/10.1000/xyz%20123");
  });
});

describe("finding an arXiv identifier", () => {
  it.each([
    ["arXiv:2005.14165", "2005.14165"],
    ["arXiv:2005.14165v2 [cs.CL]", "2005.14165"],
    ["https://arxiv.org/abs/1706.03762v7", "1706.03762"],
    ["https://arxiv.org/pdf/1706.03762.pdf", "1706.03762"],
    ["http://export.arxiv.org/abs/hep-th/9901001", "hep-th/9901001"],
    ["arxiv.org/abs/2401.00001", "2401.00001"],
    ["1706.03762", "1706.03762"],
  ])("takes the identifier out of %s", (text, id) => {
    expect(findIdentifiers(text).arxiv).toBe(id);
  });

  it("does not take a date, a page range or a decimal for one", () => {
    expect(findIdentifiers("pages 1234.5678 of the report").arxiv).toBeUndefined();
    expect(findIdentifiers("Published 2017.06.12 online").arxiv).toBeUndefined();
    expect(findIdentifiers("12.50").arxiv).toBeUndefined();
  });

  it("writes one as an address", () => {
    expect(arxivUrl("1706.03762")).toBe("https://arxiv.org/abs/1706.03762");
  });
});

describe("an address", () => {
  it("is kept as the page's address", () => {
    expect(findIdentifiers("https://example.org/paper/12?id=3").url).toBe("https://example.org/paper/12?id=3");
  });

  it("is not made from a DOI or arXiv link: those have their own fields", () => {
    expect(findIdentifiers("https://doi.org/10.1000/xyz").url).toBeUndefined();
    expect(findIdentifiers("https://arxiv.org/abs/1706.03762").url).toBeUndefined();
  });
});

describe("a paste that is only an identifier", () => {
  it("is told from a citation that holds one", () => {
    expect(onlyIdentifiers("10.1000/xyz123")).toBe(true);
    expect(onlyIdentifiers("  https://doi.org/10.1000/xyz123 \n")).toBe(true);
    expect(onlyIdentifiers("arXiv:1706.03762")).toBe(true);
    expect(onlyIdentifiers("https://publisher.example/articles/42")).toBe(true);
    expect(onlyIdentifiers("Vaswani, A. (2017). Attention is all you need. doi:10.1000/xyz123")).toBe(false);
    expect(onlyIdentifiers("")).toBe(false);
  });
});
