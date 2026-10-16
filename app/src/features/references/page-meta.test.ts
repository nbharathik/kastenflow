import { describe, expect, it } from "vitest";

import { draftFromPage, readPageMeta, type PageMeta } from "./page-meta";

const page = (tags: [string, string][], extra: Partial<PageMeta> = {}): PageMeta => ({ url: "https://journal.example/articles/42", title: "Page title | Journal", tags, ld: [], ...extra });

describe("reading what the page sent", () => {
  it("takes the tags and JSON-LD of the page's answer and nothing else", () => {
    const meta = readPageMeta(JSON.stringify({ meta: [["citation_title", "T"], ["", "empty name"], ["x", 5], "bad"], ld: ['{"@type":"Article"}', 7], extra: "ignored" }), "https://a.example/", "Title");
    expect(meta.tags).toEqual([["citation_title", "T"]]);
    expect(meta.ld).toEqual(['{"@type":"Article"}']);
    expect(meta.url).toBe("https://a.example/");
  });

  it("is empty for an answer that is not what was asked for", () => {
    expect(readPageMeta("not json", "https://a.example/", "T").tags).toEqual([]);
    expect(readPageMeta("[1,2]", "https://a.example/", "T").tags).toEqual([]);
    expect(readPageMeta("", "https://a.example/", "T").ld).toEqual([]);
  });
});

describe("a paper from the tags of a journal page", () => {
  const tags: [string, string][] = [
    ["citation_title", "Attention is all you need"],
    ["citation_author", "Vaswani, Ashish"],
    ["citation_author", "Noam Shazeer"],
    ["citation_publication_date", "2017/06/12"],
    ["citation_journal_title", "Journal of Attention"],
    ["citation_volume", "30"],
    ["citation_issue", "4"],
    ["citation_firstpage", "5998"],
    ["citation_lastpage", "6008"],
    ["citation_doi", "10.1000/attn.2017"],
    ["citation_publisher", "Example Press"],
  ];

  it("reads title, authors, year, journal, volume, number, pages, DOI and publisher", () => {
    const draft = draftFromPage(page(tags));
    expect(draft.origin).toBe("page");
    expect(draft.type).toBe("article");
    expect(draft.fields).toEqual({
      title: "Attention is all you need",
      author: "Vaswani, Ashish and Shazeer, Noam",
      year: "2017",
      journal: "Journal of Attention",
      volume: "30",
      number: "4",
      pages: "5998--6008",
      doi: "10.1000/attn.2017",
      publisher: "Example Press",
      url: "https://journal.example/articles/42",
    });
    // Tags that say what they mean are not guesses.
    expect(draft.guessed).toEqual([]);
  });

  it("calls it a conference paper when the page names a conference", () => {
    const draft = draftFromPage(page([["citation_title", "T"], ["citation_conference_title", "NeurIPS 2017"], ["citation_author", "Doe, J."]]));
    expect(draft.type).toBe("inproceedings");
    expect(draft.fields.booktitle).toBe("NeurIPS 2017");
    expect(draft.fields.journal).toBeUndefined();
  });

  it("reads a thesis and a technical report", () => {
    expect(draftFromPage(page([["citation_title", "T"], ["citation_dissertation_institution", "State University"]])).fields.school).toBe("State University");
    expect(draftFromPage(page([["citation_title", "T"], ["citation_technical_report_institution", "Lab"]])).type).toBe("techreport");
  });

  it("reads an arXiv page's identifier and strips a version", () => {
    const draft = draftFromPage(page([["citation_title", "T"], ["citation_arxiv_id", "1706.03762v7"]], { url: "https://arxiv.org/abs/1706.03762v7" }));
    expect(draft.fields).toMatchObject({ eprint: "1706.03762", archiveprefix: "arXiv" });
  });
});

describe("a paper from other tags", () => {
  it("reads Dublin Core and PRISM tags", () => {
    const draft = draftFromPage(
      page([
        ["DC.title", "A thing"],
        ["DC.creator", "Doe, Jane"],
        ["DC.date", "2019-03-01"],
        ["DC.identifier", "doi:10.2000/abc"],
        ["prism.publicationName", "Things Quarterly"],
      ]),
    );
    expect(draft.fields).toMatchObject({ title: "A thing", author: "Doe, Jane", year: "2019", doi: "10.2000/abc", journal: "Things Quarterly" });
  });

  it("reads JSON-LD for a scholarly article, from a graph or an array", () => {
    const ld = JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "WebSite", name: "Site" },
        {
          "@type": "ScholarlyArticle",
          headline: "Deep things",
          author: [{ "@type": "Person", name: "Ada Lovelace" }, { "@type": "Person", givenName: "Alan", familyName: "Turing" }],
          datePublished: "2021-04-02",
          isPartOf: { "@type": "Periodical", name: "Journal of Machines" },
          publisher: { "@type": "Organization", name: "Machine Press" },
          identifier: [{ "@type": "PropertyValue", propertyID: "doi", value: "10.3000/deep" }],
          abstract: "<p>It <b>works</b> &amp; more.</p>",
        },
      ],
    });
    const draft = draftFromPage(page([], { ld: [ld] }));
    expect(draft.type).toBe("article");
    expect(draft.fields).toMatchObject({ title: "Deep things", author: "Lovelace, Ada and Turing, Alan", year: "2021", journal: "Journal of Machines", publisher: "Machine Press", doi: "10.3000/deep", abstract: "It works & more." });
  });

  it("falls back to the page, marking what it could only guess, when there are no scholarly tags", () => {
    const draft = draftFromPage(page([["og:title", "A blog post"], ["author", "Pat Writer"], ["article:published_time", "2022-08-01T10:00:00Z"]]));
    expect(draft.type).toBe("misc");
    expect(draft.fields).toMatchObject({ title: "A blog post", author: "Writer, Pat", year: "2022", url: "https://journal.example/articles/42" });
    expect(draft.guessed).toEqual(expect.arrayContaining(["title", "author", "year"]));
    expect(draft.note).toMatch(/no scholarly tags/i);
  });

  it("uses the page title when it has no tags at all, and names no author or year it was not told", () => {
    const draft = draftFromPage(page([]));
    expect(draft.fields).toEqual({ title: "Page title | Journal", url: "https://journal.example/articles/42" });
    expect(draft.guessed).toContain("title");
  });
});

describe("what a page says is data", () => {
  it("is stripped of markup and control characters, cut to a size, and never run", () => {
    const long = "x".repeat(10_000);
    const draft = draftFromPage(page([["citation_title", "<script>alert(1)</script>Real\u0000 title\n  here"], ["citation_author", "Doe, Jane"], ["citation_abstract", long], ["citation_doi", "javascript:alert(1)"]]));
    expect(draft.fields.title).toBe("alert(1)Real title here");
    expect((draft.fields.abstract ?? "").length).toBeLessThanOrEqual(4000);
    // A "DOI" that is not one is not kept.
    expect(draft.fields.doi).toBeUndefined();
  });

  it("keeps an address only if it is a web address", () => {
    expect(draftFromPage(page([["citation_title", "T"]], { url: "javascript:alert(1)" })).fields.url).toBeUndefined();
    expect(draftFromPage(page([["citation_title", "T"]], { url: "https://ok.example/p" })).fields.url).toBe("https://ok.example/p");
  });

  it("reads at most so many authors", () => {
    const tags: [string, string][] = Array.from({ length: 300 }, (_, i) => ["citation_author", `Person${i}, A.`]);
    const authors = draftFromPage(page([["citation_title", "T"], ...tags])).fields.author!.split(" and ");
    expect(authors.length).toBeLessThanOrEqual(101);
    expect(authors.at(-1)).toBe("others");
  });
});
