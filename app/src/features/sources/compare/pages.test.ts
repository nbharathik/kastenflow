import { describe, expect, it } from "vitest";

import type { Highlight } from "../../../lib/vault/source-types";
import { citationGroups } from "../../pages/editor/cite/scan";
import { comparisonMarkdown, comparisonTitle, DEFAULT_COLUMNS, escapeMarkdown, outlineMarkdown, quoteBlock, type PaperRef } from "./pages";

const highlight = (id: string, page: number, text: string, comment: string | null = null): Highlight => ({ id, page, rects: [], text, color: "yellow", comment, cardId: null, created: null, card: null });

const VASWANI: PaperRef = { key: "vaswani2017attention", label: "Vaswani et al., 2017", title: "Attention is all you need", source: "sources/attention.pdf" };
const DEVLIN: PaperRef = { key: "devlin2019bert", label: "Devlin and Chang, 2019", title: "BERT", source: "sources/bert.pdf" };
const LOOSE: PaperRef = { key: null, label: "primer", title: "A primer", source: "sources/my primer.pdf" };

describe("escaping a quotation for a page", () => {
  it("keeps the words and stops Markdown or a citation being made of them", () => {
    expect(escapeMarkdown("a * b _c_ `d` [1] <x> | \\")).toBe("a \\* b \\_c\\_ \\`d\\` \\[1\\] \\<x> \\| \\\\");
    expect(escapeMarkdown("# not a heading")).toBe("\\# not a heading");
    expect(escapeMarkdown("2. not a list")).toBe("2\\. not a list");
    expect(escapeMarkdown("  spaced \n  out  ")).toBe("spaced out");
  });

  it("leaves nothing that reads as a citation", () => {
    expect(citationGroups(escapeMarkdown("as in [@someone, p. 4]"))).toEqual([]);
  });
});

describe("a quotation with its source", () => {
  it("is the words, a citation with the page, and a link back to the highlight", () => {
    expect(quoteBlock(VASWANI, highlight("h1", 3, "The Transformer relies entirely on attention."))).toBe(
      "> The Transformer relies entirely on attention.\n>\n> [@vaswani2017attention, p. 3] · [Attention is all you need, p. 3](kasten:pdf/sources/attention.pdf?page=3&highlight=h1)\n",
    );
  });

  it("links back by the PDF alone when the source has no reference, and writes a path the way an address needs", () => {
    expect(quoteBlock(LOOSE, highlight("h 9", 12, "Words."))).toBe("> Words.\n>\n> [A primer, p. 12](kasten:pdf/sources/my%20primer.pdf?page=12&highlight=h%209)\n");
  });

  it("carries the person's comment as a line of its own after the quote", () => {
    const block = quoteBlock(VASWANI, highlight("h1", 3, "Words.", "Compare with BERT"));
    expect(block.endsWith("\nComment: Compare with BERT\n")).toBe(true);
  });

  it("is a citation the vault reads, and a link it does not mistake for one", () => {
    const block = quoteBlock(VASWANI, highlight("h1", 3, "Words."));
    const groups = citationGroups(block.split("\n")[2]!.slice(2));
    expect(groups.flatMap((g) => g.items.map((i) => i.key))).toEqual(["vaswani2017attention"]);
  });
});

describe("a comparison page", () => {
  it("is a table with a row for each paper and the usual columns to fill in", () => {
    const text = comparisonMarkdown([VASWANI, DEVLIN, LOOSE], DEFAULT_COLUMNS, new Map());
    expect(text).toBe(
      [
        "| Paper | Question | Method | Evidence | Limitations | Relevance |",
        "| --- | --- | --- | --- | --- | --- |",
        "| [@vaswani2017attention] Attention is all you need |  |  |  |  |  |",
        "| [@devlin2019bert] BERT |  |  |  |  |  |",
        "| [A primer](kasten:pdf/sources/my%20primer.pdf?page=1) |  |  |  |  |  |",
        "",
      ].join("\n"),
    );
  });

  it("can start the Evidence column from the highlights chosen, each linked back", () => {
    const text = comparisonMarkdown([VASWANI], DEFAULT_COLUMNS, new Map([[VASWANI, [highlight("h1", 3, "Attention only | no recurrence"), highlight("h2", 5, "x".repeat(300))]]]));
    const row = text.split("\n")[2]!;
    expect(row).toContain("“Attention only \\| no recurrence” ([p. 3](kasten:pdf/sources/attention.pdf?page=3&highlight=h1))");
    expect(row).toContain("([p. 5](kasten:pdf/sources/attention.pdf?page=5&highlight=h2))");
    expect(row).toMatch(/x{139}…”/);
  });

  it("takes the columns the person names, and a table of one column is still a table", () => {
    expect(comparisonMarkdown([VASWANI], ["Aim"], new Map()).split("\n").slice(0, 2)).toEqual(["| Paper | Aim |", "| --- | --- |"]);
    expect(comparisonMarkdown([VASWANI], [], new Map()).split("\n").slice(0, 2)).toEqual(["| Paper |", "| --- |"]);
  });

  it("is named for its papers", () => {
    expect(comparisonTitle([VASWANI, DEVLIN])).toBe("Comparison: Vaswani et al., 2017; Devlin and Chang, 2019");
    expect(comparisonTitle([VASWANI, DEVLIN, LOOSE, { ...LOOSE, label: "x" }])).toBe("Comparison: Vaswani et al., 2017; Devlin and Chang, 2019; primer and 1 more");
  });
});

describe("an outline of the evidence", () => {
  it("has a heading for each paper and every chosen quotation under it with its way back", () => {
    const text = outlineMarkdown([
      { paper: VASWANI, highlights: [highlight("h1", 3, "First."), highlight("h2", 4, "Second.", "note")] },
      { paper: DEVLIN, highlights: [] },
    ]);
    expect(text).toBe(
      [
        "## Vaswani et al., 2017: Attention is all you need",
        "",
        "> First.",
        ">",
        "> [@vaswani2017attention, p. 3] · [Attention is all you need, p. 3](kasten:pdf/sources/attention.pdf?page=3&highlight=h1)",
        "",
        "> Second.",
        ">",
        "> [@vaswani2017attention, p. 4] · [Attention is all you need, p. 4](kasten:pdf/sources/attention.pdf?page=4&highlight=h2)",
        "",
        "Comment: note",
        "",
        "## Devlin and Chang, 2019: BERT",
        "",
        "No highlights chosen yet.",
        "",
      ].join("\n"),
    );
  });
});
