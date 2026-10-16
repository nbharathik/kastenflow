// AI assistance for a comparison, kept honest. The passages that go to the model
// are made here and shown to the person first, as exactly the text that is
// sent. What comes back is read line by line: a quotation (a line the model
// started with "> ") is looked for in the passages that were sent, its
// interpretation is marked as generated, and every citation key in it is
// checked against the bibliography and against the papers whose passages were
// sent. None of it is taken as true: a person has to check that the cited
// passage supports each claim.

import { citationGroups } from "../../pages/editor/cite/scan";
import type { ComparePaper } from "./papers";

/** The most of the passages the AI reads at once (what the writing request keeps). */
export const MOST_CHARS = 24_000;
/** The most pages of one paper that are sent. */
const MOST_PAGES = 3;
const CUT = "\n(cut here)";

export interface Passage {
  paper: ComparePaper;
  /** The page of the PDF; null for the abstract of the paper's reference. */
  page: number | null;
  text: string;
  from: "pdf" | "abstract";
}

/** The pages of a paper to send: those with the highlights chosen (the first three), else the first page. */
export function pagesFor(paper: ComparePaper, chosen: ReadonlySet<string>): number[] {
  const pages = [...new Set(paper.highlights.filter((h) => chosen.has(h.id)).map((h) => h.page))].sort((a, b) => a - b);
  return pages.length > 0 ? pages.slice(0, MOST_PAGES) : [1];
}

const headingOf = (p: Passage) => `${p.paper.key ? `[@${p.paper.key}] ` : ""}${p.paper.title}, ${p.from === "abstract" ? "abstract from your reference" : `page ${p.page}`}:`;

/** The text that goes to the AI as the passages, which the person is shown as it is. */
export function selectionOf(passages: readonly Passage[]): string {
  const whole = passages.map((p) => `${headingOf(p)}\n${p.text.trim()}`).join("\n\n");
  return whole.length <= MOST_CHARS ? whole : `${whole.slice(0, MOST_CHARS - CUT.length)}${CUT}`;
}

/** What the AI is asked to do with the passages. */
export function instructionFor(papers: readonly ComparePaper[], columns: readonly string[]): string {
  const keys = papers.flatMap((p) => (p.key ? [p.key] : []));
  const asked = columns.length > 0 ? columns.join(", ") : "Question, Method, Evidence, Limitations, Relevance";
  return [
    `Compare the papers whose passages are in <selection> as a Markdown table, one row per paper, with the columns ${asked}.`,
    "Use only what the passages say; where they do not say it, write “not stated”.",
    "Lines that start with “> ” must hold nothing but a direct quotation from a passage.",
    keys.length > 0 ? `Name the paper each statement rests on as [@key], using only these keys: ${keys.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** One line of an answer, read. */
export interface AnswerLine {
  kind: "quote" | "generated" | "blank";
  /** The line, without the leading "> " of a quotation. */
  text: string;
  /** The citation keys in it, in order. */
  keys: string[];
  /** What is wrong with it, in words; empty when nothing is. */
  problems: string[];
}

/** Words as a quotation is compared: letters and digits, lower case, one space between. */
const plain = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Reads `answer` against the text that was sent, the keys of the bibliography and the keys of the papers sent. */
export function checkAnswer(answer: string, sent: string, bibliography: ReadonlySet<string>, sentKeys: ReadonlySet<string>): AnswerLine[] {
  const haystack = plain(sent);
  return answer.split(/\r?\n/).map((raw): AnswerLine => {
    const quote = raw.startsWith(">");
    const text = quote ? raw.replace(/^>\s?/, "") : raw;
    if (text.trim() === "") return { kind: "blank", text: "", keys: [], problems: [] };
    const keys = citationGroups(text).flatMap((g) => g.items.map((i) => i.key));
    const problems: string[] = [];
    if (quote) {
      const wanted = plain(text);
      if (wanted !== "" && !haystack.includes(wanted)) problems.push("Not found in the passages sent");
    }
    for (const key of keys) {
      if (!bibliography.has(key)) problems.push(`“${key}” is not in your references`);
      else if (!sentKeys.has(key)) problems.push(`“${key}” was not among the papers sent`);
    }
    return { kind: quote ? "quote" : "generated", text, keys, problems };
  });
}
