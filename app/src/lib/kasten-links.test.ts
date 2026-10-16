import { describe, expect, it } from "vitest";

import { boardLink, deckLink, formatKastenLink, isKastenLink, noteLink, parseKastenLink, pdfLink, type KastenLink } from "./kasten-links";

const ID = "01J8Z3K6Q2M4X7V9B1C5D8E0F2";

describe("building addresses", () => {
  it("names a note by its id, with a heading or the nth heading of a title", () => {
    expect(noteLink(ID)).toBe(`kasten:note/${ID}`);
    expect(noteLink(ID, "Next steps")).toBe(`kasten:note/${ID}#Next%20steps`);
    expect(noteLink(ID, "Next steps", 1)).toBe(`kasten:note/${ID}#Next%20steps`);
    expect(noteLink(ID, "Next steps", 2)).toBe(`kasten:note/${ID}?section=Next%20steps&n=2`);
  });

  it("leaves no space, bracket or parenthesis bare, so a Markdown link keeps working", () => {
    const link = noteLink(ID, "Costs (2026) [draft] & more *!'");
    expect(link).not.toMatch(/[\s()[\]*!']/);
    expect(parseKastenLink(link)).toEqual({ kind: "note", id: ID, heading: "Costs (2026) [draft] & more *!'" });
  });

  it("names a PDF page and highlight, a board and a node, a deck and a slide", () => {
    expect(pdfLink("sources/my paper.pdf", 12, "h1")).toBe("kasten:pdf/sources/my%20paper.pdf?page=12&highlight=h1");
    expect(pdfLink("sources/a.pdf", 0)).toBe("kasten:pdf/sources/a.pdf?page=1");
    expect(boardLink("projects/trip/boards/map.canvas")).toBe("kasten:board/projects/trip/boards/map.canvas");
    expect(boardLink("projects/trip/boards/map.canvas", "n-1")).toBe("kasten:board/projects/trip/boards/map.canvas?node=n-1");
    expect(deckLink("library/talk.deck", "s1")).toBe("kasten:deck/library/talk.deck?slide=s1");
    expect(deckLink("01J8Z3K6Q2")).toBe("kasten:deck/01J8Z3K6Q2");
  });
});

describe("reading addresses", () => {
  it("reads every kind back as built", () => {
    const links: KastenLink[] = [
      { kind: "note", id: ID },
      { kind: "note", id: ID, heading: "Risks & mitigations" },
      { kind: "note", id: ID, heading: "Notes", nth: 3 },
      { kind: "pdf", path: "sources/a b.pdf", page: 12, highlight: "abc-1" },
      { kind: "pdf", path: "sources/a.pdf", page: 1 },
      { kind: "board", path: "boards/m.canvas", node: "node_9" },
      { kind: "board", path: "projects/p/boards/m.canvas" },
      { kind: "deck", ref: "library/talk.deck", slide: "s1" },
      { kind: "deck", ref: ID },
    ];
    for (const link of links) expect(parseKastenLink(formatKastenLink(link)), formatKastenLink(link)).toEqual(link);
  });

  it("is not case-sensitive in its scheme and kind, and ignores padding", () => {
    expect(parseKastenLink(`  KASTEN:Note/${ID}#Top `)).toEqual({ kind: "note", id: ID, heading: "Top" });
  });

  it("reads a page's default and a plain query", () => {
    expect(parseKastenLink("kasten:pdf/sources/a.pdf")).toEqual({ kind: "pdf", path: "sources/a.pdf", page: 1 });
    expect(parseKastenLink(`kasten:note/${ID}?section=Intro`)).toEqual({ kind: "note", id: ID, heading: "Intro" });
    // An unknown parameter is ignored; the first of a repeated one is used.
    expect(parseKastenLink("kasten:pdf/a.pdf?page=2&page=3&zoom=9")).toEqual({ kind: "pdf", path: "a.pdf", page: 2 });
  });

  it("refuses what it cannot open", () => {
    for (const bad of [
      "",
      "kasten:",
      "kasten:settings/ai",
      "kasten:note/",
      "kasten:note/has space",
      `kasten:note/${"x".repeat(65)}`,
      `kasten:note/${ID}?section=&n=1`,
      `kasten:note/${ID}?section=A&n=0`,
      `kasten:note/${ID}?section=A&n=x`,
      `kasten:note/${ID}#%E0%A4%A`,
      "kasten:pdf/a.pdf?page=0",
      "kasten:pdf/a.pdf?page=1.5",
      "kasten:pdf/a.pdf?page=100001",
      "kasten:pdf/a.txt",
      "kasten:pdf/../secret.pdf",
      "kasten:pdf//etc/passwd.pdf",
      "kasten:pdf/a/./b.pdf",
      "kasten:pdf/a%5Cb.pdf",
      "kasten:pdf/a%2F..%2Fb.pdf",
      "kasten:board/x.md",
      "kasten:board/%00.canvas",
      "kasten:deck/a b",
      "kasten:deck/../x.deck",
      "kasten:note/%E0%A4%A",
      "kasten:folder/anything",
      "https://example.com",
    ]) {
      expect(parseKastenLink(bad), bad).toBeNull();
    }
  });

  it("drops an id parameter that is not an id rather than trusting it", () => {
    expect(parseKastenLink("kasten:board/b.canvas?node=a%20b")).toEqual({ kind: "board", path: "b.canvas" });
    expect(parseKastenLink("kasten:deck/d.deck?slide=%3Cx%3E")).toEqual({ kind: "deck", ref: "d.deck" });
  });

  it("knows its own addresses from the settings ones", () => {
    expect(isKastenLink(`kasten:note/${ID}`)).toBe(true);
    expect(isKastenLink(" kasten:deck/x ")).toBe(true);
    expect(isKastenLink("kasten:settings/ai")).toBe(false);
    expect(isKastenLink("https://kasten:note/x")).toBe(false);
  });
});
