// The Markdown a comparison is made of: a quotation with its source, page,
// citation and a link back to the highlight; a table with a row for each paper;
// an outline of the chosen evidence. All plain Markdown that anyone can edit,
// written with no AI. Every quotation links back to the highlight it came
// from, and a quoted passage is escaped so it cannot become a citation, a
// heading or a list of its own.

import { pdfLink } from "../../../lib/kasten-links";
import type { Highlight } from "../../../lib/vault/source-types";

/** A paper as a comparison names it. */
export interface PaperRef {
  /** Its citation key, when it has a reference. */
  key: string | null;
  /** How it is named in a heading: "Vaswani et al., 2017". */
  label: string;
  title: string;
  /** The PDF in `sources/`, when it has one. */
  source: string | null;
}

export const DEFAULT_COLUMNS = ["Question", "Method", "Evidence", "Limitations", "Relevance"];

/** The most characters of a quotation that go into a table cell. */
const CELL_QUOTE = 140;

/** Words that read as themselves in a page: one line, with no mark that Markdown would act on. */
export function escapeMarkdown(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  const escaped = one.replace(/[\\*_`[\]<|]/g, (c) => `\\${c}`);
  // A line of its own could start with a heading, a quote, a bullet or a number.
  return escaped.replace(/^([#>+-])/, "\\$1").replace(/^(\d+)([.)])/, "$1\\$2");
}

/** Text that goes in a link's label or a heading: escaped the same way (the bar too, for a table cell). */
const label = escapeMarkdown;

/** `[Title, p. 3](kasten:pdf/...)`, or the words alone when the paper has no PDF. */
function backLink(paper: PaperRef, h: Highlight): string {
  const words = `${paper.title || paper.label}, p. ${h.page}`;
  return paper.source ? `[${label(words)}](${pdfLink(paper.source, h.page, h.id)})` : label(words);
}

/** The highlight as a quotation: its words, then the citation with the page and the way back. A comment of the person's follows as a line of its own. */
export function quoteBlock(paper: PaperRef, h: Highlight): string {
  const cite = paper.key ? `[@${paper.key}, p. ${h.page}]` : "";
  const source = [cite, backLink(paper, h)].filter(Boolean).join(" · ");
  const quote = `> ${escapeMarkdown(h.text)}\n>\n> ${source}\n`;
  const comment = (h.comment ?? "").replace(/\s+/g, " ").trim();
  return comment ? `${quote}\nComment: ${escapeMarkdown(comment)}\n` : quote;
}

/** A quotation short enough for a table cell, with the link back to its page. */
function cellQuote(paper: PaperRef, h: Highlight): string {
  const words = h.text.replace(/\s+/g, " ").trim();
  const short = words.length > CELL_QUOTE ? `${words.slice(0, CELL_QUOTE - 1).trimEnd()}…` : words;
  const where = paper.source ? `[p. ${h.page}](${pdfLink(paper.source, h.page, h.id)})` : `p. ${h.page}`;
  return `“${escapeMarkdown(short)}” (${where})`;
}

/** The first cell of a row: the citation and the title, or a link to the PDF for a paper with no reference. */
function paperCell(paper: PaperRef): string {
  if (paper.key) return `[@${paper.key}] ${label(paper.title || paper.label)}`.trim();
  return paper.source ? `[${label(paper.title || paper.label)}](${pdfLink(paper.source, 1)})` : label(paper.title || paper.label);
}

/** A page naming the papers: a table with a row for each and the columns to fill in. `evidence` may hold highlights to start the Evidence column from. */
export function comparisonMarkdown(papers: readonly PaperRef[], columns: readonly string[], evidence: ReadonlyMap<PaperRef, readonly Highlight[]>): string {
  const names = columns.map((c) => c.replace(/[|\n]/g, " ").trim()).filter(Boolean);
  const head = `| ${["Paper", ...names].join(" | ")} |`;
  const rule = `| ${["---", ...names.map(() => "---")].join(" | ")} |`;
  const rows = papers.map((paper) => {
    const cells = names.map((name) => (name.toLowerCase() === "evidence" ? (evidence.get(paper) ?? []).map((h) => cellQuote(paper, h)).join("; ") : ""));
    return `| ${[paperCell(paper), ...cells].join(" | ")} |`;
  });
  return `${[head, rule, ...rows].join("\n")}\n`;
}

/** A name for the page: "Comparison: A; B; C and 2 more". */
export function comparisonTitle(papers: readonly PaperRef[], what = "Comparison"): string {
  const shown = papers.slice(0, 3).map((p) => p.label);
  const rest = papers.length - shown.length;
  return `${what}: ${shown.join("; ")}${rest > 0 ? ` and ${rest} more` : ""}`;
}

/** A heading for each paper and the quotations chosen from it, each with its citation and its way back. */
export function outlineMarkdown(items: readonly { paper: PaperRef; highlights: readonly Highlight[] }[]): string {
  return items
    .map(({ paper, highlights }) => {
      const body = highlights.length > 0 ? highlights.map((h) => quoteBlock(paper, h)).join("\n") : "No highlights chosen yet.\n";
      return `## ${label(`${paper.label}: ${paper.title}`)}\n\n${body}`;
    })
    .join("\n");
}
