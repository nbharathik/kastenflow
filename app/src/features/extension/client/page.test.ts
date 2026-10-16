// What the extension reads from the page in the tab: the selection and the page
// without its scripts, styles and the like; the page itself is left as it was.

import { afterEach, describe, expect, it } from "vitest";

import { readPage } from "../../../../../browser-extension/src/page";

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = "";
  document.title = "";
});

function page(): HTMLElement {
  document.title = "A guide";
  document.body.innerHTML = '<nav>Menu</nav><article><h1>Heading</h1><p id="p">Selected <b>words</b> here</p></article><script>x()</script><style>a{}</style><svg><circle/></svg><iframe src="about:blank"></iframe>';
  return document.getElementById("p")!;
}

describe("reading the page", () => {
  it("gives the selection as markup and as text", () => {
    const paragraph = page();
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    window.getSelection()!.addRange(range);
    const read = readPage();
    expect(read.selectionText).toBe("Selected words here");
    expect(read.selectionHtml).toBe("Selected <b>words</b> here");
    expect(read.title).toBe("A guide");
  });

  it("has an empty selection when nothing is selected", () => {
    page();
    const read = readPage();
    expect([read.selectionHtml, read.selectionText]).toEqual(["", ""]);
  });

  it("gives the page without scripts, styles, frames and drawings, and leaves the page itself alone", () => {
    page();
    const read = readPage();
    expect(read.html).toContain("<article>");
    expect(read.html).toContain("Selected <b>words</b> here");
    for (const gone of ["<script", "<style", "<svg", "<iframe", "x()"]) expect(read.html, gone).not.toContain(gone);
    expect(read.text).toContain("Heading");
    expect(document.querySelector("script")).not.toBeNull();
    expect(document.querySelector("style")).not.toBeNull();
  });

  it("gives the tags the page describes itself by, for Save as paper", () => {
    document.head.innerHTML = '<meta name="Citation_Title" content="Attention is all you need"><meta property="og:title" content="Og title"><meta name="empty" content=""><meta charset="utf-8"><script type="application/ld+json">{"@type":"ScholarlyArticle"}</script>';
    page();
    const read = readPage();
    expect(read.paper).toEqual({ meta: [["citation_title", "Attention is all you need"], ["og:title", "Og title"]], ld: ['{"@type":"ScholarlyArticle"}'] });
    // The page's markup still leaves its tags out, and the page itself keeps them.
    expect(read.html).not.toContain("citation_title");
    expect(document.querySelector("meta[name=Citation_Title]")).not.toBeNull();
    document.head.innerHTML = "";
  });

  it("keeps to a size: at most 400 tags of 6000 characters, 10 scripts of 100000", () => {
    const tags = Array.from({ length: 450 }, (_, i) => `<meta name="n${i}" content="${"x".repeat(7000)}">`).join("");
    const scripts = Array.from({ length: 12 }, () => '<script type="application/ld+json">{}</script>').join("") + `<script type="application/ld+json">${" ".repeat(100_001)}</script>`;
    document.head.innerHTML = tags + scripts;
    page();
    const paper = readPage().paper!;
    expect(paper.meta).toHaveLength(400);
    expect(paper.meta[0]![1]).toHaveLength(6000);
    expect(paper.ld).toHaveLength(10);
    document.head.innerHTML = "";
  });

  it("has no tags to give for a page that has none", () => {
    page();
    expect(readPage().paper).toEqual({ meta: [], ld: [] });
  });
});
