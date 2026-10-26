// Hostile inputs for the columns round trip: whatever the markers do or do not
// mean, a page the editor does not edit comes back byte for byte, and an edit
// touches only its own block.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { splitFrontmatter } from "../../markdown/frontmatter";
import { openNote } from "../session";
import { columnsBlocks, crlf, findText, makeEditor, typeBefore, type Harness } from "./harness";
import { moveAcross } from "./ops";
import { hasNestedColumns } from "./guard";
import { TextSelection } from "@milkdown/kit/prose/state";

let h: Harness;
beforeAll(async () => {
  h = await makeEditor();
});
afterAll(async () => {
  await h.destroy();
});

/** Opens `text` the way a note is opened (front matter apart) and saves it unchanged. */
function saved(text: string): string {
  const { prefix, body } = splitFrontmatter(text);
  return prefix + openNote(h.crepe, body).save();
}

function open(text: string) {
  const { prefix, body } = splitFrontmatter(text);
  const note = openNote(h.crepe, body);
  return { save: () => prefix + note.save() };
}

const TWO = (open = "<!-- columns -->", sep = "<!-- column -->", close = "<!-- /columns -->") =>
  `Intro.\n\n${open}\n\nLeft.\n\n${sep}\n\nRight.\n\n${close}\n\nOutside.\n`;

const NOT_COLUMNS: Record<string, string> = {
  inList: "- item\n\n  <!-- columns -->\n\n  a\n\n  <!-- column -->\n\n  b\n\n  <!-- /columns -->\n\nOutside.\n",
  inQuote: "> <!-- columns -->\n>\n> a\n>\n> <!-- column -->\n>\n> b\n>\n> <!-- /columns -->\n\nOutside.\n",
  indentedCode: "    <!-- columns -->\n\n    a\n\n    <!-- /columns -->\n\nOutside.\n",
  tabIndentedCode: "\t<!-- columns -->\n\nOutside.\n\n\t<!-- /columns -->\n",
  inFences: "```\n<!-- columns -->\n```\n\nOutside.\n\n~~~\n<!-- /columns -->\n~~~\n",
  insideFenceWholeBlock: "```md\n<!-- columns -->\n\nA\n\n<!-- column -->\n\nB\n\n<!-- /columns -->\n```\n\nOutside.\n",
  inHtmlBlock: "<div>\n<!-- columns -->\n\nOutside.\n\n<!-- /columns -->\n</div>\n",
  closerInHtmlBlock: "<!-- columns -->\n\nOutside.\n\n<div>\n<!-- /columns -->\n</div>\n",
  suffixOnLine: "<!-- columns --> text\n\nOutside.\n\n<!-- /columns -->\n",
  invalidRatioNegative: TWO("<!-- columns 150/-50 -->"),
  invalidRatioText: TWO("<!-- columns wide -->"),
  invalidRatioTrailingSlash: TWO("<!-- columns 40/60/ -->"),
  decimalRatio: TWO("<!-- columns 0.4/0.6 -->"),
  commentSpanningBlocks: "<!--\n<!-- columns -->\n-->\n\nOutside.\n\n<!-- /columns -->\n",
};

describe("markers that do not make columns come back untouched", () => {
  for (const [name, text] of Object.entries(NOT_COLUMNS)) {
    it(`${name}: same bytes, no columns, an edit elsewhere is local`, () => {
      expect(saved(text)).toBe(text);
      expect(columnsBlocks(h.view().state.doc)).toHaveLength(0);
      expect(saved(crlf(text))).toBe(crlf(text));
      const note = open(text);
      typeBefore(h.view(), "Outside.", "Edited ");
      expect(note.save()).toBe(text.replace("Outside.", "Edited Outside."));
    });
  }
});

const MAKES_COLUMNS: [string, string, string][] = [
  ["plain", "<!-- columns 40/60 -->", "40/60"],
  ["no spaces", "<!--columns 40/60-->", "40/60"],
  ["capitals", "<!-- COLUMNS 40/60 -->", "40/60"],
  ["tabs", "<!--\tcolumns\t40/60\t-->", "40/60"],
  ["spaces around the slash", "<!-- columns 40 / 60 -->", "40/60"],
  ["three parts with spaces", "<!-- columns 20 /30/ 50 -->", "20/30/50"],
  ["leading zeros", "<!-- columns 040/060 -->", "040/060"],
  ["zero part", "<!-- columns 0/100 -->", "0/100"],
  ["wrong count", "<!-- columns 40/30/30 -->", "40/30/30"],
  ["huge numbers", "<!-- columns 99999999999999999999/1 -->", "99999999999999999999/1"],
  ["trailing blanks", "<!-- columns 40/60 -->   ", "40/60"],
];

describe("opening comment variants", () => {
  for (const [name, opener, ratio] of MAKES_COLUMNS) {
    it(`${name}: makes columns, round-trips, and an edit in the right column is local`, () => {
      const text = TWO(opener);
      expect(saved(text)).toBe(text);
      expect(saved(crlf(text))).toBe(crlf(text));
      const note = open(text);
      const blocks = columnsBlocks(h.view().state.doc);
      expect(blocks).toHaveLength(1);
      expect(String(blocks[0]!.node.attrs.ratio)).toBe(ratio);
      typeBefore(h.view(), "Right.", "Edited ");
      expect(note.save()).toBe(text.replace("Right.", "Edited Right."));
    });
  }
});

const THREE =
  "---\ntitle: T\n---\n\nPre.\n\n<!-- columns 20/30/50 -->\n\nFirst para.\n\n<!-- column -->\n\nMiddle para.\n\n<!-- column -->\n\nLast para.\n\n<!-- /columns -->\n\nPost.\n";

describe("editing one column", () => {
  for (const word of ["First para.", "Middle para.", "Last para.", "Pre.", "Post."]) {
    for (const eolOf of [(t: string) => t, crlf]) {
      it(`${word}${eolOf === crlf ? " (CRLF)" : ""}`, () => {
        const text = eolOf(THREE);
        const note = open(text);
        typeBefore(h.view(), word, "Edited ");
        expect(note.save()).toBe(text.replace(word, `Edited ${word}`));
      });
    }
  }

  it("typing and deleting again in a column leaves every byte", () => {
    const note = open(THREE);
    typeBefore(h.view(), "Middle para.", "xyz");
    const at = findText(h.view().state.doc, "xyzMiddle");
    h.view().dispatch(h.view().state.tr.delete(at, at + 3));
    expect(note.save()).toBe(THREE);
  });

  it("editing two columns at once changes exactly those two blocks", () => {
    const note = open(THREE);
    typeBefore(h.view(), "First para.", "A ");
    typeBefore(h.view(), "Last para.", "B ");
    expect(note.save()).toBe(THREE.replace("First para.", "A First para.").replace("Last para.", "B Last para."));
  });

  it("emptying a column keeps the column, and the page reopens with three", () => {
    const note = open(THREE);
    const { pos, node } = columnsBlocks(h.view().state.doc)[0]!;
    const first = node.child(0);
    const start = pos + 1 + 1;
    const tr = h.view().state.tr.replaceWith(start, start + first.content.size, h.view().state.schema.nodes.paragraph!.create());
    h.view().dispatch(tr);
    const out = note.save();
    expect(out).toContain("<!-- columns 20/30/50 -->\n\n<!-- column -->\n\nMiddle para.");
    expect(out).not.toContain("First para.");
    open(out);
    expect(columnsBlocks(h.view().state.doc)[0]!.node.childCount).toBe(3);
  });

  it("emptying every column leaves a valid block", () => {
    const note = open(THREE);
    const { schema } = h.view().state;
    // Walk from the last column to the first so positions stay valid.
    const cols: { pos: number; size: number }[] = [];
    h.view().state.doc.descendants((n, p) => {
      if (n.type.name === "column") cols.push({ pos: p, size: n.content.size });
      return true;
    });
    let tr = h.view().state.tr;
    for (const c of cols.reverse()) tr = tr.replaceWith(c.pos + 1, c.pos + 1 + c.size, schema.nodes.paragraph!.create());
    h.view().dispatch(tr);
    const out = note.save();
    open(out);
    expect(columnsBlocks(h.view().state.doc)[0]!.node.childCount).toBe(3);
    expect(out).toContain("Pre.");
    expect(out).toContain("Post.");
  });

  it("deleting the whole columns block leaves the rest as it was", () => {
    const note = open(THREE);
    const { pos, node } = columnsBlocks(h.view().state.doc)[0]!;
    h.view().dispatch(h.view().state.tr.delete(pos, pos + node.nodeSize));
    expect(note.save()).toBe("---\ntitle: T\n---\n\nPre.\n\nPost.\n");
  });
});

describe("other blocks in a column", () => {
  const MIXED = [
    "<!-- columns 50/50 -->",
    "",
    "| a | b |",
    "|---|---|",
    "| 1 | 2 |",
    "",
    "Para L.",
    "",
    "<!-- column -->",
    "",
    "> [!note] Title",
    "> Body",
    "",
    "<details>",
    "<summary>T</summary>",
    "",
    "Hidden.",
    "",
    "</details>",
    "",
    "$$",
    "x^2",
    "$$",
    "",
    "![[some note]]",
    "",
    "Para R.",
    "",
    "<!-- /columns -->",
    "",
  ].join("\n");

  for (const eolOf of [(t: string) => t, crlf]) {
    for (const word of ["Para L.", "Para R.", "Hidden."]) {
      it(`${word}${eolOf === crlf ? " (CRLF)" : ""}: table, callout, toggle, math and embed survive`, () => {
        const text = eolOf(MIXED);
        expect(saved(text)).toBe(text);
        const note = open(text);
        typeBefore(h.view(), word, "Edited ");
        expect(note.save()).toBe(text.replace(word, `Edited ${word}`));
      });
    }
  }
});

describe("page shapes", () => {
  it("columns at the very start and end, no final newline, with front matter", () => {
    const text = "---\ntitle: x\nextra: [1, 2]\n---\n<!-- columns -->\n\nL\n\n<!-- column -->\n\nR\n\n<!-- /columns -->";
    expect(saved(text)).toBe(text);
    expect(saved(crlf(text))).toBe(crlf(text));
    const note = open(text);
    typeBefore(h.view(), "R", "Edited ");
    expect(note.save()).toBe(text.replace("\nR\n", "\nEdited R\n"));
  });

  it("a page that is only columns, with leading blank lines", () => {
    const text = "\n\n<!-- columns -->\n\nL\n\n<!-- column -->\n\nR\n\n<!-- /columns -->\n\n\n";
    expect(saved(text)).toBe(text);
  });

  it("two blocks in a row, touching, edited in the second", () => {
    const text = "<!-- columns -->\n\nA1\n\n<!-- column -->\n\nA2\n\n<!-- /columns -->\n\n<!-- columns 30/70 -->\n\nB1\n\n<!-- column -->\n\nB2\n\n<!-- /columns -->\n";
    expect(saved(text)).toBe(text);
    const note = open(text);
    typeBefore(h.view(), "B2", "Edited ");
    expect(note.save()).toBe(text.replace("B2", "Edited B2"));
    expect(columnsBlocks(h.view().state.doc)).toHaveLength(2);
  });

  it("unicode survives in markers' neighbours and in edited blocks", () => {
    const text = "<!-- columns -->\n\nZwölf 日本語 🎉 é مرحبا\n\n<!-- column -->\n\n😀 smile\n\n<!-- /columns -->\n\nÜber.\n";
    expect(saved(text)).toBe(text);
    const note = open(text);
    typeBefore(h.view(), "😀 smile", "Edited ");
    expect(note.save()).toBe(text.replace("😀 smile", "Edited 😀 smile"));
  });

  it("a very large block stays exact, and an edit in it stays local", () => {
    const left = Array.from({ length: 400 }, (_, i) => `Left paragraph number ${i}.`).join("\n\n");
    const right = Array.from({ length: 400 }, (_, i) => `- right item ${i}\n  - nested ${i}`).join("\n\n");
    const text = `<!-- columns -->\n\n${left}\n\n<!-- column -->\n\n${right}\n\n<!-- /columns -->\n`;
    expect(saved(text)).toBe(text);
    const note = open(text);
    typeBefore(h.view(), "Left paragraph number 200.", "Edited ");
    expect(note.save()).toBe(text.replace("Left paragraph number 200.", "Edited Left paragraph number 200."));
  });
});

describe("references that live outside the block", () => {
  it("a reference link in an edited column keeps its spelling, the definition stays", () => {
    const text = "<!-- columns -->\n\nSee [the site][ref] and more.\n\nOther para.\n\n<!-- column -->\n\nB\n\n<!-- /columns -->\n\n[ref]: https://example.com\n";
    expect(saved(text)).toBe(text);
    const note = open(text);
    typeBefore(h.view(), "Other para.", "Edited ");
    expect(note.save()).toBe(text.replace("Other para.", "Edited Other para."));
  });

  it("a definition inside another column of the same block, on a CRLF page", () => {
    const text = crlf("<!-- columns -->\n\nSee [x][ref].\n\nOther.\n\n<!-- column -->\n\n[ref]: https://example.com\n\nB.\n\n<!-- /columns -->\n\nSee [y][ref] outside.\n");
    expect(saved(text)).toBe(text);
    const note = open(text);
    typeBefore(h.view(), "Other.", "Edited ");
    expect(note.save()).toBe(text.replace("Other.", "Edited Other."));
  });

  it("a footnote reference in an edited column keeps its spelling", () => {
    const text = "<!-- columns -->\n\nClaim[^1] here.\n\nOther para.\n\n<!-- column -->\n\nB\n\n<!-- /columns -->\n\n[^1]: The note.\n";
    expect(saved(text)).toBe(text);
    const note = open(text);
    typeBefore(h.view(), "Other para.", "Edited ");
    expect(note.save()).toBe(text.replace("Other para.", "Edited Other para."));
  });
});

describe("moving blocks keeps the page's line ends", () => {
  it("into an empty column on a CRLF page: no bare LF anywhere", () => {
    const text = crlf("<!-- columns -->\n\nOne.\n\nTwo.\n\n<!-- column -->\n\n<!-- /columns -->\n");
    const note = open(text);
    const view = h.view();
    const pos = findText(view.state.doc, "Two.");
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
    expect(moveAcross(1)(view.state, view.dispatch)).toBe(true);
    const out = note.save();
    expect(out).toContain("Two.");
    expect(out.replace(/\r\n/g, "")).not.toMatch(/\n/);
  });
});

describe("columns only at the top level of a page", () => {
  it("a columns block moved into a list item, a quote or a callout is refused", () => {
    open("- item\n\n> quote\n\n<!-- columns -->\n\nL\n\n<!-- column -->\n\nR\n\n<!-- /columns -->\n");
    const view = h.view();
    const { pos, node } = columnsBlocks(view.state.doc)[0]!;
    const quote = findText(view.state.doc, "quote");
    view.dispatch(view.state.tr.insert(quote + "quote".length + 1, node));
    expect(hasNestedColumns(view.state.doc)).toBe(false);
    expect(columnsBlocks(view.state.doc)).toHaveLength(1);
    expect(columnsBlocks(view.state.doc)[0]!.pos).toBe(pos);
  });
});
