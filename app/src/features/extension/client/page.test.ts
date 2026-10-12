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
});
