import { describe, expect, it } from "vitest";

import type { Highlight } from "../../../lib/vault/source-types";
import { checkAnswer, instructionFor, MOST_CHARS, pagesFor, selectionOf, type Passage } from "./ai-compare";
import type { ComparePaper } from "./papers";

const highlight = (id: string, page: number): Highlight => ({ id, page, rects: [], text: "t", color: "yellow", comment: null, cardId: null, created: null, card: null });
const paper = (key: string | null, title: string, highlights: Highlight[] = [], source: string | null = `sources/${key ?? "x"}.pdf`, abstract = ""): ComparePaper => ({ id: key ?? `pdf:${source}`, key, label: title, title, source, highlights, abstract });

const VASWANI = paper("vaswani2017", "Attention is all you need", [highlight("a", 7), highlight("b", 3), highlight("c", 3), highlight("d", 9), highlight("e", 12)]);
const DEVLIN = paper("devlin2019", "BERT");

describe("the pages of a paper that go to the AI", () => {
  it("are those with the highlights chosen, in order, at most three; the first page when none is chosen", () => {
    expect(pagesFor(VASWANI, new Set(["a", "b", "c", "d", "e"]))).toEqual([3, 7, 9]);
    expect(pagesFor(VASWANI, new Set(["e"]))).toEqual([12]);
    expect(pagesFor(VASWANI, new Set())).toEqual([1]);
  });
});

describe("the text sent", () => {
  const passages: Passage[] = [
    { paper: VASWANI, page: 3, text: "Attention page.", from: "pdf" },
    { paper: DEVLIN, page: null, text: "An abstract.", from: "abstract" },
  ];

  it("names each passage by its paper's key, title and page, and is exactly what the person was shown", () => {
    expect(selectionOf(passages)).toBe("[@vaswani2017] Attention is all you need, page 3:\nAttention page.\n\n[@devlin2019] BERT, abstract from your reference:\nAn abstract.");
  });

  it("is cut at the most the AI reads, and says so", () => {
    const long: Passage[] = [{ paper: VASWANI, page: 1, text: "x".repeat(MOST_CHARS + 500), from: "pdf" }];
    const sent = selectionOf(long);
    expect(sent.length).toBeLessThanOrEqual(MOST_CHARS);
    expect(sent.endsWith("(cut here)")).toBe(true);
  });
});

describe("the instruction", () => {
  it("asks for a table of the columns, quotes on lines of their own, and only the keys given", () => {
    const text = instructionFor([VASWANI, DEVLIN], ["Question", "Method"]);
    expect(text).toContain("Question, Method");
    expect(text).toContain("start with “> ”");
    expect(text).toContain("vaswani2017, devlin2019");
    expect(text).toContain("not stated");
    expect(text.length).toBeLessThanOrEqual(2000);
  });
});

describe("checking an answer against what was sent and the bibliography", () => {
  const sent = "[@vaswani2017] Attention is all you need, page 3:\nThe Transformer relies entirely on attention, dispensing with recurrence.";
  const keys = new Set(["vaswani2017", "devlin2019", "other2020"]);
  const sentKeys = new Set(["vaswani2017", "devlin2019"]);
  const answer = [
    "| Paper | Method |",
    "> The Transformer relies entirely on attention.",
    "> It invented the telephone.",
    "The Transformer drops recurrence [@vaswani2017]; BERT builds on it [@devlin2019, p. 4] and [@nobody1999] and [@other2020].",
    "",
  ].join("\n");
  const lines = checkAnswer(answer, sent, keys, sentKeys);

  it("tells quoted lines from the AI's own words", () => {
    expect(lines.map((l) => l.kind)).toEqual(["generated", "quote", "quote", "generated", "blank"]);
    expect(lines[1]!.text).toBe("The Transformer relies entirely on attention.");
  });

  it("finds a quotation in the passages sent, and flags one that is not there", () => {
    expect(lines[1]!.problems).toEqual([]);
    expect(lines[2]!.problems).toEqual(["Not found in the passages sent"]);
  });

  it("checks every key against the bibliography and against the papers sent", () => {
    expect(lines[3]!.keys).toEqual(["vaswani2017", "devlin2019", "nobody1999", "other2020"]);
    expect(lines[3]!.problems).toEqual(["“nobody1999” is not in your references", "“other2020” was not among the papers sent"]);
  });

  it("matches a quotation despite line breaks, case and the quote marks around it", () => {
    const [line] = checkAnswer('> "the transformer RELIES entirely on attention,\n> dispensing with recurrence."', sent, keys, sentKeys);
    expect(line!.problems).toEqual([]);
  });
});
