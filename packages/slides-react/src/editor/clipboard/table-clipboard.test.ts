// Cells on the clipboard: Excel's and Google Sheets' own text and HTML, and the copy that carries the cells' own words and looks.

import type { Text } from "@kasten-slides/wasm";
import { describe, expect, it } from "vitest";

import { EMPTY } from "./format.ts";
import { cellsFromContents, detectDelimiter, htmlOfCells, parseDelimited, rowsOfHtml, rowsOfText, rowsOfTexts, textsOfHtml, textsOfRows, tsvOfRows, writeCells } from "./table.ts";

const words = (lines: string[], extra: object = {}): Text => ({ paragraphs: lines.map((line) => ({ runs: [{ t: line, ...extra }] })) });

describe("text from a spreadsheet", () => {
  it("reads Excel's tab separated text, where a cell with a line break, a tab or a quote is quoted", () => {
    const sheet = '"line one\nline two"\tb\r\nc\t"say ""hi"""\r\n"has\ttab"\t\r\n';
    expect(parseDelimited(sheet, "\t")).toEqual([
      ["line one\nline two", "b"],
      ["c", 'say "hi"'],
      ["has\ttab", ""],
    ]);
  });

  it("reads plain rows, with empty cells in the middle, whichever line ends they have", () => {
    expect(parseDelimited("a\t\tc\nd\te\tf", "\t")).toEqual([
      ["a", "", "c"],
      ["d", "e", "f"],
    ]);
    expect(parseDelimited("a\tb\r\nc\td\r\n", "\t")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(parseDelimited("a\tb\rc\td", "\t")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("keeps a quote that is in the middle of a word, and the empty quoted cell", () => {
    expect(parseDelimited('5" pipe\t""\tx"y', "\t")).toEqual([['5" pipe', "", 'x"y']]);
  });

  it("makes one row of one cell of a single word, and nothing of nothing", () => {
    expect(rowsOfText("Hello")).toEqual([["Hello"]]);
    expect(rowsOfText("")).toEqual([]);
  });

  it("reads comma separated text when every line has the same number of cells", () => {
    expect(detectDelimiter("a,b,c\n1,2,3\n")).toBe(",");
    expect(rowsOfText('name,note\nAda,"likes, commas"\n')).toEqual([
      ["name", "note"],
      ["Ada", "likes, commas"],
    ]);
  });

  it("does not cut a sentence at its commas", () => {
    expect(detectDelimiter("Hello, world")).toBeNull();
    expect(rowsOfText("Hello, world")).toEqual([["Hello, world"]]);
    // Two lines of prose do not have the same number of commas.
    expect(detectDelimiter("First, second, third\nand then, nothing")).toBeNull();
  });

  it("takes lines with no tabs as one cell to a line", () => {
    expect(rowsOfText("a\nb\nc")).toEqual([["a"], ["b"], ["c"]]);
  });

  it("takes a tab as the sign of a spreadsheet, though a comma is there too", () => {
    expect(detectDelimiter("a,b\tc")).toBe("\t");
  });

  it("writes tab separated text that reads back the same, quoting what needs it", () => {
    const rows = [
      ["plain", "two\nlines"],
      ['say "hi"', "a\tb"],
      ["", " spaced "],
    ];
    expect(parseDelimited(tsvOfRows(rows), "\t")).toEqual(rows);
    expect(tsvOfRows([["a", "b"]])).toBe("a\tb");
    expect(tsvOfRows([["x\ny"]])).toBe('"x\ny"');
  });
});

describe("HTML from a spreadsheet or a page", () => {
  const sheets = `<meta charset='utf-8'><google-sheets-html-origin><style type="text/css"><!--td {border: 1px solid #cccccc;}--></style><table xmlns="http://www.w3.org/1999/xhtml" cellspacing="0" cellpadding="0" dir="ltr" border="1" style="table-layout:fixed;font-size:10pt;width:0px;border-collapse:collapse;border:none"><colgroup><col width="100"/><col width="100"/><col width="100"/></colgroup><tbody><tr style="height:21px;"><td style="overflow:hidden;" rowspan="1" colspan="2" data-sheets-value="{&quot;1&quot;:2,&quot;2&quot;:&quot;Header&quot;}">Header</td><td>Z</td></tr><tr style="height:21px;"><td>1</td><td>2</td><td>3</td></tr></tbody></table>`;

  it("reads Google Sheets' table, a cell that spans columns leaving the places it covers empty", () => {
    expect(rowsOfHtml(sheets)).toEqual([
      ["Header", "", "Z"],
      ["1", "2", "3"],
    ]);
  });

  it("leaves the places a row span covers empty, and lets the next row's cells go past them", () => {
    expect(rowsOfHtml('<table><tr><td rowspan="2">A</td><td>B</td></tr><tr><td>C</td></tr></table>')).toEqual([
      ["A", "B"],
      ["", "C"],
    ]);
    expect(rowsOfHtml('<table><tr><td colspan="2" rowspan="2">A</td><td>B</td></tr><tr><td>C</td></tr><tr><td>D</td><td>E</td><td>F</td></tr></table>')).toEqual([
      ["A", "", "B"],
      ["", "", "C"],
      ["D", "E", "F"],
    ]);
  });

  it("pads short rows to the widest", () => {
    expect(rowsOfHtml("<table><tr><td>a</td></tr><tr><td>b</td><td>c</td></tr></table>")).toEqual([
      ["a", ""],
      ["b", "c"],
    ]);
  });

  it("reads Excel's, with its comments and header cells", () => {
    const excel = "<html><body><!--StartFragment--><table><thead><tr><th>Name</th><th>Qty</th></tr></thead><tbody><tr><td>Bolt&nbsp;</td><td>12</td></tr></tbody></table><!--EndFragment--></body></html>";
    expect(rowsOfHtml(excel)).toEqual([
      ["Name", "Qty"],
      ["Bolt", "12"],
    ]);
  });

  it("drops scripts, event handlers and every tag, keeping only the words", () => {
    const hostile = '<table><tr><td>safe<script>window.pwned = 1</script><img src="x" onerror="window.pwned = 2"></td><td onclick="window.pwned = 3"><b>bold</b> <a href="javascript:window.pwned = 4">link</a><style>p { color: red }</style></td></tr></table>';
    const rows = rowsOfHtml(hostile);
    expect(rows).toEqual([["safe", "bold link"]]);
    expect(JSON.stringify(rows)).not.toContain("<");
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
  });

  it("makes a line break of a break or a block, and collapses the white space of the markup", () => {
    expect(rowsOfHtml("<table><tr><td>one<br>two</td><td><p>a</p><p>b</p></td><td>\n  spread\n  out  </td></tr></table>")).toEqual([["one\ntwo", "a\nb", "spread out"]]);
  });

  it("reads a table nested in a cell as words of that cell, not as rows", () => {
    const rows = rowsOfHtml("<table><tr><td>outer<table><tr><td>inner</td></tr></table></td><td>x</td></tr></table>");
    expect(rows).toHaveLength(1);
    expect(rows?.[0]).toHaveLength(2);
    expect(rows?.[0]?.[0]).toContain("outer");
  });

  it("holds a span of billions to the widest table there may be", () => {
    const started = Date.now();
    const rows = rowsOfHtml('<table><tr><td colspan="4000000000" rowspan="4000000000">x</td></tr><tr><td>y</td></tr></table>');
    expect(rows?.[0]?.length).toBeLessThanOrEqual(1000);
    expect(rows?.length).toBeLessThanOrEqual(10000);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("finds no table in HTML that has none", () => {
    expect(rowsOfHtml("<p>just words</p>")).toBeNull();
    expect(rowsOfHtml("")).toBeNull();
  });
});

describe("a copy of cells", () => {
  const texts: Text[][] = [
    [words(["Plan"], { b: true, color: "accent1" }), words(["one", "two"])],
    [{ paragraphs: [{ runs: [{ t: "a " }, { t: "link", link: "https://example.com", u: true }] }] }, words([""])],
  ];

  it("carries the cells' own words and looks, and comes back exactly", () => {
    const html = htmlOfCells(texts);
    expect(html).toMatch(/^<table data-kasten-cells="[A-Za-z0-9+/=]+">/);
    expect(textsOfHtml(html)).toEqual(texts);
  });

  it("is a table other programs can paste, with the words in the cells", () => {
    const html = htmlOfCells(texts);
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelectorAll("tr")).toHaveLength(2);
    expect(doc.querySelectorAll("td")).toHaveLength(4);
    expect(doc.querySelector("td")?.textContent).toBe("Plan");
    expect(rowsOfHtml(html)).toEqual([
      ["Plan", "one\ntwo"],
      ["a link", ""],
    ]);
  });

  it("escapes what is typed in a cell", () => {
    const html = htmlOfCells([[words(['<img src=x onerror="alert(1)"> & more'])]]);
    expect(html).not.toContain("<img");
    expect(rowsOfHtml(html)).toEqual([['<img src=x onerror="alert(1)"> & more']]);
  });

  it("is not read from a damaged attribute", () => {
    expect(textsOfHtml('<table data-kasten-cells="!!!"><tr><td>x</td></tr></table>')).toBeNull();
    expect(textsOfHtml(`<table data-kasten-cells="${btoa('{"not":"cells"}')}"></table>`)).toBeNull();
    expect(textsOfHtml(`<table data-kasten-cells="${btoa("[[1]]")}"></table>`)).toBeNull();
    expect(textsOfHtml("<table><tr><td>x</td></tr></table>")).toBeNull();
    expect(textsOfHtml("")).toBeNull();
  });

  it("is also plain words, a line to a paragraph", () => {
    expect(rowsOfTexts(texts)).toEqual([
      ["Plan", "one\ntwo"],
      ["a link", ""],
    ]);
  });

  it("puts the words and the table on the data of a copy", () => {
    const sent: Record<string, string> = {};
    writeCells({ setData: (type, value) => void (sent[type] = value) }, texts);
    expect(sent["text/plain"]).toBe('Plan\t"one\ntwo"\r\na link\t');
    expect(sent["text/html"]).toBe(htmlOfCells(texts));
  });
});

describe("what a paste makes of the clipboard", () => {
  const sheet = (extra: object) => ({ ...EMPTY, ...extra });
  const mine: Text[][] = [[words(["from kasten"], { b: true })]];

  it("prefers the cells Kasten copied, whatever else is on the clipboard", () => {
    const read = cellsFromContents(sheet({ html: htmlOfCells(mine), text: "ignored\tcells" }));
    expect(read).toEqual(mine);
  });

  it("then a table in HTML", () => {
    const read = cellsFromContents(sheet({ html: "<table><tr><td>x</td><td>y</td></tr></table>", text: "ignored" }));
    expect(read).toEqual(textsOfRows([["x", "y"]]));
  });

  it("then rows of text", () => {
    expect(cellsFromContents(sheet({ text: "a\tb\nc\td" }))).toEqual(textsOfRows([["a", "b"], ["c", "d"]]));
    expect(cellsFromContents(sheet({ text: "just words" }))).toEqual(textsOfRows([["just words"]]));
  });

  it("finds nothing in an empty clipboard, or one that holds only a picture", () => {
    expect(cellsFromContents(EMPTY)).toBeNull();
    expect(cellsFromContents(sheet({ text: "   \n " }))).toBeNull();
  });

  it("makes a paragraph of each line of a cell, and an empty paragraph of an empty cell", () => {
    expect(textsOfRows([["a\nb", ""]])).toEqual([[words(["a", "b"]), words([""])]]);
  });
});
