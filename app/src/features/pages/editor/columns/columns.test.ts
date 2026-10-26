// Columns are HTML comment markers around ordinary blocks. The goldens in
// fixtures/roundtrip/columns must come back byte for byte, with and without
// the editor understanding the markers, and edits inside a column touch only
// the block that changed.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { splitFrontmatter } from "../../markdown/frontmatter";
import { openNote } from "../session";
import { topLevel } from "../milkdown-codec";
import { columnFixtures, columnsBlocks, crlf, fixture, makeEditor, shapeOf, typeBefore, type Harness } from "./harness";
import { findColumns } from "./remark";

let h: Harness;
beforeAll(async () => {
  h = await makeEditor();
});
afterAll(async () => {
  await h.destroy();
});

/** What each fixture should show: its columns blocks as [ratio, number of columns]. */
const EXPECTED: Record<string, [string, number][]> = {
  "01-two-columns.md": [["", 2]],
  "02-three-columns-ratio.md": [["20/30/50", 3]],
  "03-nested-lists.md": [["40/60", 2]],
  "04-code-with-marker-text.md": [["", 2]],
  "05-embeds.md": [["50/50", 2]],
  "06-empty-columns.md": [
    ["", 3],
    ["", 1],
  ],
  "07-odd-spacing.md": [
    ["30/70", 2],
    ["", 2],
  ],
  "08-unterminated.md": [],
  "08b-unterminated-comment.md": [],
  "09-nested-markers.md": [["50/50", 2]],
  "10-two-blocks-in-a-row.md": [
    ["", 2],
    ["25/75", 2],
    ["", 2],
  ],
  "11-toggle-callout-inside.md": [["60/40", 2]],
  "12-no-columns.md": [],
};

describe("the golden fixtures", () => {
  it("has at least twelve", () => {
    expect(columnFixtures.length).toBeGreaterThanOrEqual(12);
    expect(Object.keys(EXPECTED).sort()).toEqual(columnFixtures.map((f) => f.name.split("/").pop()!).sort());
  });

  it.each(columnFixtures.map((f) => [f.name.split("/").pop()!, f.text]))("%s shows the columns the markers make", (name, text) => {
    const { body } = splitFrontmatter(text);
    openNote(h.crepe, body);
    const found = columnsBlocks(h.view().state.doc).map(({ node }) => [String(node.attrs.ratio), node.childCount] as [string, number]);
    expect(found).toEqual(EXPECTED[name!]);
  });

  it.each(columnFixtures.map((f) => [f.name.split("/").pop()!, f.text]))("%s opens and saves without changing a byte", (_name, text) => {
    const { prefix, body } = splitFrontmatter(text);
    expect(prefix + openNote(h.crepe, body).save()).toBe(text);
  });

  it.each(columnFixtures.map((f) => [f.name.split("/").pop()!, crlf(f.text)]))("%s keeps CRLF line ends", (_name, text) => {
    const { prefix, body } = splitFrontmatter(text);
    expect(prefix + openNote(h.crepe, body).save()).toBe(text);
  });

  it("keeps a file with no columns the same after an edit elsewhere", () => {
    const text = fixture("12-no-columns.md");
    const note = openNote(h.crepe, text);
    typeBefore(h.view(), "Text.", "More ");
    expect(note.save()).toBe(text.replace("Text.", "More Text."));
    expect(columnsBlocks(h.view().state.doc)).toHaveLength(0);
  });

  it("shows the content of a column as ordinary blocks", () => {
    openNote(h.crepe, fixture("01-two-columns.md"));
    const [only] = columnsBlocks(h.view().state.doc);
    expect(shapeOf(only!.node)).toBe("columns()[paragraph,paragraph | paragraph,heading]");
  });

  it("does not make columns of a nested pair: it stays comments in the column", () => {
    openNote(h.crepe, fixture("09-nested-markers.md"));
    const blocks = columnsBlocks(h.view().state.doc);
    expect(blocks).toHaveLength(1);
    const first = blocks[0]!.node.firstChild!;
    expect(first.textContent).toContain("Inner left");
    const comments: string[] = [];
    first.descendants((n) => void (n.type.name === "html" && comments.push(String(n.attrs.value))));
    expect(comments).toEqual(["<!-- columns -->", "<!-- column -->", "<!-- /columns -->"]);
  });

  it("keeps the other blocks of the page where they were", () => {
    openNote(h.crepe, fixture("01-two-columns.md"));
    const names = topLevel(h.view().state.doc).map((n) => n.type.name);
    expect(names.slice(0, 3)).toEqual(["heading", "columns", "paragraph"]);
  });
});

describe("editing inside a column", () => {
  it("changes only the block typed in", () => {
    const text = fixture("01-two-columns.md");
    const note = openNote(h.crepe, text);
    typeBefore(h.view(), "Right column text.", "Edited ");
    expect(note.save()).toBe(text.replace("Right column text.", "Edited Right column text."));
  });

  it("leaves hand-written list spelling in untouched blocks of an edited column", () => {
    const text = fixture("03-nested-lists.md");
    const note = openNote(h.crepe, text);
    typeBefore(h.view(), "a quote", "Edited ");
    const saved = note.save();
    expect(saved.startsWith("<!-- columns 40/60 -->\n\n* one\n    * nested a\n    * nested b\n* two\n\n1. first\n2. second\n   - mixed child\n\n<!-- column -->\n\n")).toBe(true);
    expect(saved).toContain("Edited a quote");
    expect(saved.endsWith("- [x] done task\n  continued line\n\n<!-- /columns -->\n")).toBe(true);
  });

  it("keeps odd marker spelling and spacing when a block in a column changes", () => {
    const text = fixture("07-odd-spacing.md");
    const note = openNote(h.crepe, text);
    typeBefore(h.view(), "Tight right side.", "Edited ");
    // An edited block is never left touching its neighbour: the code fence under the edited
    // line, and the line under the closing marker, each get the blank line they lacked.
    expect(note.save()).toBe(text.replace("Tight right side.\n```js", "Edited Tight right side.\n\n```js").replace("<!--/columns-->\nStraight", "<!--/columns-->\n\nStraight"));
  });

  it("keeps CRLF in an edited column", () => {
    const text = crlf(fixture("01-two-columns.md"));
    const note = openNote(h.crepe, text);
    typeBefore(h.view(), "Right column text.", "Edited ");
    expect(note.save()).toBe(text.replace("Right column text.", "Edited Right column text."));
  });

  it("edits a block next to a columns block without touching it", () => {
    const text = fixture("10-two-blocks-in-a-row.md");
    const note = openNote(h.crepe, text);
    typeBefore(h.view(), "Between and after.", "Edited ");
    expect(note.save()).toBe(text.replace("Between and after.", "Edited Between and after."));
  });

  it("reopens what it saved with the same columns", () => {
    const note = openNote(h.crepe, fixture("02-three-columns-ratio.md"));
    typeBefore(h.view(), "Middle two.", "Edited ");
    const saved = note.save();
    openNote(h.crepe, saved);
    const [only] = columnsBlocks(h.view().state.doc);
    expect(only!.node.childCount).toBe(3);
    expect(String(only!.node.attrs.ratio)).toBe("20/30/50");
  });
});

describe("finding columns among blocks", () => {
  const html = (v: string) => ({ type: "html", value: v });
  const text = (v: string) => ({ type: "paragraph", value: v });
  const of = (nodes: { type: string; value: string }[]) => findColumns(nodes, (n) => (n.type === "html" ? n.value : null));

  it("pairs an opener, its separators and its closer", () => {
    const spans = of([html("<!-- columns 30/70 -->"), text("a"), html("<!-- column -->"), text("b"), html("<!-- /columns -->")]);
    expect(spans).toEqual([{ start: 0, end: 4, separators: [2], ratio: "30/70" }]);
  });

  it("leaves an unclosed opener alone", () => {
    expect(of([html("<!-- columns -->"), text("a"), html("<!-- column -->"), text("b")])).toEqual([]);
  });

  it("ignores a stray separator or closer", () => {
    expect(of([html("<!-- column -->"), html("<!-- /columns -->"), text("a")])).toEqual([]);
  });

  it("keeps a nested pair inside the outer block", () => {
    const spans = of([html("<!-- columns -->"), html("<!-- columns -->"), html("<!-- column -->"), html("<!-- /columns -->"), html("<!-- column -->"), html("<!-- /columns -->")]);
    expect(spans).toEqual([{ start: 0, end: 5, separators: [4], ratio: "" }]);
  });

  it("accepts spacing the way people type it, and nothing else on the line", () => {
    expect(of([html("<!--columns 1/2-->"), html("<!--   /columns   -->")])).toHaveLength(1);
    expect(of([html("<!-- columns 40/60 extra -->"), html("<!-- /columns -->")])).toEqual([]);
    expect(of([html("<!-- columns -->  text"), html("<!-- /columns -->")])).toEqual([]);
  });

  it("finds two blocks in a row", () => {
    const spans = of([html("<!-- columns -->"), html("<!-- /columns -->"), html("<!-- columns -->"), html("<!-- /columns -->")]);
    expect(spans.map((s) => [s.start, s.end])).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });
});
